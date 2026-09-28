//! Markdown stays authoritative. IDs travel with created files, including after renames.
use cap_std::fs::{Dir, OpenOptions};
use serde::Serialize;
use std::io::{Read, Write};
use uuid::Uuid;

const MAX_BYTES: u64 = 2 * 1024 * 1024;
const ID_PREFIX: &str = "<!-- local-notes-id: ";

#[derive(Debug, Serialize)]
pub struct Note {
    /// Slash-separated path relative to the vault, including any containing folders.
    pub filename: String,
    pub id: Option<Uuid>,
    pub content: String,
}

fn valid_component(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\', ':'])
        && !name.chars().any(char::is_control)
}

fn valid_filename(name: &str) -> bool {
    valid_component(name) && name.to_ascii_lowercase().ends_with(".md")
}

// Open each folder without following symlinks, then operate through its directory handle.
fn open_folder(parent: &Dir, name: &str) -> Result<Dir, String> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        use rustix::fs::{openat, Mode, OFlags};
        let fd = openat(
            parent,
            name,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| "The folder is missing, inaccessible, or a symbolic link.")?;
        Ok(Dir::from_std_file(std::fs::File::from(fd)))
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = (parent, name);
        Err("Nested folders currently require macOS or Linux.".into())
    }
}

fn note_location(root: &Dir, path: &str) -> Result<(Dir, String), String> {
    let parts: Vec<_> = path.split('/').collect();
    if parts.len() > 33 || parts.iter().any(|part| !valid_component(part)) {
        return Err("Use a relative note path inside the vault, without empty, dot, or parent components (up to 32 folders).".into());
    }
    let filename = parts.last().ok_or("Missing note filename.")?;
    if !valid_filename(filename) {
        return Err("Choose a Markdown file inside the vault.".into());
    }
    let mut dir = root
        .try_clone()
        .map_err(|_| "The vault could not be opened.")?;
    for part in &parts[..parts.len() - 1] {
        dir = open_folder(&dir, part)?;
    }
    Ok((dir, (*filename).to_owned()))
}

pub fn list(dir: &Dir) -> Result<Vec<String>, String> {
    fn visit(dir: &Dir, prefix: &str, depth: usize, names: &mut Vec<String>) -> Result<(), String> {
        if depth > 32 {
            return Err("The vault exceeds the supported depth of 32 folders.".into());
        }
        for entry in dir
            .entries()
            .map_err(|_| "The vault could not be listed.")?
        {
            let entry = entry.map_err(|_| "A vault entry could not be read.")?;
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if !valid_component(&name) {
                continue;
            }
            let kind = entry
                .file_type()
                .map_err(|_| "A file type could not be read.")?;
            let path = format!("{prefix}{name}");
            if kind.is_dir() && !name.starts_with('.') {
                visit(
                    &open_folder(dir, &name)?,
                    &format!("{path}/"),
                    depth + 1,
                    names,
                )?;
            } else if kind.is_file() && valid_filename(&name) {
                names.push(path);
            }
        }
        Ok(())
    }
    let mut names = Vec::new();
    visit(dir, "", 0, &mut names)?;
    names.sort();
    Ok(names)
}

pub fn read(root: &Dir, path: &str) -> Result<Note, String> {
    let (dir, filename) = note_location(root, path)?;
    let mut note = read_file(&dir, &filename)?;
    note.filename = path.to_owned();
    Ok(note)
}

fn read_file(dir: &Dir, filename: &str) -> Result<Note, String> {
    if !valid_filename(filename) {
        return Err("Choose a Markdown filename within the opened folder.".into());
    }
    if !dir
        .symlink_metadata(filename)
        .map_err(|_| "The note is unavailable.")?
        .is_file()
    {
        return Err("The note must be a regular file, not a link or folder.".into());
    }
    // Dir confines path resolution to the vault even if a link changes during opening.
    let file = dir
        .open(filename)
        .map_err(|_| "The note could not be opened inside the vault.")?;
    if !file
        .metadata()
        .map_err(|_| "The note could not be inspected.")?
        .is_file()
    {
        return Err("The note must be a regular file.".into());
    }
    let mut content = String::new();
    file.take(MAX_BYTES + 1)
        .read_to_string(&mut content)
        .map_err(|_| "The note could not be read as UTF-8 Markdown.")?;
    if content.len() as u64 > MAX_BYTES {
        return Err("This preview supports notes up to 2 MiB.".into());
    }
    Ok(from_content(filename, content))
}

fn from_content(filename: &str, content: String) -> Note {
    let id = content
        .lines()
        .next()
        .and_then(|line| line.strip_prefix(ID_PREFIX))
        .and_then(|value| value.strip_suffix(" -->"))
        .and_then(|value| Uuid::parse_str(value).ok());
    Note {
        filename: filename.to_owned(),
        id,
        content,
    }
}

// Serializes this application's saves and renames; external editors do not share this lock.
static FILE_OPERATIONS_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn save(root: &Dir, path: &str, expected: &str, body: &str) -> Result<Note, String> {
    let (dir, filename) = note_location(root, path)?;
    let mut note = save_file(&dir, &filename, expected, body)?;
    note.filename = path.to_owned();
    Ok(note)
}

