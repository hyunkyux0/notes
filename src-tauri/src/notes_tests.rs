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
    let first = create(&dir, "../Ideas: α / study").unwrap();
    let second = create(&dir, "../Ideas: α / study").unwrap();
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
    assert_eq!(list(&dir).unwrap().len(), 2);
}

#[test]
fn collision_never_overwrites_existing_content() {
    let (root, dir) = fixture();
    let id = Uuid::new_v4();
    let note = create_with_id(&dir, "Same title", id).unwrap();
    fs::write(root.path().join(&note.filename), "edited outside app").unwrap();
    assert!(create_with_id(&dir, "Same title", id).is_err());
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
    assert_eq!(list(&dir).unwrap(), ["Existing.MD"]);
    let note = read(&dir, "Existing.MD").unwrap();
    assert_eq!(note.id, None);
    assert_eq!(note.content, bytes);
    create(&dir, "Existing").unwrap();
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
        assert!(create(&dir, title).is_err());
    }
    assert!(list(&dir).unwrap().is_empty());
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
    assert!(list(&dir).unwrap().is_empty());
    assert!(read(&dir, "link.md").is_err());
    // The directory handle also rejects escapes independently of our preflight check.
    assert!(dir.open("link.md").is_err());
}
