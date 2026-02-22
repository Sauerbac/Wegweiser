use crate::capture::list_monitor_infos;
use crate::model::Session;
use crate::session::{self, SessionMeta};
use crate::state::{AppState, RecordingState};
use base64::Engine;
use chrono::Utc;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow};
use uuid::Uuid;

type AppStateHandle = Arc<Mutex<AppState>>;

#[tauri::command]
pub fn list_monitors(state: State<'_, AppStateHandle>) -> Vec<crate::model::MonitorInfo> {
    state.lock().unwrap().monitor_infos.clone()
}

#[tauri::command]
pub fn list_sessions() -> Vec<SessionMeta> {
    session::list_sessions(&session::sessions_base_dir())
}

#[tauri::command]
pub fn start_recording(
    monitor_index: Option<usize>,
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    // Create session directory
    let session_dir = session::create_session_dir().map_err(|e| e.to_string())?;
    let now = Utc::now();
    let session_name = format!("Recording {}", now.format("%Y-%m-%d %H:%M"));

    let new_session = Session {
        id: Uuid::new_v4().to_string(),
        name: session_name,
        created_at: now,
        monitor_index,
        steps: Vec::new(),
        session_dir,
        exported: false,
    };

    {
        let mut st = state.lock().unwrap();
        st.session = Some(new_session.clone());
        st.selected_monitor = monitor_index;
        st.recording_state = RecordingState::Recording;
        st.next_step_id = 1;
        st.pending_keystrokes.clear();
        // Refresh monitor infos
        st.monitor_infos = list_monitor_infos();
    }

    // Morph window to mini-bar: 380×64, borderless, always-on-top
    let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize { width: 380, height: 64 }));
    let _ = window.set_decorations(false);
    let _ = window.set_always_on_top(true);

    // Position at top-center of the active monitor (where mouse is currently)
    let infos = {
        let st = state.lock().unwrap();
        st.monitor_infos.clone()
    };

    // Use selected monitor or primary monitor (index 0) as fallback
    let monitor_idx = monitor_index.unwrap_or(0);
    if let Some(monitor) = infos.get(monitor_idx) {
        let window_width = 380i32;
        let x = monitor.x + (monitor.width as i32 - window_width) / 2;
        let y = monitor.y;
        let _ = window.set_position(tauri::LogicalPosition { x: x as f64, y: y as f64 });
    }

    // Record mini-bar window position for self-click filtering
    if let Ok(pos) = window.outer_position() {
        let mut st = state.lock().unwrap();
        st.rec_window_bounds = Some((pos.x, pos.y, 380, 64));
    }

    app_handle
        .emit("recording-state-changed", RecordingState::Recording)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn stop_recording(
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    {
        let mut st = state.lock().unwrap();
        if st.recording_state != RecordingState::Recording
            && st.recording_state != RecordingState::Paused
        {
            return Ok(());
        }
        st.recording_state = RecordingState::Reviewing;
        st.rec_window_bounds = None;
        if let Some(ref session) = st.session {
            let _ = session::save_session(session);
        }
    }

    // Restore full window
    let _ = window.set_always_on_top(false);
    let _ = window.set_decorations(true);
    let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize { width: 900, height: 650 }));

    app_handle
        .emit("recording-state-changed", RecordingState::Reviewing)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn pause_recording(
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
) -> Result<(), String> {
    {
        let mut st = state.lock().unwrap();
        if st.recording_state == RecordingState::Recording {
            st.recording_state = RecordingState::Paused;
        }
    }
    app_handle
        .emit("recording-state-changed", RecordingState::Paused)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn resume_recording(
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
) -> Result<(), String> {
    {
        let mut st = state.lock().unwrap();
        if st.recording_state == RecordingState::Paused {
            st.recording_state = RecordingState::Recording;
        }
    }
    app_handle
        .emit("recording-state-changed", RecordingState::Recording)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_step(
    step_id: usize,
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
) -> Result<(), String> {
    {
        let mut st = state.lock().unwrap();
        if let Some(ref mut session) = st.session {
            session.steps.retain(|s| s.id != step_id);
            // Renumber orders
            for (i, step) in session.steps.iter_mut().enumerate() {
                step.order = i + 1;
            }
            let _ = session::save_session(session);
        }
    }

    let session = {
        let st = state.lock().unwrap();
        st.session.clone()
    };
    if let Some(s) = session {
        app_handle.emit("session-updated", &s).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn update_step_description(
    step_id: usize,
    description: String,
    state: State<'_, AppStateHandle>,
) -> Result<(), String> {
    let mut st = state.lock().unwrap();
    if let Some(ref mut session) = st.session {
        if let Some(step) = session.steps.iter_mut().find(|s| s.id == step_id) {
            step.description = description;
        }
        let _ = session::save_session(session);
    }
    Ok(())
}

#[tauri::command]
pub fn load_session_cmd(
    session_dir: String,
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    let dir = PathBuf::from(&session_dir);
    let json_path = dir.join("session.json");
    let loaded = session::load_session(&json_path).map_err(|e| e.to_string())?;

    {
        let mut st = state.lock().unwrap();
        st.session = Some(loaded.clone());
        st.recording_state = RecordingState::Reviewing;
    }

    // Restore full window (in case coming from mini-bar)
    let _ = window.set_always_on_top(false);
    let _ = window.set_decorations(true);
    let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize { width: 900, height: 650 }));

    app_handle
        .emit("recording-state-changed", RecordingState::Reviewing)
        .map_err(|e| e.to_string())?;
    app_handle
        .emit("session-updated", &loaded)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_session_cmd(session_dir: String) -> Result<(), String> {
    let dir = PathBuf::from(&session_dir);
    session::delete_session(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn new_recording(
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    {
        let mut st = state.lock().unwrap();
        st.recording_state = RecordingState::Idle;
        st.session = None;
        st.rec_window_bounds = None;
    }

    // Restore full window
    let _ = window.set_always_on_top(false);
    let _ = window.set_decorations(true);
    let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize { width: 900, height: 650 }));

    app_handle
        .emit("recording-state-changed", RecordingState::Idle)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_step_image(image_path: String) -> Result<String, String> {
    let path = std::path::Path::new(&image_path);
    let base_dir = session::sessions_base_dir();

    // Canonicalize the requested path and the base directory
    let canonical_path = std::fs::canonicalize(path)
        .map_err(|_| "Invalid file path".to_string())?;
    let canonical_base = std::fs::canonicalize(&base_dir)
        .map_err(|_| "Sessions directory not found".to_string())?;

    // Ensure the requested path is within the sessions base directory
    if !canonical_path.starts_with(&canonical_base) {
        return Err("Access denied: path is outside sessions directory".to_string());
    }

    // Verify the file has a .png extension
    if !canonical_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("png"))
        .unwrap_or(false)
    {
        return Err("Only PNG files are allowed".to_string());
    }

    let bytes = std::fs::read(&canonical_path).map_err(|e| e.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/png;base64,{}", b64))
}

#[tauri::command]
pub fn get_session(state: State<'_, AppStateHandle>) -> Option<Session> {
    state.lock().unwrap().session.clone()
}

#[tauri::command]
pub fn export_markdown(
    output_dir: String,
    state: State<'_, AppStateHandle>,
) -> Result<String, String> {
    let session = {
        let st = state.lock().unwrap();
        st.session.clone().ok_or("No active session")?
    };
    let dir = PathBuf::from(&output_dir);
    let output_path = dir.join(format!("{}.md", sanitize_filename(&session.name)));
    crate::export::markdown::export(&session, &output_path).map_err(|e| e.to_string())?;

    // Mark session as exported
    {
        let mut st = state.lock().unwrap();
        if let Some(ref mut s) = st.session {
            s.exported = true;
            let _ = session::save_session(s);
        }
    }

    Ok(output_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn export_html(
    output_path: String,
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let session = {
        let st = state.lock().unwrap();
        st.session.clone().ok_or("No active session")?
    };
    let path = PathBuf::from(&output_path);

    std::thread::spawn(move || {
        match crate::export::html::export(&session, &path, Some(&app_handle)) {
            Ok(()) => {
                let _ = app_handle.emit("export-done", &output_path);
            }
            Err(e) => {
                let _ = app_handle.emit("export-error", e.to_string());
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn identify_monitors(app_handle: AppHandle) -> Result<(), String> {
    let infos = crate::capture::list_monitor_infos();

    for (index, info) in infos.iter().enumerate() {
        let window_label = format!("identify_{}", index);
        let app_clone = app_handle.clone();
        let width = info.width as f64;
        let height = info.height as f64;
        let x = info.x as f64;
        let y = info.y as f64;

        // Close any existing identify window for this monitor
        if let Some(existing) = app_handle.get_webview_window(&window_label) {
            let _ = existing.destroy();
        }

        // Small badge at bottom-left of this monitor
        let badge_w = 120.0f64;
        let badge_h = 76.0f64;
        let margin = 24.0f64;
        let badge_x = info.x as f64 + margin;
        let badge_y = info.y as f64 + info.height as f64 - badge_h - margin;

        let label_clone = window_label.clone();
        std::thread::spawn(move || {
            let url = WebviewUrl::App(format!("identify?monitor={}", index).into());
            let result = tauri::WebviewWindowBuilder::new(&app_clone, &label_clone, url)
                .title(format!("Monitor {}", index + 1))
                .inner_size(badge_w, badge_h)
                .position(badge_x, badge_y)
                .resizable(false)
                .decorations(false)
                .transparent(true)
                .always_on_top(true)
                .visible(false)          // hidden until page signals ready → no flash
                .build();

            if result.is_ok() {
                std::thread::sleep(std::time::Duration::from_secs(3));
                if let Some(w) = app_clone.get_webview_window(&label_clone) {
                    let _ = w.destroy();
                }
            }
        });
    }

    Ok(())
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}
