//! App-wide review preferences. Saving these does not create or reset note schedules.
use local_notes::review_schedule::{ReviewSettings, DEFAULT_INTERVALS};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path, sync::Mutex};
use tauri::AppHandle;

static SETTINGS_WRITE: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    intervals: Vec<u32>,
    alert_time: String,
    timezone: String,
}
impl Preferences {
    fn validate(&self) -> Result<(), String> {
        ReviewSettings::new(self.intervals.clone(), &self.alert_time, &self.timezone)
            .map(|_| ())
            .map_err(str::to_owned)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Snapshot {
    preferences: Preferences,
    revision: Option<String>,
}

fn load(path: &Path) -> Result<Snapshot, String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Snapshot {
                preferences: Preferences {
                    intervals: DEFAULT_INTERVALS.to_vec(),
                    alert_time: "09:00".into(),
                    timezone: "UTC".into(),
                },
                revision: None,
            })
        }
        Err(_) => {
            return Err("Review settings could not be read. Check permissions and retry.".into())
        }
    };
    let saved: Snapshot = serde_json::from_slice(&bytes).map_err(|_| {
        "Saved review settings are damaged. Restore review-settings.json and retry."
    })?;
    saved.preferences.validate()?;
    if saved.revision.as_deref().is_none_or(str::is_empty) {
        return Err(
            "Saved review settings have no revision. Restore review-settings.json and retry."
                .into(),
        );
    }
    Ok(saved)
}

fn save(
    path: &Path,
    preferences: Preferences,
    expected_revision: Option<String>,
) -> Result<Snapshot, String> {
    preferences.validate()?;
    // Serialize comparison and replacement across all app windows.
    let _guard = SETTINGS_WRITE
        .lock()
        .map_err(|_| "Review settings are busy. Restart the app.")?;
    if load(path)?.revision != expected_revision {
        return Err(
            "Review settings changed in another window. Reload saved settings before saving."
                .into(),
        );
    }
    let saved = Snapshot {
        preferences,
        revision: Some(uuid::Uuid::new_v4().to_string()),
    };
    crate::app_settings::write_json(path, &saved)?;
    Ok(saved)
}

#[tauri::command]
pub async fn get_review_settings(app: AppHandle) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        load(&crate::app_settings::settings_path(&app)?.with_file_name("review-settings.json"))
    })
    .await
    .map_err(|_| "Loading review settings was interrupted.")?
}

#[tauri::command]
pub async fn save_review_settings(
    app: AppHandle,
    preferences: Preferences,
    expected_revision: Option<String>,
) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        save(
            &crate::app_settings::settings_path(&app)?.with_file_name("review-settings.json"),
            preferences,
            expected_revision,
        )
    })
    .await
    .map_err(|_| "Saving review settings was interrupted.")?
}

#[cfg(test)]
#[path = "review_preferences_tests.rs"]
mod tests;
