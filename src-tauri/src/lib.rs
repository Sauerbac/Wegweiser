mod annotate;
mod capture;
mod commands;
mod export;
mod hooks;
mod model;
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
        let mut st = app_state.lock().unwrap();
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
            commands::list_monitors,
            commands::list_sessions,
            commands::start_recording,
            commands::stop_recording,
            commands::pause_recording,
            commands::resume_recording,
            commands::delete_step,
            commands::update_step_description,
            commands::set_step_export_choice,
            commands::load_session_cmd,
            commands::delete_session_cmd,
            commands::new_recording,
            commands::get_step_image,
            commands::get_session,
            commands::export_markdown,
            commands::export_html,
            commands::open_path,
            commands::identify_monitors,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
