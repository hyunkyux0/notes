//! Managed raster attachments live beside their note; Markdown keeps relative references.
use super::{note_location, open_folder, read_file, FILE_OPERATIONS_LOCK};
use base64::{engine::general_purpose::STANDARD, Engine};
use cap_std::fs::{Dir, OpenOptions};
use image::{ImageFormat, ImageReader, Limits};
use std::io::{Cursor, Read, Write};
use uuid::Uuid;

const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;
const ATTACHMENTS: &str = ".attachments";

fn decode(bytes: &[u8]) -> Result<(image::DynamicImage, &'static str), String> {
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("Images must be at most 8 MiB.".into());
    }
    let format =
        image::guess_format(bytes).map_err(|_| "Choose a PNG, JPEG, GIF, or WebP image.")?;
    let extension = match format {
        ImageFormat::Png => "png",
        ImageFormat::Jpeg => "jpg",
        ImageFormat::Gif => "gif",
        ImageFormat::WebP => "webp",
        _ => return Err("Choose a PNG, JPEG, GIF, or WebP image.".into()),
    };
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = Limits::default();
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    limits.max_alloc = Some(64 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader
        .decode()
        .map_err(|_| "The image is invalid or exceeds the 4096-pixel size limit.")?;
    Ok((decoded, extension))
}

pub fn import(root: &Dir, note: &str, bytes: &[u8]) -> Result<String, String> {
    let (_, extension) = decode(bytes)?;
    let _guard = FILE_OPERATIONS_LOCK
        .lock()
        .map_err(|_| "Image import is unavailable.")?;
    let (dir, filename) = note_location(root, note)?;
    read_file(&dir, &filename)?; // Never attach to a missing note or recovery-only draft.
    match dir.create_dir(ATTACHMENTS) {
        Ok(()) => (),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => (),
        Err(_) => return Err("The attachment folder could not be created.".into()),
    }
    let attachments = open_folder(&dir, ATTACHMENTS)?;
    let name = format!("{}.{}", Uuid::new_v4(), extension);
    let mut file = attachments
        .open_with(&name, OpenOptions::new().write(true).create_new(true))
        .map_err(|_| "The attachment could not be created; existing files were preserved.")?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "The attachment could not be fully saved. Retry the import.")?;
    Ok(format!("{ATTACHMENTS}/{name}"))
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub fn preview(root: &Dir, note: &str, reference: &str) -> Result<String, String> {
    let name = reference
        .strip_prefix(".attachments/")
        .ok_or("Unsupported image reference.")?;
    let (id, extension) = name
        .rsplit_once('.')
        .ok_or("Unsupported image reference.")?;
    if Uuid::parse_str(id).is_err()
        || id.len() != 36
        || !matches!(extension, "png" | "jpg" | "gif" | "webp")
    {
        return Err("Unsupported image reference.".into());
    }
    let (dir, filename) = note_location(root, note)?;
    read_file(&dir, &filename)?;
    let attachments = open_folder(&dir, ATTACHMENTS)?;
    // Reject symlinks at open time as well as path traversal. NONBLOCK prevents a
    // replaced FIFO from hanging the reader before its regular-file check.
    let fd = rustix::fs::openat(
        &attachments,
        name,
        rustix::fs::OFlags::RDONLY
            | rustix::fs::OFlags::NOFOLLOW
            | rustix::fs::OFlags::NONBLOCK
            | rustix::fs::OFlags::CLOEXEC,
        rustix::fs::Mode::empty(),
    )
    .map_err(|_| "The image is missing or unsafe to open.")?;
    let file = std::fs::File::from(fd);
    if !file
        .metadata()
        .map_err(|_| "The image is unavailable.")?
        .is_file()
    {
        return Err("The image must be a regular file.".into());
    }
    let mut bytes = Vec::new();
    file.take((MAX_IMAGE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "The image could not be read.")?;
    let (decoded, _) = decode(&bytes)?;
    // Render a bounded, static PNG, never note-controlled URLs or active formats.
    let mut png = Cursor::new(Vec::new());
    decoded
        .thumbnail(1600, 1600)
        .write_to(&mut png, ImageFormat::Png)
        .map_err(|_| "The image preview could not be created.")?;
    Ok(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(png.into_inner())
    ))
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn preview(_root: &Dir, _note: &str, _reference: &str) -> Result<String, String> {
    Err("Local image preview currently requires macOS or Linux.".into())
}
