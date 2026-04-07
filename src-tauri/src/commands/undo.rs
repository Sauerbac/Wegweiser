use super::{emit_undo_state, AppStateHandle, UNDO_HISTORY_CAP};
use crate::session;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub fn undo_session(
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let session_to_emit = {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        let old_session = st.undo_history.pop().ok_or("Nothing to undo")?;
        // Push current session onto redo stack.
        if let Some(current) = st.session.clone() {
            st.redo_history.push(current);
        }
        st.session = Some(old_session.clone());
        if let Err(e) = session::save_session(&old_session) {
            eprintln!("[undo_session] save failed: {e}");
        }
        old_session
    };
    app_handle.emit("session-updated", &session_to_emit).map_err(|e| e.to_string())?;
    emit_undo_state(&state, &app_handle);
    Ok(())
}

#[tauri::command]
pub fn redo_session(
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let session_to_emit = {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        let next_session = st.redo_history.pop().ok_or("Nothing to redo")?;
        // Push current session onto undo stack (without clearing redo).
        if let Some(current) = st.session.clone() {
            if st.undo_history.len() >= UNDO_HISTORY_CAP {
                st.undo_history.remove(0);
            }
            st.undo_history.push(current);
        }
        st.session = Some(next_session.clone());
        if let Err(e) = session::save_session(&next_session) {
            eprintln!("[redo_session] save failed: {e}");
        }
        next_session
    };
    app_handle.emit("session-updated", &session_to_emit).map_err(|e| e.to_string())?;
    emit_undo_state(&state, &app_handle);
    Ok(())
}
