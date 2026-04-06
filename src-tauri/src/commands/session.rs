use super::{mutate_session, AppStateHandle};
use super::window::restore_window;
use crate::model::Session;
use crate::session::{self, SessionMeta};
use crate::state::RecordingState;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State, WebviewWindow};

#[tauri::command]
pub fn list_sessions() -> Vec<SessionMeta> {
    session::list_sessions(&session::sessions_base_dir())
}

#[tauri::command]
pub fn get_session(state: State<'_, AppStateHandle>) -> Option<Session> {
    state.lock().unwrap_or_else(|e| e.into_inner()).session.clone()
}

#[tauri::command]
pub fn load_session_cmd(
    session_dir: String,
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    let dir = PathBuf::from(&session_dir);

    // security-003: path confinement check — reject directories outside sessions base
    let canonical_dir = std::fs::canonicalize(&dir)
        .map_err(|_| "Invalid session directory".to_string())?;
    let canonical_base = std::fs::canonicalize(session::sessions_base_dir())
        .map_err(|_| "Sessions directory not found".to_string())?;
    if !canonical_dir.starts_with(&canonical_base) {
        return Err("Access denied: path is outside sessions directory".to_string());
    }

    let json_path = dir.join("session.json");
    let loaded = session::load_session(&json_path).map_err(|e| e.to_string())?;

    let (was_recording, restore_rect, was_maximized) = {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        let was_recording = st.recording_state == RecordingState::Recording
            || st.recording_state == RecordingState::Paused;
        st.session = Some(loaded.clone());
        st.recording_state = RecordingState::Reviewing;
        // Clear undo/redo when loading a session from the library.
        st.undo_history.clear();
        st.redo_history.clear();
        (was_recording, st.window_geometry.restore_rect.take(), st.window_geometry.maximized)
    };

    // Only restore window geometry if coming from mini-bar; otherwise preserve
    // the user's current window size.
    if was_recording {
        restore_window(&window, restore_rect, was_maximized);
    }

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
pub fn delete_step(
    step_id: usize,
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
) -> Result<(), String> {
    mutate_session(&state, &app_handle, true, |session| {
        session.steps.retain(|s| s.id != step_id);
        // Renumber orders
        for (i, step) in session.steps.iter_mut().enumerate() {
            step.order = i + 1;
        }
        Ok(())
    })
}

#[tauri::command]
pub fn delete_steps(
    step_ids: Vec<usize>,
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
) -> Result<(), String> {
    mutate_session(&state, &app_handle, true, |session| {
        let ids_set: std::collections::HashSet<usize> = step_ids.iter().copied().collect();
        session.steps.retain(|s| !ids_set.contains(&s.id));
        for (i, step) in session.steps.iter_mut().enumerate() {
            step.order = i + 1;
        }
        Ok(())
    })
}

#[tauri::command]
pub fn update_step_description(
    step_id: usize,
    description: String,
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
) -> Result<(), String> {
    // security-009: reject excessively long descriptions
    if description.len() > 65536 {
        return Err("Description is too long (max 64 KB)".to_string());
    }
    mutate_session(&state, &app_handle, true, |session| {
        if let Some(step) = session.steps.iter_mut().find(|s| s.id == step_id) {
            step.description = description;
        }
        Ok(())
    })
}

#[tauri::command]
pub fn update_step_keystrokes(
    step_id: usize,
    keystrokes: Option<String>,
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
) -> Result<(), String> {
    // Reject excessively long keystroke strings.
    if keystrokes.as_deref().map(|s| s.len()).unwrap_or(0) > 65536 {
        return Err("Keystrokes string is too long (max 64 KB)".to_string());
    }
    mutate_session(&state, &app_handle, true, |session| {
        if let Some(step) = session.steps.iter_mut().find(|s| s.id == step_id) {
            step.keystrokes = keystrokes;
        }
        Ok(())
    })
}

#[tauri::command]
pub fn set_step_export_choice(
    step_id: usize,
    choice: Vec<bool>,
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
) -> Result<(), String> {
    mutate_session(&state, &app_handle, true, |session| {
        if let Some(step) = session.steps.iter_mut().find(|s| s.id == step_id) {
            step.export_choice = choice;
        }
        Ok(())
    })
}

#[tauri::command]
pub fn rename_session(
    name: String,
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
) -> Result<(), String> {
    // security-009: reject excessively long session names
    if name.len() > 512 {
        return Err("Session name is too long (max 512 bytes)".to_string());
    }
    mutate_session(&state, &app_handle, true, |session| {
        session.name = name;
        Ok(())
    })
}

#[tauri::command]
pub fn reorder_steps(
    step_ids: Vec<usize>,
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
) -> Result<(), String> {
    mutate_session(&state, &app_handle, true, |session| {
        // Build a lookup: id → Step
        let mut step_map: std::collections::HashMap<usize, crate::model::Step> =
            session.steps.drain(..).map(|s| (s.id, s)).collect();
        // Re-insert in the requested order; ignore unknown IDs
        for (new_order, &id) in step_ids.iter().enumerate() {
            if let Some(mut step) = step_map.remove(&id) {
                step.order = new_order + 1;
                session.steps.push(step);
            }
        }
        // Append any steps not mentioned in step_ids (safety net)
        let mut extra: Vec<_> = step_map.into_values().collect();
        extra.sort_by_key(|s| s.order);
        for (i, mut s) in extra.into_iter().enumerate() {
            s.order = session.steps.len() + i + 1;
            session.steps.push(s);
        }
        Ok(())
    })
}
