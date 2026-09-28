#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_settings;
mod note_commands;
mod notes;
mod review_preferences;
mod vault;
mod vault_commands;
mod windows;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

fn main() {
    tauri::Builder::default()
        .manage(windows::Workspaces::default())
        .menu(|app| {
            let menu = tauri::menu::Menu::default(app)?;
            for item in menu.items()? {
                if let Some(submenu) = item.as_submenu() {
                    if submenu.text()? == "File" {
                        submenu.prepend(&tauri::menu::MenuItem::with_id(
                            app,
                            "new-window",
                            "New Window",
                            true,
                            Some("CmdOrCtrl+N"),
                        )?)?;
                    }
                }
            }
            Ok(menu)
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "new-window" {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = windows::new_window(app.clone()).await {
                        app.dialog().message(error).show(|_| {});
                    }
                });
            }
        })
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                if let Ok(mut state) = webview.state::<windows::Workspaces>().lock() {
                    state.release_window_editors(webview.label());
                }
            }
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Ok(mut state) = window.state::<windows::Workspaces>().lock() {
                    state.close_window(window.label());
                }
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            review_preferences::get_review_settings,
            review_preferences::save_review_settings,
            windows::new_window,
            windows::acquire_note,
            windows::release_note,
            note_commands::list_vault_contents,
            note_commands::read_note,
            note_commands::save_note,
            note_commands::rename_note,
            note_commands::create_note,
            note_commands::create_folder,
            note_commands::import_note_image,
            note_commands::read_note_image,
            vault_commands::get_vault,
            vault_commands::choose_vault,
        ])
        .run(tauri::generate_context!())
        .expect("Could not start Local Notes");
}
