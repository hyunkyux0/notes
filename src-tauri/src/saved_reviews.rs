//! SQLite is a schedule index; a receipt in the atomic Markdown save proves completion.
use crate::{
    notes::{self, Note},
    review_preferences,
};
use cap_std::fs::Dir;
use chrono::{DateTime, Utc};
use local_notes::review_schedule::calculate_reviews;
use rusqlite::{params, Connection, OptionalExtension};
use std::{path::Path, sync::Mutex};

static FIRST_SAVE: Mutex<()> = Mutex::new(());
const STORAGE_ERROR: &str =
    "Review storage is unavailable. Restore access and retry; your note and draft are retained.";

fn open(path: &Path) -> Result<Connection, String> {
    std::fs::create_dir_all(path.parent().ok_or(STORAGE_ERROR)?).map_err(|_| STORAGE_ERROR)?;
    let db = Connection::open(path).map_err(|_| STORAGE_ERROR)?;
    db.execute_batch(
        "PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS first_saves (
            vault TEXT NOT NULL, note_id TEXT NOT NULL, receipt TEXT NOT NULL,
            anchor TEXT NOT NULL, reviews TEXT, confirmed INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(vault, note_id));",
    )
    .map_err(|_| STORAGE_ERROR)?;
    Ok(db)
}

fn confirm(db: &Connection, receipt: &str) -> Result<(), String> {
    db.execute(
        "UPDATE first_saves SET confirmed=1 WHERE receipt=?1",
        [receipt],
    )
    .map_err(|_| STORAGE_ERROR)?;
    Ok(())
}

/// Reconcile an interrupted save only when the note contains its exact durable receipt.
fn recover(db: &Connection, vault: &str, note: &Note) -> Result<Option<String>, String> {
    let Some(id) = note.id else {
        return Ok(None);
    };
    let existing: Option<(String, bool)> = db
        .query_row(
            "SELECT receipt, confirmed FROM first_saves WHERE vault=?1 AND note_id=?2",
            params![vault, id.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|_| STORAGE_ERROR)?;
    let Some((receipt, confirmed)) = existing else {
        return Ok(None);
    };
    if confirmed {
        return Ok(Some(receipt));
    }
    if notes::first_save_receipt(note) == Some(receipt.as_str()) {
        confirm(db, &receipt)?;
        return Ok(Some(receipt));
    }
    // No commit receipt: the interrupted attempt never became this Markdown version.
    db.execute(
        "DELETE FROM first_saves WHERE vault=?1 AND note_id=?2 AND confirmed=0",
        params![vault, id.to_string()],
    )
    .map_err(|_| STORAGE_ERROR)?;
    Ok(None)
}

pub fn read(root: &Dir, vault: &str, filename: &str, database: &Path) -> Result<Note, String> {
    let _guard = FIRST_SAVE.lock().map_err(|_| STORAGE_ERROR)?;
    let mut note = notes::read(root, filename)?;
    if note.id.is_some() && notes::first_save_receipt(&note).is_some() {
        let recovery = if database.exists() {
            open(database).and_then(|db| recover(&db, vault, &note))
        } else {
            Ok(None)
        };
        note.review_warning = match recovery {
            Ok(Some(_)) => None,
            Ok(None) => Some("This note's review record is missing. Restore reviews.sqlite and reopen the note; dates will not be invented automatically.".into()),
            Err(error) => Some(error),
        };
    }
    Ok(note)
}

pub fn save(
    root: &Dir,
    vault: &str,
    filename: &str,
    expected: &str,
    body: &str,
    database: &Path,
    preferences: &Path,
    now: impl FnOnce() -> DateTime<Utc>,
) -> Result<Note, String> {
    let _guard = FIRST_SAVE.lock().map_err(|_| STORAGE_ERROR)?;
    let original = notes::read(root, filename)?;
    let Some(id) = original.id else {
        return notes::save(root, filename, expected, body);
    };
    let db = open(database)?;
    if let Some(receipt) = recover(&db, vault, &original)? {
        return notes::save_with_receipt(root, filename, expected, body, Some(&receipt));
    }
    // A receipt without its database is never grounds to silently invent a new schedule.
    if body.trim().is_empty() || notes::first_save_receipt(&original).is_some() {
        return notes::save(root, filename, expected, body);
    }
    let settings = review_preferences::configured(preferences)?;
    let now = now();
    let reviews = settings
        .map(|settings| {
            calculate_reviews(now, &settings)
                .map(|reviews| {
                    reviews
                        .into_iter()
                        .map(|review| {
                            serde_json::json!({"afterDays": review.after_days,
                "scheduledFor": review.scheduled_for.to_rfc3339(),
                "timezone": review.scheduled_for.timezone().name()})
                        })
                        .collect::<Vec<_>>()
                })
                .map_err(str::to_owned)
        })
        .transpose()?;
    let reviews = reviews
        .map(|value| serde_json::to_string(&value))
        .transpose()
        .map_err(|_| "Review dates could not be encoded.")?;
    let receipt = uuid::Uuid::new_v4().to_string();
    // Commit the intent before writing Markdown. A crash leaves either no receipt (retry
    // with a fresh anchor) or an exact receipt (confirm these original dates on reopen).
    db.execute(
        "INSERT INTO first_saves (vault,note_id,receipt,anchor,reviews) VALUES (?1,?2,?3,?4,?5)",
        params![vault, id.to_string(), receipt, now.to_rfc3339(), reviews],
    )
    .map_err(|_| STORAGE_ERROR)?;
    let saved = notes::save_with_receipt(root, filename, expected, body, Some(&receipt))?;
    confirm(&db, &receipt)?;
    Ok(saved)
}

#[cfg(test)]
#[path = "saved_reviews_tests.rs"]
mod tests;
