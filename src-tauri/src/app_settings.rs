use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("vault.json"))
        .map_err(|_| "App settings are unavailable.".into())
}
