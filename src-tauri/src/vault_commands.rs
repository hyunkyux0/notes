//! Only the native picker supplies paths; the frontend cannot submit arbitrary paths.
use crate::app_settings::settings_path;
use crate::vault::{self, Vault};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn get_vault(window: WebviewWindow) -> Result<Option<Vault>, String> {
    tauri::async_runtime::spawn_blocking(move || crate::windows::selected_vault(&window))
        .await
        .map_err(|_| "Loading the vault was interrupted.")?
}

#[tauri::command]
pub async fn choose_vault(window: WebviewWindow) -> Result<Option<Vault>, String> {
    // Blocking dialogs must run off the UI thread so the native event loop stays responsive.
    tauri::async_runtime::spawn_blocking(move || {
        let app = window.app_handle();
        let selected = app
            .dialog()
            .file()
            .set_title("Choose your notes folder")
            .blocking_pick_folder();
        let path = selected
            .map(|path| path.into_path())
            .transpose()
            .map_err(|_| "Choose a local folder.")?;
        let selected = vault::select(&settings_path(app)?, path.as_deref())?;
        if let Some(vault) = &selected {
            crate::windows::set_selected_vault(&window, vault.clone())?;
        }
        Ok(selected)
    })
    .await
    .map_err(|_| "Choosing a vault was interrupted.")?
}
