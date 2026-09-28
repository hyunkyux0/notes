//! The vault is a user-owned folder; only its location is stored in app settings.
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Vault {
    pub path: String,
}

pub(crate) fn validate(path: &Path) -> Result<Vault, String> {
    if !path.is_absolute() {
        return Err("Choose an absolute folder location.".into());
    }
    let canonical = path.canonicalize().map_err(|_| {
        "The notes folder is unavailable. Reconnect its drive or choose another folder.".to_string()
    })?;
    if !canonical.is_dir() {
        return Err("The selected location is not a folder.".into());
    }
    fs::read_dir(&canonical).map_err(|_| "The notes folder cannot be read. Check its permissions.")?;
    let path = canonical
        .to_str()
        .ok_or("The folder path must contain valid Unicode characters.")?
        .to_owned();
    Ok(Vault { path })
}

pub fn load(settings: &Path) -> Result<Option<Vault>, String> {
    let bytes = match fs::read(settings) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Saved vault settings could not be read.".into()),
    };
    let saved: Vault = serde_json::from_slice(&bytes)
        .map_err(|_| "Saved vault settings are invalid. Choose your notes folder again.")?;
    validate(Path::new(&saved.path)).map(Some)
}

pub fn select(settings: &Path, selected: Option<&Path>) -> Result<Option<Vault>, String> {
    let Some(selected) = selected else {
        return Ok(None); // Cancel must not erase or rewrite an existing selection.
    };
    let vault = validate(selected)?;
    crate::app_settings::write_json(settings, &vault)?;
    Ok(Some(vault))
}

#[cfg(test)]
#[path = "vault_tests.rs"]
mod tests;
