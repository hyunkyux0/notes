#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod vault;
mod vault_commands;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            vault_commands::get_vault,
            vault_commands::choose_vault,
        ])
        .run(tauri::generate_context!())
        .expect("Could not start Local Notes");
}
