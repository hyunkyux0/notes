use super::*;

#[test]
fn missing_settings_means_no_vault() {
    let root = tempfile::tempdir().unwrap();
    assert_eq!(load(&root.path().join("vault.json")).unwrap(), None);
}

#[test]
fn selection_survives_reload_and_can_be_changed() {
    let root = tempfile::tempdir().unwrap();
    let settings = root.path().join("config/vault.json");
    for name in ["first", "second"] {
        let folder = root.path().join(name);
        fs::create_dir(&folder).unwrap();
        let selected = select(&settings, Some(&folder)).unwrap();
        assert_eq!(load(&settings).unwrap(), selected);
        assert_eq!(
            selected.unwrap().path,
            folder.canonicalize().unwrap().to_str().unwrap()
        );
        assert_eq!(fs::read_dir(&folder).unwrap().count(), 0);
    }
}

#[test]
fn cancel_and_invalid_selection_preserve_previous_settings() {
    let root = tempfile::tempdir().unwrap();
    let settings = root.path().join("config/vault.json");
    select(&settings, Some(root.path())).unwrap();
    let original = fs::read(&settings).unwrap();
    assert_eq!(select(&settings, None).unwrap(), None);
    assert_eq!(fs::read(&settings).unwrap(), original);
    for bad in [Path::new("relative"), &settings, &root.path().join("missing")] {
        assert!(select(&settings, Some(bad)).is_err());
        assert_eq!(fs::read(&settings).unwrap(), original);
    }
}

#[test]
fn missing_saved_folder_is_reported_without_erasing_settings() {
    let root = tempfile::tempdir().unwrap();
    let folder = root.path().join("notes");
    let settings = root.path().join("vault.json");
    fs::create_dir(&folder).unwrap();
    select(&settings, Some(&folder)).unwrap();
    fs::remove_dir(&folder).unwrap();
    assert!(load(&settings).is_err());
    assert!(settings.exists());
}

#[test]
fn corrupt_settings_can_be_recovered_by_selecting_again() {
    let root = tempfile::tempdir().unwrap();
    let settings = root.path().join("vault.json");
    fs::write(&settings, "{broken").unwrap();
    assert!(load(&settings).is_err());
    assert_eq!(select(&settings, None).unwrap(), None);
    assert_eq!(fs::read_to_string(&settings).unwrap(), "{broken");
    select(&settings, Some(root.path())).unwrap();
    assert!(load(&settings).unwrap().is_some());
}

#[test]
fn failed_replacement_keeps_destination_and_cleans_temporary_file() {
    let root = tempfile::tempdir().unwrap();
    let settings = root.path().join("vault.json");
    fs::create_dir(&settings).unwrap();
    fs::write(settings.join("keep"), "untouched").unwrap();
    assert!(select(&settings, Some(root.path())).is_err());
    assert_eq!(
        fs::read_to_string(settings.join("keep")).unwrap(),
        "untouched"
    );
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
}

#[cfg(unix)]
#[test]
fn symlink_selection_is_stored_as_canonical_folder() {
    let root = tempfile::tempdir().unwrap();
    let folder = root.path().join("notes");
    let link = root.path().join("shortcut");
    fs::create_dir(&folder).unwrap();
    std::os::unix::fs::symlink(&folder, &link).unwrap();
    let saved = select(&root.path().join("vault.json"), Some(&link))
        .unwrap()
        .unwrap();
    assert_eq!(saved.path, folder.canonicalize().unwrap().to_str().unwrap());
}
