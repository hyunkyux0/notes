use crate::{
    app_settings::settings_path,
    notes::{self, Note},
    vault,
};
use cap_std::{ambient_authority, fs::Dir};
use tauri::AppHandle;

async fn in_vault<T: Send + 'static>(
    app: AppHandle,
    expected_path: String,
    action: impl FnOnce(Dir) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let saved = vault::load(&settings_path(&app)?)?.ok_or("Choose a notes folder first.")?;
        if saved.path != expected_path {
            return Err("The selected vault changed. Reopen the Notebook and try again.".into());
        }
        let dir = Dir::open_ambient_dir(saved.path, ambient_authority())
            .map_err(|_| "The notes folder could not be opened.")?;
        action(dir)
    })
    .await
    .map_err(|_| "The note operation was interrupted.")?
}

#[tauri::command]
pub async fn list_notes(app: AppHandle, vault_path: String) -> Result<Vec<String>, String> {
    in_vault(app, vault_path, |dir| notes::list(&dir)).await
}

#[tauri::command]
pub async fn read_note(
    app: AppHandle,
    vault_path: String,
    filename: String,
) -> Result<Note, String> {
    in_vault(app, vault_path, move |dir| notes::read(&dir, &filename)).await
}

#[tauri::command]
pub async fn create_note(
    app: AppHandle,
    vault_path: String,
    title: String,
) -> Result<Note, String> {
    in_vault(app, vault_path, move |dir| notes::create(&dir, &title)).await
}

#[tauri::command]
pub async fn save_note(
    app: AppHandle,
    vault_path: String,
    filename: String,
    expected_content: String,
    body: String,
) -> Result<Note, String> {
    in_vault(app, vault_path, move |dir| {
        notes::save(&dir, &filename, &expected_content, &body)
    })
    .await
}
