use crate::{
    notes::{self, Note, VaultListing},
    windows,
};
use cap_std::{ambient_authority, fs::Dir};
use tauri::{Manager, WebviewWindow};

struct EditAccess {
    filename: String,
    token: String,
    destination: Option<String>,
}

async fn in_vault<T: Send + 'static>(
    window: WebviewWindow,
    expected_path: String,
    edit: Option<EditAccess>,
    action: impl FnOnce(Dir) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let saved = windows::selected_vault(&window)?.ok_or("Choose a notes folder first.")?;
        if saved.path != expected_path {
            return Err("The selected vault changed. Reopen the Notebook and try again.".into());
        }
        let dir = Dir::open_ambient_dir(saved.path, ambient_authority())
            .map_err(|_| "The notes folder could not be opened.")?;
        let state = window.state::<windows::Workspaces>();
        // Keep ownership valid for the entire write, including against window closure
        // or a destination being acquired by another editor while a rename runs.
        let guard = if edit.is_some() {
            Some(state.lock().map_err(|_| "Window state is unavailable.")?)
        } else {
            None
        };
        if let (Some(edit), Some(workspaces)) = (&edit, &guard) {
            windows::check_note_edit_access(
                workspaces,
                window.label(),
                &expected_path,
                &edit.filename,
                &edit.token,
                edit.destination.as_deref(),
            )?;
        }
        action(dir)
    })
    .await
    .map_err(|_| "The note operation was interrupted.")?
}

#[tauri::command]
pub async fn list_vault_contents(
    window: WebviewWindow,
    vault_path: String,
) -> Result<VaultListing, String> {
    in_vault(window, vault_path, None, |dir| notes::list(&dir)).await
}

#[tauri::command]
pub async fn read_note(
    window: WebviewWindow,
    vault_path: String,
    filename: String,
) -> Result<Note, String> {
    let database =
        crate::app_settings::settings_path(window.app_handle())?.with_file_name("reviews.sqlite");
    let scope = vault_path.clone();
    in_vault(window, vault_path, None, move |dir| {
        crate::saved_reviews::read(&dir, &scope, &filename, &database)
    })
    .await
}

#[tauri::command]
pub async fn create_note(
    window: WebviewWindow,
    vault_path: String,
    title: String,
    folder: String,
) -> Result<Note, String> {
    in_vault(window, vault_path, None, move |dir| {
        notes::create(&dir, &folder, &title)
    })
    .await
}

#[tauri::command]
pub async fn save_note(
    window: WebviewWindow,
    vault_path: String,
    filename: String,
    edit_token: String,
    expected_content: String,
    body: String,
) -> Result<Note, String> {
    let edit = EditAccess {
        filename: filename.clone(),
        token: edit_token,
        destination: None,
    };
    let settings = crate::app_settings::settings_path(window.app_handle())?;
    let scope = vault_path.clone();
    in_vault(window, vault_path, Some(edit), move |dir| {
        crate::saved_reviews::save(
            &dir,
            &scope,
            &filename,
            &expected_content,
            &body,
            &settings.with_file_name("reviews.sqlite"),
            &settings.with_file_name("review-settings.json"),
            || chrono::DateTime::from(std::time::SystemTime::now()),
        )
    })
    .await
}

#[tauri::command]
pub async fn rename_note(
    window: WebviewWindow,
    vault_path: String,
    filename: String,
    edit_token: String,
    new_filename: String,
    expected_content: String,
) -> Result<Note, String> {
    let edit = EditAccess {
        filename: filename.clone(),
        token: edit_token,
        destination: Some(new_filename.clone()),
    };
    in_vault(window, vault_path, Some(edit), move |dir| {
        notes::rename(&dir, &filename, &new_filename, &expected_content)
    })
    .await
}

#[tauri::command]
pub async fn create_folder(
    window: WebviewWindow,
    vault_path: String,
    parent: String,
    name: String,
) -> Result<String, String> {
    in_vault(window, vault_path, None, move |dir| {
        notes::create_folder(&dir, &parent, &name)
    })
    .await
}

#[tauri::command]
pub async fn import_note_image(
    window: WebviewWindow,
    vault_path: String,
    filename: String,
    edit_token: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let edit = EditAccess {
        filename: filename.clone(),
        token: edit_token,
        destination: None,
    };
    in_vault(window, vault_path, Some(edit), move |dir| {
        notes::images::import(&dir, &filename, &bytes)
    })
    .await
}

#[tauri::command]
pub async fn read_note_image(
    window: WebviewWindow,
    vault_path: String,
    filename: String,
    reference: String,
) -> Result<String, String> {
    in_vault(window, vault_path, None, move |dir| {
        notes::images::preview(&dir, &filename, &reference)
    })
    .await
}
