use super::*;

#[test]
fn defaults_are_not_persisted_until_saved_and_survive_a_reload() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("settings.json");
    let defaults = load(&path).unwrap();
    assert_eq!(defaults.preferences.intervals, vec![3, 7, 30]);
    assert!(!path.exists());
    let mut preferences = defaults.preferences;
    preferences.timezone = "Asia/Hong_Kong".into();
    preferences.alert_time = "18:30".into();
    let saved = save(&path, preferences, None).unwrap();
    assert_eq!(load(&path).unwrap(), saved);
}

#[test]
fn invalid_values_and_stale_windows_preserve_the_last_valid_file() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("settings.json");
    let saved = save(&path, load(&path).unwrap().preferences, None).unwrap();
    let before = fs::read(&path).unwrap();
    for preferences in [
        Preferences {
            intervals: vec![3, 3],
            ..saved.preferences.clone()
        },
        Preferences {
            alert_time: "25:00".into(),
            ..saved.preferences.clone()
        },
        Preferences {
            timezone: "invalid".into(),
            ..saved.preferences.clone()
        },
    ] {
        assert!(save(&path, preferences, saved.revision.clone()).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
    }
    assert!(save(&path, saved.preferences.clone(), None)
        .unwrap_err()
        .contains("another window"));
    let newer = save(&path, saved.preferences.clone(), saved.revision.clone()).unwrap();
    assert!(save(&path, saved.preferences, saved.revision).is_err());
    assert_eq!(load(&path).unwrap(), newer);
}

#[test]
fn corrupt_or_unreadable_settings_are_not_silently_overwritten() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("settings.json");
    let defaults = load(&path).unwrap().preferences;
    fs::write(&path, b"broken json").unwrap();
    assert!(load(&path).is_err());
    assert!(save(&path, defaults.clone(), None).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"broken json");
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    assert!(save(&path, defaults, None).is_err());
    assert!(path.is_dir());
}

#[test]
fn concurrent_windows_cannot_both_replace_the_same_revision() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("settings.json");
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let threads: Vec<_> = ["10:00", "11:00"]
        .into_iter()
        .map(|time| {
            let path = path.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let mut preferences = load(&path).unwrap().preferences;
                preferences.alert_time = time.into();
                barrier.wait();
                save(&path, preferences, None)
            })
        })
        .collect();
    let results: Vec<_> = threads
        .into_iter()
        .map(|thread| thread.join().unwrap())
        .collect();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    let winner = results.into_iter().find_map(Result::ok).unwrap();
    assert_eq!(load(&path).unwrap(), winner);
}
