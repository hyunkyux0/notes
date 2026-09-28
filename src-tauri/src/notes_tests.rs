use super::*;
use cap_std::ambient_authority;
use std::fs;

fn fixture() -> (tempfile::TempDir, Dir) {
    let root = tempfile::tempdir().unwrap();
    let dir = Dir::open_ambient_dir(root.path(), ambient_authority()).unwrap();
    (root, dir)
}

#[test]
fn create_unique_notes_and_keep_ids_after_rename() {
    let (root, dir) = fixture();
    let first = create(&dir, "", "../Ideas: α / study").unwrap();
    let second = create(&dir, "", "../Ideas: α / study").unwrap();
    assert_ne!(first.id, second.id);
    assert_ne!(first.filename, second.filename);
    assert!(valid_filename(&first.filename));
    assert_eq!(read(&dir, &first.filename).unwrap().content, first.content);
    fs::rename(
        root.path().join(&first.filename),
        root.path().join("renamed.md"),
    )
    .unwrap();
    assert_eq!(read(&dir, "renamed.md").unwrap().id, first.id);
    assert_eq!(list(&dir).unwrap().files.len(), 2);
}

#[test]
fn collision_never_overwrites_existing_content() {
    let (root, dir) = fixture();
    let note = create(&dir, "", "Same title").unwrap();
    fs::write(root.path().join(&note.filename), "edited outside app").unwrap();
    let second = create(&dir, "", "Same title").unwrap();
    let third = create(&dir, "", "Same title").unwrap();
    assert_eq!(note.filename, "Same title.md");
    assert_eq!(second.filename, "Same title (2).md");
    assert_eq!(third.filename, "Same title (3).md");
    assert_ne!(note.id, second.id);
    assert_eq!(
        read(&dir, &note.filename).unwrap().content,
        "edited outside app"
    );
}

#[test]
fn existing_markdown_is_listed_and_read_without_rewriting() {
    let (root, dir) = fixture();
    let bytes = "---\ntitle: Existing\n---\n# Hello\n$E=mc^2$\n";
    fs::write(root.path().join("Existing.MD"), bytes).unwrap();
    fs::write(root.path().join("image.png"), [0, 1]).unwrap();
    fs::create_dir(root.path().join("folder.md")).unwrap();
    assert_eq!(list(&dir).unwrap().files, ["Existing.MD"]);
    let note = read(&dir, "Existing.MD").unwrap();
    assert_eq!(note.id, None);
    assert_eq!(note.content, bytes);
    create(&dir, "", "Existing").unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("Existing.MD")).unwrap(),
        bytes
    );
}

#[test]
fn reject_paths_outside_vault_and_non_markdown() {
    let (_root, dir) = fixture();
    for name in [
        "../secret.md",
        "/tmp/secret.md",
        "a/b.md",
        "a\\b.md",
        "C:secret.md",
        "note.txt",
        "",
    ] {
        assert!(read(&dir, name).is_err(), "{name}");
    }
    assert!(read(&dir, "missing.md").is_err());
}

#[test]
fn invalid_titles_do_not_create_files() {
    let (_root, dir) = fixture();
    for title in ["", "  ", "first\nsecond", &"a".repeat(121)] {
        assert!(create(&dir, "", title).is_err());
    }
    assert!(list(&dir).unwrap().files.is_empty());
}

#[test]
fn reject_binary_and_oversized_files() {
    let (root, dir) = fixture();
    fs::write(root.path().join("binary.md"), [0xff]).unwrap();
    fs::write(
        root.path().join("large.md"),
        vec![b'a'; MAX_BYTES as usize + 1],
    )
    .unwrap();
    assert!(read(&dir, "binary.md").is_err());
    assert!(read(&dir, "large.md").is_err());
}

