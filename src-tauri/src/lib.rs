mod annotate;
mod capture;
mod commands;
mod export;
mod hooks;
mod model;
mod platform;
mod session;
mod state;

use capture::list_monitor_infos;
use state::AppState;
use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = Arc::new(Mutex::new(AppState::new()));

    // Populate monitor list at startup
    {
        let mut st = app_state.lock().unwrap_or_else(|e| e.into_inner());
        st.monitor_infos = list_monitor_infos();
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(app_state.clone())
        .setup(move |app| {
            let app_handle = app.handle().clone();
            hooks::spawn_hook_thread(app_handle.clone(), app_state.clone());

            // Register global shortcuts for pause (Ctrl+Shift+P) and stop (Ctrl+Shift+Q)
            hooks::register_global_hotkeys(&app_handle, app_state.clone())?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::export::list_monitors,
            commands::session::list_sessions,
            commands::recording::start_recording,
            commands::recording::stop_recording,
            commands::recording::pause_recording,
            commands::recording::resume_recording,
            commands::session::delete_step,
            commands::session::delete_steps,
            commands::session::update_step_description,
            commands::session::update_step_keystrokes,
            commands::session::set_step_export_choice,
            commands::session::load_session_cmd,
            commands::session::delete_session_cmd,
            commands::recording::new_recording,
            commands::recording::record_more,
            commands::image::get_step_image,
            commands::session::get_session,
            commands::export::export_markdown,
            commands::export::export_html,
            commands::export::open_path,
            commands::session::rename_session,
            commands::window::identify_monitors,
            commands::undo::undo_session,
            commands::undo::redo_session,
            commands::image::apply_image_edit,
            commands::image::save_annotations,
            commands::session::reorder_steps,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
