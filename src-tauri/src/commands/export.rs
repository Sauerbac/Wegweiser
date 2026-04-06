use super::{normalize_path_for_frontend, AppStateHandle};
use crate::session;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub fn list_monitors(state: State<'_, AppStateHandle>) -> Vec<crate::model::MonitorInfo> {
    state.lock().unwrap_or_else(|e| e.into_inner()).monitor_infos.clone()
}

#[tauri::command]
pub fn export_markdown(
    output_path: String,
    state: State<'_, AppStateHandle>,
) -> Result<String, String> {
    // security-004: reject paths containing null bytes
    if output_path.contains('\0') {
        return Err("Invalid output path".to_string());
    }
    let session = {
        let st = state.lock().unwrap_or_else(|e| e.into_inner());
        st.session.clone().ok_or("No active session")?
    };
    let path = PathBuf::from(&output_path);
    crate::export::markdown::export(&session, &path).map_err(|e| e.to_string())?;

    // Mark session as exported
    {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(ref mut s) = st.session {
            s.exported = true;
            if let Err(e) = session::save_session(s) {
                eprintln!("[save_session] failed: {e}");
            }
        }
    }

    Ok(normalize_path_for_frontend(&output_path))
}

#[tauri::command]
pub fn export_html(
    output_path: String,
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
) -> Result<(), String> {
    // security-004: reject paths containing null bytes
    if output_path.contains('\0') {
        return Err("Invalid output path".to_string());
    }
    let session = {
        let st = state.lock().unwrap_or_else(|e| e.into_inner());
        st.session.clone().ok_or("No active session")?
    };
    let path = PathBuf::from(&output_path);

    std::thread::spawn(move || {
        let on_progress = {
            let handle = app_handle.clone();
            move |progress: f32| {
                let _ = handle.emit("export-progress", progress);
            }
        };
        match crate::export::html::export(&session, &path, Some(on_progress)) {
            Ok(()) => {
                let normalized = normalize_path_for_frontend(&output_path);
                let _ = app_handle.emit("export-done", &normalized);
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
    // security-002: reject non-filesystem URI schemes
    let lower = path.to_lowercase();
    for scheme in &["javascript:", "data:", "vbscript:", "cmd:", "powershell:"] {
        if lower.starts_with(scheme) {
            return Err(format!("Rejected: '{}' scheme is not allowed", scheme));
        }
    }
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string())
}
