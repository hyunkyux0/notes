#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_settings;
mod note_commands;
mod notes;
mod vault;
mod vault_commands;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            note_commands::list_notes,
            note_commands::read_note,
            note_commands::save_note,
            note_commands::rename_note,
            note_commands::create_note,
            vault_commands::get_vault,
            vault_commands::choose_vault,
        ])
        .run(tauri::generate_context!())
        .expect("Could not start Local Notes");
}
