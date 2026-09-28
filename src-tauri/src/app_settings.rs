use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("vault.json"))
        .map_err(|_| "App settings are unavailable.".into())
}

/// Settings files share the same atomic replacement boundary.
pub fn write_json(path: &std::path::Path, value: &impl serde::Serialize) -> Result<(), String> {
    use std::io::Write;
    let parent = path.parent().ok_or("Invalid settings location.")?;
    std::fs::create_dir_all(parent).map_err(|_| "The app settings folder could not be created.")?;
    let bytes = serde_json::to_vec(value).map_err(|_| "Settings could not be encoded.")?;
    // Use the destination filesystem so replacement is atomic.
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| "Settings could not be saved.")?;
    temporary
        .write_all(&bytes)
        .map_err(|_| "Settings could not be written.")?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|_| "Settings could not be flushed.")?;
    temporary
        .persist(path)
        .map_err(|_| "Settings could not be replaced.")?;
    Ok(())
}
