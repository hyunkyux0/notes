//! Window-local vault selection and one editable view per note protect shared drafts.
use crate::{
    app_settings::settings_path,
    vault::{self, Vault},
};
use std::{collections::HashMap, sync::Mutex};
use tauri::{AppHandle, Manager, WebviewWindow};
use unicode_normalization::UnicodeNormalization;

#[derive(Default)]
pub struct WindowWorkspaces {
    vaults: HashMap<String, Option<Vault>>,
    // (vault path, note path) -> (owning window label, editor token).
    editors: HashMap<(String, String), (String, String)>,
}

impl WindowWorkspaces {
    fn key(vault: &str, filename: &str) -> (String, String) {
        // Conservatively serialize case/Unicode aliases, including on macOS volumes.
        (
            vault.nfc().collect::<String>().to_lowercase(),
            filename.nfc().collect::<String>().to_lowercase(),
        )
    }
    fn acquire(&mut self, window: &str, vault: &str, filename: &str, token: &str) -> bool {
        let owner = (window.to_owned(), token.to_owned());
        let entry = self
            .editors
            .entry(Self::key(vault, filename))
            .or_insert(owner.clone());
        *entry == owner
    }
    fn release(&mut self, window: &str, token: &str) {
        self.editors
            .retain(|_, owner| owner != &(window.to_owned(), token.to_owned()));
    }
    pub fn release_window_editors(&mut self, window: &str) {
        self.editors.retain(|_, (owner, _)| owner != window);
    }
    pub fn close_window(&mut self, window: &str) {
        self.vaults.remove(window);
        self.release_window_editors(window);
    }
}

pub type Workspaces = Mutex<WindowWorkspaces>;

pub fn selected_vault(window: &WebviewWindow) -> Result<Option<Vault>, String> {
    let state = window.state::<Workspaces>();
    let mut workspaces = state.lock().map_err(|_| "Window state is unavailable.")?;
    if let Some(vault) = workspaces.vaults.get(window.label()) {
        return revalidate_selection(vault.clone());
    }
    let vault = vault::load(&settings_path(window.app_handle())?)?;
    workspaces
        .vaults
        .insert(window.label().into(), vault.clone());
    Ok(vault)
}

fn revalidate_selection(selected: Option<Vault>) -> Result<Option<Vault>, String> {
    if let Some(vault) = &selected {
        let current = vault::validate(std::path::Path::new(&vault.path))?;
        if current != *vault {
            return Err(
                "The vault folder was redirected. Choose it again before continuing.".into(),
            );
        }
    }
    Ok(selected)
}

pub fn set_selected_vault(window: &WebviewWindow, vault: Vault) -> Result<(), String> {
    window
        .state::<Workspaces>()
        .lock()
        .map_err(|_| "Window state is unavailable.")?
        .vaults
        .insert(window.label().into(), Some(vault));
    Ok(())
}

pub fn check_note_edit_access(
    workspaces: &WindowWorkspaces,
    window: &str,
    vault: &str,
    filename: &str,
    token: &str,
    destination: Option<&str>,
) -> Result<(), String> {
    let owner = (window.to_owned(), token.to_owned());
    if workspaces
        .editors
        .get(&WindowWorkspaces::key(vault, filename))
        != Some(&owner)
    {
        return Err("This note is not editable in this window. Reopen it to try again.".into());
    }
    if let Some(destination) = destination {
        if workspaces
            .editors
            .get(&WindowWorkspaces::key(vault, destination))
            .is_some_and(|entry| entry != &owner)
        {
            return Err(
                "The destination is open in another editor. Close it before renaming.".into(),
            );
        }
    }
    Ok(())
}

#[tauri::command]
pub fn acquire_note(
    window: WebviewWindow,
    vault_path: String,
    filename: String,
    token: String,
) -> Result<bool, String> {
    if selected_vault(&window)?.as_ref().map(|vault| &vault.path) != Some(&vault_path) {
        return Err("The selected vault changed. Reopen the note.".into());
    }
    Ok(window
        .state::<Workspaces>()
        .lock()
        .map_err(|_| "Window state is unavailable.")?
        .acquire(window.label(), &vault_path, &filename, &token))
}

#[tauri::command]
pub fn release_note(window: WebviewWindow, token: String) -> Result<(), String> {
    window
        .state::<Workspaces>()
        .lock()
        .map_err(|_| "Window state is unavailable.")?
        .release(window.label(), &token);
    Ok(())
}

#[tauri::command]
pub async fn new_window(app: AppHandle) -> Result<(), String> {
    let mut config = app
        .config()
        .app
        .windows
        .first()
        .ok_or("Window configuration is missing.")?
        .clone();
    config.label = format!("notes-{}", uuid::Uuid::new_v4());
    tauri::WebviewWindowBuilder::from_config(&app, &config)
        .map_err(|_| "The new window could not be configured.")?
        .build()
        .map_err(|_| "The new window could not be opened.")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn independent_vaults_and_note_ownership_survive_other_window_closure() {
        let mut state = WindowWorkspaces::default();
        state
            .vaults
            .insert("one".into(), Some(Vault { path: "/a".into() }));
        state
            .vaults
            .insert("two".into(), Some(Vault { path: "/b".into() }));
        assert!(state.acquire("one", "/a", "Study.md", "first"));
        assert!(!state.acquire("two", "/a", "study.md", "second"));
        assert!(state.acquire("two", "/b", "Study.md", "second"));
        state.release("one", "stale-token");
        assert!(!state.acquire("two", "/a", "Study.md", "second"));
        state.close_window("one");
        assert!(state.acquire("two", "/a", "Study.md", "second"));
        assert_eq!(
            state.vaults.get("two").unwrap().as_ref().unwrap().path,
            "/b"
        );
        state.release("two", "second");
        assert!(state.editors.is_empty());
    }
    #[test]
    fn edit_tokens_destinations_and_reload_are_checked() {
        let mut state = WindowWorkspaces::default();
        state
            .vaults
            .insert("one".into(), Some(Vault { path: "/a".into() }));
        assert!(state.acquire("one", "/a", "é.md", "token"));
        assert!(!state.acquire("two", "/a", "e\u{301}.md", "other"));
        assert!(check_note_edit_access(&state, "one", "/a", "é.md", "token", None).is_ok());
        assert!(check_note_edit_access(&state, "two", "/a", "é.md", "token", None).is_err());
        assert!(check_note_edit_access(&state, "one", "/a", "é.md", "old", None).is_err());
        state.acquire("two", "/a", "Destination.md", "other");
        assert!(check_note_edit_access(
            &state,
            "one",
            "/a",
            "é.md",
            "token",
            Some("destination.md")
        )
        .is_err());
        state.release_window_editors("one");
        assert!(check_note_edit_access(&state, "one", "/a", "é.md", "token", None).is_err());
        assert!(state.vaults.contains_key("one"));
        assert!(state.acquire("one", "/a", "é.md", "new"));
        state.release("one", "token");
        assert!(check_note_edit_access(&state, "one", "/a", "é.md", "new", None).is_ok());
    }
    #[test]
    fn cached_vault_selection_rejects_missing_or_redirected_folders() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("selected");
        std::fs::create_dir(&path).unwrap();
        let selected = vault::validate(&path).unwrap();
        assert!(revalidate_selection(Some(selected.clone())).is_ok());
        std::fs::remove_dir(&path).unwrap();
        assert!(revalidate_selection(Some(selected.clone())).is_err());
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), &path).unwrap();
        assert!(revalidate_selection(Some(selected)).is_err());
    }
}
