//! Only the native picker supplies paths; the frontend cannot submit arbitrary paths.
use crate::vault::{self, Vault};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("vault.json"))
        .map_err(|_| "App settings are unavailable.".into())
}

#[tauri::command]
pub async fn get_vault(app: AppHandle) -> Result<Option<Vault>, String> {
    tauri::async_runtime::spawn_blocking(move || vault::load(&settings_path(&app)?))
        .await
        .map_err(|_| "Loading the vault was interrupted.")?
}

#[tauri::command]
pub async fn choose_vault(app: AppHandle) -> Result<Option<Vault>, String> {
    // Blocking dialogs must run off the UI thread so the native event loop stays responsive.
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .set_title("Choose your notes folder")
            .blocking_pick_folder();
        let path = selected
            .map(|path| path.into_path())
            .transpose()
            .map_err(|_| "Choose a local folder.")?;
        vault::select(&settings_path(&app)?, path.as_deref())
    })
    .await
    .map_err(|_| "Choosing a vault was interrupted.")?
}
