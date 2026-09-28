use super::*;
use cap_std::ambient_authority;
use std::fs;

struct Fixture {
    root: tempfile::TempDir,
    dir: Dir,
    database: std::path::PathBuf,
    settings: std::path::PathBuf,
    note: Note,
}
impl Fixture {
    fn new(configured: bool) -> Self {
        let root = tempfile::tempdir().unwrap();
        let dir = Dir::open_ambient_dir(root.path(), ambient_authority()).unwrap();
        let database = root.path().join("reviews.sqlite");
        let settings = root.path().join("settings.json");
        let note = notes::create(&dir, "", "Study").unwrap();
        let fixture = Self {
            root,
            dir,
            database,
            settings,
            note,
        };
        if configured {
            fixture.configure();
        }
        fixture
    }
    fn configure(&self) {
        fs::write(&self.settings, r#"{"preferences":{"intervals":[3,7,30],"alertTime":"09:00","timezone":"UTC"},"revision":"configured"}"#).unwrap();
    }
    fn save(&self, expected: &str, body: &str, day: u32) -> Result<Note, String> {
        save(
            &self.dir,
            "vault",
            &self.note.filename,
            expected,
            body,
            &self.database,
            &self.settings,
            || format!("2026-01-{day:02}T12:00:00Z").parse().unwrap(),
        )
    }
    fn record(&self) -> (String, Option<String>, bool) {
        open(&self.database)
            .unwrap()
            .query_row(
                "SELECT anchor,reviews,confirmed FROM first_saves",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap()
    }
}

#[test]
fn only_first_nonempty_save_schedules_and_moves_keep_the_same_record() {
    let f = Fixture::new(true);
    let empty = f.save(&f.note.content, " \n", 1).unwrap();
    assert_eq!(
        open(&f.database)
            .unwrap()
            .query_row("SELECT count(*) FROM first_saves", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    let saved = f.save(&empty.content, "Learning", 2).unwrap();
    assert_eq!(saved.id, f.note.id);
    assert_eq!(saved.content.split_once('\n').unwrap().1, "Learning");
    let record = f.record();
    let reviews: serde_json::Value = serde_json::from_str(record.1.as_ref().unwrap()).unwrap();
    assert_eq!(reviews[0]["scheduledFor"], "2026-01-05T09:00:00+00:00");
    assert_eq!(reviews.as_array().unwrap().len(), 3);
    assert!(record.2);
    // Invalid later settings cannot change an already recorded schedule or block edits.
    fs::write(&f.settings, "broken").unwrap();
    let saved = f.save(&saved.content, "More learning", 8).unwrap();
    fs::create_dir(f.root.path().join("folder")).unwrap();
    let moved =
        notes::rename(&f.dir, &saved.filename, "folder/Renamed.md", &saved.content).unwrap();
    let loaded = read(&f.dir, "vault", &moved.filename, &f.database).unwrap();
    assert_eq!(loaded.id, saved.id);
    assert_eq!(
        notes::first_save_receipt(&loaded),
        notes::first_save_receipt(&saved)
    );
    assert_eq!(f.record(), record);
}

#[test]
fn saves_before_configuration_stay_unscheduled_without_backdating() {
    let f = Fixture::new(false);
    let saved = f.save(&f.note.content, "Learning", 1).unwrap();
    let record = f.record();
    assert!(record.1.is_none());
    assert!(record.2);
    f.configure();
    f.save(&saved.content, "More learning", 8).unwrap();
    assert_eq!(f.record(), record);
}

#[test]
fn interrupted_confirmation_recovers_from_receipt_even_after_external_body_changes() {
    let f = Fixture::new(true);
    let db = open(&f.database).unwrap();
    db.execute_batch("CREATE TRIGGER fail_confirmation BEFORE UPDATE ON first_saves BEGIN SELECT RAISE(FAIL, 'injected'); END;").unwrap();
    assert!(f.save(&f.note.content, "Learning", 1).is_err());
    let disk = notes::read(&f.dir, &f.note.filename).unwrap();
    assert_eq!(disk.content.split_once('\n').unwrap().1, "Learning");
    assert!(!f.record().2);
    db.execute_batch("DROP TRIGGER fail_confirmation").unwrap();
    // A fresh connection simulates reopening after restart. Receipt, not body hash, is proof.
    notes::save(&f.dir, &disk.filename, &disk.content, "External body edit").unwrap();
    read(&f.dir, "vault", &disk.filename, &f.database).unwrap();
    assert!(f.record().2);
    assert_eq!(f.record().0, "2026-01-01T12:00:00+00:00");
}

#[test]
fn lost_response_retry_uses_original_receipt_and_preserves_newer_draft() {
    let f = Fixture::new(true);
    f.save(&f.note.content, "Learning", 1).unwrap();
    let record = f.record();
    let retried = f.save(&f.note.content, "Learning", 8).unwrap();
    f.save(&retried.content, "Newer draft", 9).unwrap();
    assert_eq!(f.record(), record);
}

#[test]
fn failed_or_conflicting_markdown_writes_do_not_confirm_or_backdate_reviews() {
    let f = Fixture::new(true);
    let disk = notes::save(&f.dir, &f.note.filename, &f.note.content, "External edit").unwrap();
    assert!(f.save(&f.note.content, "Learning", 1).is_err());
    assert!(!f.record().2);
    assert_eq!(
        notes::read(&f.dir, &disk.filename).unwrap().content,
        disk.content
    );
    let path = f.root.path().join(&disk.filename);
    let permissions = fs::metadata(&path).unwrap().permissions();
    let mut readonly = permissions.clone();
    readonly.set_readonly(true);
    fs::set_permissions(&path, readonly).unwrap();
    assert!(f.save(&disk.content, "Learning", 2).is_err());
    assert!(!f.record().2);
    fs::set_permissions(&path, permissions).unwrap();
    let saved = f.save(&disk.content, "Learning", 8).unwrap();
    assert!(notes::first_save_receipt(&saved).is_some());
    assert_eq!(f.record().0, "2026-01-08T12:00:00+00:00");
}

#[test]
fn unavailable_database_or_invalid_initial_settings_leave_markdown_untouched() {
    let f = Fixture::new(true);
    fs::write(&f.database, "not sqlite").unwrap();
    assert!(f.save(&f.note.content, "Learning", 1).is_err());
    fs::remove_file(&f.database).unwrap();
    fs::write(&f.settings, "invalid").unwrap();
    assert!(f.save(&f.note.content, "Learning", 1).is_err());
    assert_eq!(
        notes::read(&f.dir, &f.note.filename).unwrap().content,
        f.note.content
    );
}

#[test]
fn simultaneous_window_retries_create_one_immutable_record() {
    let f = Fixture::new(true);
    std::thread::scope(|scope| {
        let a = scope.spawn(|| f.save(&f.note.content, "Learning", 1));
        let b = scope.spawn(|| f.save(&f.note.content, "Learning", 2));
        assert_eq!(
            a.join().unwrap().unwrap().content,
            b.join().unwrap().unwrap().content
        );
    });
    assert!(f.record().2);
    assert_eq!(
        open(&f.database)
            .unwrap()
            .query_row("SELECT count(*) FROM first_saves", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
}

#[test]
fn missing_ids_and_foreign_receipts_do_not_get_fabricated_schedules() {
    let f = Fixture::new(true);
    fs::write(f.root.path().join("external.md"), "Original").unwrap();
    let external = save(
        &f.dir,
        "vault",
        "external.md",
        "Original",
        "Edited",
        &f.database,
        &f.settings,
        || "2026-01-01T00:00:00Z".parse().unwrap(),
    )
    .unwrap();
    assert!(external.id.is_none());
    let receipt = uuid::Uuid::new_v4().to_string();
    let imported = notes::save_with_receipt(
        &f.dir,
        &f.note.filename,
        &f.note.content,
        "Imported",
        Some(&receipt),
    )
    .unwrap();
    f.save(&imported.content, "Edited import", 1).unwrap();
    assert_eq!(
        open(&f.database)
            .unwrap()
            .query_row("SELECT count(*) FROM first_saves", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn review_database_damage_does_not_hide_markdown() {
    let f = Fixture::new(true);
    let saved = f.save(&f.note.content, "Learning", 1).unwrap();
    fs::write(&f.database, "damaged database").unwrap();
    let loaded = read(&f.dir, "vault", &saved.filename, &f.database).unwrap();
    assert_eq!(loaded.content, saved.content);
    assert!(loaded.review_warning.is_some());
}