fn save_file(dir: &Dir, filename: &str, expected: &str, body: &str) -> Result<Note, String> {
    let _guard = FILE_OPERATIONS_LOCK
        .lock()
        .map_err(|_| "Saving is unavailable. Restart the app.")?;
    let original = read_file(dir, filename)?;
    // Build from the client's base, never from a potentially changed disk ID.
    let base = from_content(filename, expected.to_owned());
    let header = if base.id.is_some() {
        expected
            .split_once('\n')
            .map(|(line, _)| format!("{line}\n"))
            .unwrap_or_else(|| format!("{expected}\n"))
    } else {
        String::new()
    };
    let content = format!("{header}{body}");
    if content.len() as u64 > MAX_BYTES {
        return Err("Notes can contain at most 2 MiB. Your draft is retained.".into());
    }
    // A previous save may have completed just before a restart lost its response.
    if original.content == content {
        return Ok(original);
    }
    if original.content != expected {
        return Err(
            "Conflict: the file changed outside this editor. Your draft is retained.".into(),
        );
    }
    let temporary = format!(".notes-save-{}.tmp", Uuid::new_v4());
    let mut file = dir
        .open_with(&temporary, OpenOptions::new().write(true).create_new(true))
        .map_err(|_| "A temporary save file could not be created. Your draft is retained.")?;
    let result = (|| {
        let permissions = dir
            .metadata(filename)
            .map_err(|_| "The note is unavailable.")?
            .permissions();
        if permissions.readonly() {
            return Err("The note is read-only. Your draft is retained.");
        }
        file.set_permissions(permissions)
            .map_err(|_| "File permissions could not be preserved.")?;
        file.write_all(content.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|_| "The draft could not be written. The original file is unchanged.")?;
        if read_file(dir, filename)
            .map_err(|_| "The note became unavailable; your draft is retained.")?
            .content
            != expected
        {
            return Err("Conflict: the file changed during saving. Your draft is retained.");
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = dir.remove_file(&temporary);
    }
    result.map_err(str::to_owned)?;
    replace_checked(dir, filename, &temporary, expected)?;
    Ok(from_content(filename, content))
}

fn replace_checked(
    dir: &Dir,
    filename: &str,
    temporary: &str,
    expected: &str,
) -> Result<(), String> {
    // An atomic exchange keeps the displaced file available for a post-swap check.
    // A plain check-then-rename could silently discard an intervening external edit.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let swapped = rustix::fs::renameat_with(
        dir,
        temporary,
        dir,
        filename,
        rustix::fs::RenameFlags::EXCHANGE,
    )
    .is_ok();
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let swapped = false;
    if !swapped {
        let _ = dir.remove_file(temporary);
        return Err(
            "Safe file replacement is unavailable. The original and your draft are unchanged."
                .into(),
        );
    }
    let mut displaced = String::new();
    let checked = dir
        .open(temporary)
        .and_then(|file| file.take(MAX_BYTES + 1).read_to_string(&mut displaced));
    if checked.is_err() || displaced != expected {
        // Never clean up a displaced file that we cannot prove was the expected version.
        return Err(format!("Conflict during replacement: your draft is in the note; the displaced external version is retained as {temporary} beside the note. Inspect both before continuing."));
    }
    let _ = dir.remove_file(temporary);
    Ok(())
}

/// Rename or move between opened vault folders without replacing a directory entry.
pub fn rename(
    dir: &Dir,
    filename: &str,
    new_filename: &str,
    expected: &str,
) -> Result<Note, String> {
    let _guard = FILE_OPERATIONS_LOCK
        .lock()
        .map_err(|_| "Renaming is unavailable. Restart the app.")?;
    let (source_dir, source_name) = note_location(dir, filename)?;
    let (destination_dir, destination_name) = note_location(dir, new_filename)?;
    if new_filename.split('/').any(|part| {
        part.len() > 200
            || part.starts_with('.')
            || part.trim() != part
            || part.chars().any(|c| "<>\"|?*".contains(c))
    }) {
        return Err(
            "Use visible path components up to 200 bytes, without special characters.".into(),
        );
    }
    let mut original = read_file(&source_dir, &source_name)?;
    original.filename = filename.to_owned();
    if original.content != expected {
        return Err("Conflict: the file changed externally. Reload it before renaming.".into());
    }
    if filename == new_filename {
        return Ok(original);
    }
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let moved = rustix::fs::renameat_with(
        &source_dir,
        &source_name,
        &destination_dir,
        &destination_name,
        rustix::fs::RenameFlags::NOREPLACE,
    )
    .is_ok();
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let moved = false;
    if !moved {
        return Err("Rename failed: the destination may already exist, the source disappeared, or safe renaming is unsupported. Refresh the notes list.".into());
    }
    // An external writer does not share our lock. Keep its bytes and report the new location.
    match read_file(&destination_dir, &destination_name) {
        Ok(mut note) if note.content == expected => {
            note.filename = new_filename.to_owned();
            Ok(note)
        },
        _ => Err(format!("The file moved to {new_filename}, but changed externally or became unreadable. Refresh the list; no file contents were rewritten.")),
    }
}

pub fn create(dir: &Dir, title: &str) -> Result<Note, String> {
    create_with_id(dir, title, Uuid::new_v4())
}

fn create_with_id(dir: &Dir, title: &str, id: Uuid) -> Result<Note, String> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 120 || title.chars().any(char::is_control) {
        return Err("Enter a title of 1–120 characters on one line.".into());
    }
    let slug: String = title
        .chars()
        .take(48)
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let slug = slug.trim_matches('-');
    let filename = format!("{}-{id}.md", if slug.is_empty() { "note" } else { slug });
    let content = format!("{ID_PREFIX}{id} -->\n\n# {title}\n");
    // Exclusive creation never replaces an existing file, even on an ID collision.
    let mut file = dir
        .open_with(&filename, OpenOptions::new().write(true).create_new(true))
        .map_err(|_| "The note could not be created; existing files were preserved.")?;
    file.write_all(content.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|_| "The new note could not be fully saved. Check the folder before retrying.")?;
    Ok(Note {
        filename,
        id: Some(id),
        content,
    })
}

#[cfg(test)]
#[path = "notes_tests.rs"]
mod tests;