#[cfg(unix)]
#[test]
fn links_cannot_expose_external_notes() {
    let (root, dir) = fixture();
    let outside = tempfile::tempdir().unwrap();
    let secret = outside.path().join("secret.md");
    fs::write(&secret, "private").unwrap();
    std::os::unix::fs::symlink(&secret, root.path().join("link.md")).unwrap();
    assert!(list(&dir).unwrap().files.is_empty());
    assert!(read(&dir, "link.md").is_err());
    // The directory handle also rejects escapes independently of our preflight check.
    assert!(dir.open("link.md").is_err());
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn save_preserves_id_and_supports_response_loss_retry() {
    let (_root, dir) = fixture();
    let original = create(&dir, "", "Study").unwrap();
    let saved = save(&dir, &original.filename, &original.content, "# Edited\n").unwrap();
    assert_eq!(saved.id, original.id);
    assert!(saved.content.ends_with("# Edited\n"));
    assert_eq!(read(&dir, &saved.filename).unwrap().content, saved.content);
    assert_eq!(
        save(&dir, &original.filename, &original.content, "# Edited\n")
            .unwrap()
            .content,
        saved.content
    );
    assert_eq!(dir.entries().unwrap().count(), 1);
}

#[test]
fn stale_save_and_deleted_file_keep_external_state() {
    let (root, dir) = fixture();
    let note = create(&dir, "", "Study").unwrap();
    fs::write(root.path().join(&note.filename), "external edit").unwrap();
    assert!(save(&dir, &note.filename, &note.content, "my draft").is_err());
    assert_eq!(
        fs::read_to_string(root.path().join(&note.filename)).unwrap(),
        "external edit"
    );
    fs::remove_file(root.path().join(&note.filename)).unwrap();
    assert!(save(&dir, &note.filename, &note.content, "my draft").is_err());
    assert_eq!(dir.entries().unwrap().count(), 0);
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn racing_external_replacement_is_retained_for_recovery() {
    let (root, dir) = fixture();
    fs::write(root.path().join("note.md"), "external edit after preflight").unwrap();
    fs::write(root.path().join("staged.tmp"), "my draft").unwrap();
    let error = replace_checked(&dir, "note.md", "staged.tmp", "old content").unwrap_err();
    assert!(error.contains("staged.tmp"));
    assert_eq!(
        fs::read_to_string(root.path().join("note.md")).unwrap(),
        "my draft"
    );
    assert_eq!(
        fs::read_to_string(root.path().join("staged.tmp")).unwrap(),
        "external edit after preflight"
    );
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn legacy_content_and_file_permissions_survive_save() {
    use std::os::unix::fs::PermissionsExt;
    let (root, dir) = fixture();
    let path = root.path().join("legacy.md");
    fs::write(&path, "---\ntitle: Legacy\n---\nold").unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
    let original = read(&dir, "legacy.md").unwrap();
    let saved = save(
        &dir,
        "legacy.md",
        &original.content,
        "---\ntitle: Legacy\n---\nnew",
    )
    .unwrap();
    assert_eq!(saved.id, None);
    assert_eq!(saved.content, "---\ntitle: Legacy\n---\nnew");
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o640
    );
}

#[test]
fn failed_save_does_not_leave_temporary_files_or_change_content() {
    let (root, dir) = fixture();
    let note = create(&dir, "", "Study").unwrap();
    let path = root.path().join(&note.filename);
    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&path, permissions).unwrap();
    assert!(save(&dir, &note.filename, &note.content, "draft").is_err());
    assert_eq!(read(&dir, &note.filename).unwrap().content, note.content);
    assert_eq!(dir.entries().unwrap().count(), 1);
    assert!(save(&dir, "../outside.md", "", "draft").is_err());
    assert!(save(
        &dir,
        &note.filename,
        &note.content,
        &"x".repeat(MAX_BYTES as usize + 1)
    )
    .is_err());
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn competing_app_saves_cannot_overwrite_each_other() {
    let (_root, dir) = fixture();
    let original = create(&dir, "", "Study").unwrap();
    std::thread::scope(|scope| {
        let first = scope.spawn(|| save(&dir, &original.filename, &original.content, "first"));
        let second = scope.spawn(|| save(&dir, &original.filename, &original.content, "second"));
        assert_ne!(
            first.join().unwrap().is_ok(),
            second.join().unwrap().is_ok()
        );
    });
    assert_eq!(dir.entries().unwrap().count(), 1);
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn renaming_keeps_content_identity_and_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let (root, dir) = fixture();
    let original = create(&dir, "", "Study").unwrap();
    let old_path = root.path().join(&original.filename);
    fs::set_permissions(&old_path, fs::Permissions::from_mode(0o640)).unwrap();
    let renamed = rename(&dir, &original.filename, "New name.md", &original.content).unwrap();
    assert_eq!(renamed.id, original.id);
    assert_eq!(renamed.content, original.content);
    assert!(!old_path.exists());
    assert_eq!(
        fs::metadata(root.path().join("New name.md"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o640
    );
    assert_eq!(list(&dir).unwrap().files, ["New name.md"]);
    assert_eq!(
        rename(&dir, "New name.md", "New name.md", &renamed.content)
            .unwrap()
            .content,
        renamed.content
    );
}

#[test]
fn rename_rejects_collisions_and_changed_or_missing_sources() {
    let (root, dir) = fixture();
    fs::write(root.path().join("first.md"), "original").unwrap();
    fs::write(root.path().join("second.md"), "keep this").unwrap();
    assert!(rename(&dir, "first.md", "second.md", "original").is_err());
    assert_eq!(read(&dir, "first.md").unwrap().content, "original");
    assert_eq!(read(&dir, "second.md").unwrap().content, "keep this");
    fs::write(root.path().join("first.md"), "external").unwrap();
    assert!(rename(&dir, "first.md", "new.md", "original").is_err());
    assert_eq!(read(&dir, "first.md").unwrap().content, "external");
    assert!(rename(&dir, "missing.md", "new.md", "").is_err());
    assert!(!root.path().join("new.md").exists());
}

#[test]
fn rename_rejects_unsafe_names_without_moving_source() {
    let (_root, dir) = fixture();
    let original = create(&dir, "", "Study").unwrap();
    for name in [
        "../out.md",
        "/tmp/out.md",
        "folder/note.md",
        "folder\\note.md",
        "bad:name.md",
        "bad?.md",
        "line\nbreak.md",
        ".hidden.md",
        "note.txt",
        " spaced.md",
        &format!("{}.md", "a".repeat(201)),
    ] {
        assert!(
            rename(&dir, &original.filename, name, &original.content).is_err(),
            "{name}"
        );
    }
    assert_eq!(
        read(&dir, &original.filename).unwrap().content,
        original.content
    );
    assert_eq!(dir.entries().unwrap().count(), 1);
}

#[cfg(unix)]
#[test]
fn rename_does_not_follow_source_or_destination_links() {
    let (root, dir) = fixture();
    let outside = tempfile::tempdir().unwrap();
    let target = outside.path().join("outside.md");
    fs::write(&target, "outside").unwrap();
    std::os::unix::fs::symlink(&target, root.path().join("link.md")).unwrap();
    fs::write(root.path().join("note.md"), "local").unwrap();
    assert!(rename(&dir, "link.md", "new.md", "outside").is_err());
    assert!(rename(&dir, "note.md", "link.md", "local").is_err());
    assert_eq!(fs::read_to_string(target).unwrap(), "outside");
    assert_eq!(read(&dir, "note.md").unwrap().content, "local");
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn moved_notes_are_listed_read_saved_and_moved_back() {
    let (root, dir) = fixture();
    fs::create_dir_all(root.path().join("archive/week1")).unwrap();
    let original = create(&dir, "", "Study").unwrap();
    let path = "archive/week1/study.md";
    let moved = rename(&dir, &original.filename, path, &original.content).unwrap();
    assert_eq!(moved.filename, path);
    assert_eq!(moved.id, original.id);
    assert_eq!(moved.content, original.content);
    assert_eq!(list(&dir).unwrap().files, [path]);
    assert_eq!(read(&dir, path).unwrap().content, original.content);
    let saved = save(&dir, path, &moved.content, "# Edited after move").unwrap();
    assert_eq!(saved.filename, path);
    assert_eq!(saved.id, original.id);
    assert_eq!(
        fs::read_dir(root.path().join("archive/week1"))
            .unwrap()
            .count(),
        1
    );
    let returned = rename(&dir, path, "returned.md", &saved.content).unwrap();
    assert_eq!(returned.content, saved.content);
    assert_eq!(returned.id, original.id);
    assert_eq!(list(&dir).unwrap().files, ["returned.md"]);
}

#[test]
fn move_rejects_collisions_missing_folders_and_unsafe_components() {
    let (root, dir) = fixture();
    fs::create_dir(root.path().join("folder")).unwrap();
    fs::write(root.path().join("note.md"), "source").unwrap();
    fs::write(root.path().join("folder/note.md"), "destination").unwrap();
    for target in [
        "folder/note.md",
        "missing/note.md",
        "folder/../outside.md",
        "folder//other.md",
        "./other.md",
    ] {
        assert!(
            rename(&dir, "note.md", target, "source").is_err(),
            "{target}"
        );
    }
    assert_eq!(read(&dir, "note.md").unwrap().content, "source");
    assert_eq!(read(&dir, "folder/note.md").unwrap().content, "destination");
    assert!(!root.path().join("missing").exists());
    assert!(rename(&dir, "note.md", "folder/new.md", "stale content").is_err());
}

#[cfg(unix)]
#[test]
fn directory_links_are_excluded_and_rejected_for_all_note_operations() {
    let (root, dir) = fixture();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("secret.md"), "outside").unwrap();
    fs::create_dir(root.path().join("real")).unwrap();
    fs::write(root.path().join("real/local.md"), "inside").unwrap();
    std::os::unix::fs::symlink(outside.path(), root.path().join("escape")).unwrap();
    std::os::unix::fs::symlink("real", root.path().join("alias")).unwrap();
    assert_eq!(list(&dir).unwrap().files, ["real/local.md"]);
    for path in ["escape/secret.md", "alias/local.md"] {
        assert!(read(&dir, path).is_err());
        assert!(save(&dir, path, "outside", "draft").is_err());
        assert!(rename(&dir, "real/local.md", path, "inside").is_err());
        assert!(rename(&dir, path, "new.md", "outside").is_err());
    }
    assert_eq!(
        fs::read_to_string(outside.path().join("secret.md")).unwrap(),
        "outside"
    );
    assert_eq!(read(&dir, "real/local.md").unwrap().content, "inside");
}

#[test]
fn nested_listing_skips_hidden_folders_and_non_markdown() {
    let (root, dir) = fixture();
    fs::create_dir_all(root.path().join("folder/deeper")).unwrap();
    fs::create_dir(root.path().join(".hidden")).unwrap();
    for name in [
        "root.md",
        "folder/b.md",
        "folder/deeper/a.MD",
        ".hidden/private.md",
        "folder/photo.png",
    ] {
        fs::write(root.path().join(name), "text").unwrap();
    }
    assert_eq!(
        list(&dir).unwrap().files,
        ["folder/b.md", "folder/deeper/a.MD", "root.md"]
    );
    assert_eq!(
        read(&dir, "folder/deeper/a.MD").unwrap().filename,
        "folder/deeper/a.MD"
    );
}

#[test]
fn create_folders_and_notes_in_selected_folder() {
    let (_root, dir) = fixture();
    assert_eq!(create_folder(&dir, "", "Courses").unwrap(), "Courses");
    assert_eq!(
        create_folder(&dir, "Courses", "Empty").unwrap(),
        "Courses/Empty"
    );
    let listing = list(&dir).unwrap();
    assert_eq!(listing.folders, ["Courses", "Courses/Empty"]);
    assert!(listing.files.is_empty());
    let note = create(&dir, "Courses/Empty", "New study").unwrap();
    assert!(note.filename.starts_with("Courses/Empty/"));
    let opened = read(&dir, &note.filename).unwrap();
    assert_eq!(opened.id, note.id);
    assert_eq!(opened.content, note.content);
    assert_eq!(list(&dir).unwrap().files, [note.filename]);
}

#[test]
fn folder_creation_rejects_collisions_and_invalid_paths() {
    let (_root, dir) = fixture();
    create_folder(&dir, "", "Existing").unwrap();
    dir.write("file", "preserve me").unwrap();
    for name in [
        "Existing", "file", "", ".", "..", "a/b", "a\\b", "/tmp", ".hidden", " space", "a:b", "a?b",
    ] {
        assert!(create_folder(&dir, "", name).is_err(), "{name}");
    }
    for parent in [
        "../outside",
        "/tmp",
        "missing",
        "Existing/../Existing",
        "Existing//child",
    ] {
        assert!(create_folder(&dir, parent, "child").is_err(), "{parent}");
        assert!(create(&dir, parent, "note").is_err(), "{parent}");
    }
    assert_eq!(dir.read_to_string("file").unwrap(), "preserve me");
    assert_eq!(list(&dir).unwrap().folders, ["Existing"]);
}

#[cfg(unix)]
#[test]
fn folder_creation_and_note_creation_reject_symlink_parents() {
    let (root, dir) = fixture();
    let outside = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), root.path().join("linked")).unwrap();
    assert!(create_folder(&dir, "linked", "child").is_err());
    assert!(create(&dir, "linked", "note").is_err());
    assert!(create_folder(&dir, "", "linked").is_err());
    assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
    assert!(list(&dir).unwrap().folders.is_empty());
}

#[test]
fn folder_depth_limit_keeps_created_folders_listable() {
    let (_root, dir) = fixture();
    let mut path = String::new();
    for _ in 0..32 {
        path = create_folder(&dir, &path, "child").unwrap();
    }
    assert!(create_folder(&dir, &path, "too-deep").is_err());
    let note = create(&dir, &path, "Deep note").unwrap();
    let listing = list(&dir).unwrap();
    assert_eq!(listing.folders.len(), 32);
    assert_eq!(listing.files, [note.filename]);
}

#[test]
fn readable_filenames_preserve_titles_and_fit_destination_limits() {
    let (_root, dir) = fixture();
    for (title, expected) in [
        ("Test 1", "Test 1.md"),
        ("Ideas α 学習", "Ideas α 学習.md"),
        ("../A:B/C\\D?", "-A-B-C-D-.md"),
        ("...", "Note.md"),
        ("CON", "_CON.md"),
        ("LPT1.notes", "_LPT1.notes.md"),
        (" .Hidden. ", "Hidden.md"),
    ] {
        let note = create(&dir, "", title).unwrap();
        assert_eq!(note.filename, expected);
        assert!(note.content.ends_with(&format!("# {}\n", title.trim())));
        assert_eq!(read(&dir, expected).unwrap().id, note.id);
    }
    let long = create(&dir, "", &"学".repeat(120)).unwrap();
    assert!(valid_destination_component(&long.filename));
    assert!(long.filename.len() <= 200);
}

#[test]
fn occupied_directory_and_symlink_names_are_skipped() {
    let (root, dir) = fixture();
    let outside = tempfile::tempdir().unwrap();
    let target = outside.path().join("untouched.md");
    fs::write(&target, "outside content").unwrap();
    fs::create_dir(root.path().join("Study.md")).unwrap();
    std::os::unix::fs::symlink(&target, root.path().join("Study (2).md")).unwrap();
    let note = create(&dir, "", "Study").unwrap();
    assert_eq!(note.filename, "Study (3).md");
    assert_eq!(fs::read_to_string(target).unwrap(), "outside content");
}

#[test]
fn simultaneous_creates_keep_every_note() {
    let (root, _dir) = fixture();
    let notes = std::thread::scope(|scope| {
        let tasks: Vec<_> = (0..8)
            .map(|_| {
                let path = root.path();
                scope.spawn(move || {
                    let dir = Dir::open_ambient_dir(path, ambient_authority()).unwrap();
                    create(&dir, "", "Study").unwrap()
                })
            })
            .collect();
        tasks
            .into_iter()
            .map(|task| task.join().unwrap())
            .collect::<Vec<_>>()
    });
    let names: std::collections::HashSet<_> = notes.iter().map(|note| &note.filename).collect();
    let ids: std::collections::HashSet<_> = notes.iter().map(|note| note.id).collect();
    assert_eq!(names.len(), 8);
    assert_eq!(ids.len(), 8);
    for note in notes {
        assert_eq!(
            fs::read_to_string(root.path().join(note.filename)).unwrap(),
            note.content
        );
    }
}

fn png_bytes() -> Vec<u8> {
    let mut output = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(2, 2)
        .write_to(&mut output, image::ImageFormat::Png)
        .unwrap();
    output.into_inner()
}

#[test]
fn images_preserve_originals_and_survive_rename_but_block_moves() {
    let (root, dir) = fixture();
    create_folder(&dir, "", "Course").unwrap();
    let note = create(&dir, "Course", "Study").unwrap();
    let bytes = png_bytes();
    let first = images::import(&dir, &note.filename, &bytes).unwrap();
    let second = images::import(&dir, &note.filename, &bytes).unwrap();
    assert_ne!(first, second);
    assert_eq!(
        fs::read(root.path().join("Course").join(&first)).unwrap(),
        bytes
    );
    assert!(images::preview(&dir, &note.filename, &first)
        .unwrap()
        .starts_with("data:image/png;base64,"));
    let saved = save(
        &dir,
        &note.filename,
        &note.content,
        &format!("![Image]({first})"),
    )
    .unwrap();
    assert!(rename(&dir, &saved.filename, "Moved.md", &saved.content)
        .unwrap_err()
        .contains("attachments"));
    let renamed = rename(&dir, &saved.filename, "Course/Renamed.md", &saved.content).unwrap();
    assert_eq!(renamed.id, saved.id);
    assert_eq!(renamed.content, saved.content);
    assert!(images::preview(&dir, &renamed.filename, &first).is_ok());
    assert_eq!(list(&dir).unwrap().folders, ["Course"]);
}

#[test]
fn image_import_rejects_invalid_active_oversized_and_missing_inputs() {
    let (root, dir) = fixture();
    let note = create(&dir, "", "Study").unwrap();
    for bytes in [
        b"<svg xmlns='http://www.w3.org/2000/svg'/>".to_vec(),
        b"<html>test</html>".to_vec(),
        vec![0; 8 * 1024 * 1024 + 1],
        vec![137, 80, 78, 71],
    ] {
        assert!(images::import(&dir, &note.filename, &bytes).is_err());
    }
    assert!(!root.path().join(".attachments").exists());
    assert!(images::import(&dir, "missing.md", &png_bytes()).is_err());
    assert!(images::import(&dir, "../escape.md", &png_bytes()).is_err());
    let mut oversized = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(4097, 1)
        .write_to(&mut oversized, image::ImageFormat::Png)
        .unwrap();
    assert!(images::import(&dir, &note.filename, &oversized.into_inner()).is_err());
}

#[test]
fn image_preview_rejects_paths_links_and_changed_image_bytes() {
    let (root, dir) = fixture();
    let note = create(&dir, "", "Study").unwrap();
    let reference = images::import(&dir, &note.filename, &png_bytes()).unwrap();
    for path in [
        "../outside.png",
        "https://example.org/a.png",
        "data:image/svg+xml,test",
        ".attachments/../../outside.png",
        ".attachments/test.svg",
    ] {
        assert!(images::preview(&dir, &note.filename, path).is_err());
    }
    fs::write(root.path().join(&reference), "<svg/>").unwrap();
    assert!(images::preview(&dir, &note.filename, &reference).is_err());
    fs::remove_file(root.path().join(&reference)).unwrap();
    let outside = tempfile::tempdir().unwrap();
    let target = outside.path().join("outside.png");
    fs::write(&target, png_bytes()).unwrap();
    std::os::unix::fs::symlink(&target, root.path().join(&reference)).unwrap();
    assert!(images::preview(&dir, &note.filename, &reference).is_err());
    fs::remove_file(root.path().join(&reference)).unwrap();
    fs::remove_dir(root.path().join(".attachments")).unwrap();
    std::os::unix::fs::symlink(outside.path(), root.path().join(".attachments")).unwrap();
    assert!(images::import(&dir, &note.filename, &png_bytes()).is_err());
    assert!(images::preview(&dir, &note.filename, &reference).is_err());
    assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 1);
}

#[test]
fn supported_raster_formats_are_validated_and_original_bytes_retained() {
    let (root, dir) = fixture();
    let note = create(&dir, "", "Formats").unwrap();
    for format in [
        image::ImageFormat::Png,
        image::ImageFormat::Jpeg,
        image::ImageFormat::Gif,
        image::ImageFormat::WebP,
    ] {
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(2, 2)
            .write_to(&mut bytes, format)
            .unwrap();
        let reference = images::import(&dir, &note.filename, bytes.get_ref()).unwrap();
        assert_eq!(
            fs::read(root.path().join(&reference)).unwrap(),
            *bytes.get_ref()
        );
        assert!(images::preview(&dir, &note.filename, &reference).is_ok());
    }
}
