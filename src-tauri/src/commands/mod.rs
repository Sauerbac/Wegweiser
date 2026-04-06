pub mod export;
pub mod image;
pub mod recording;
pub mod session;
pub mod undo;
pub mod window;

// Re-export used by hooks.rs (cross-crate helper, not a Tauri command).
pub use recording::perform_stop_recording;

use std::sync::{Arc, Mutex};
use crate::state::AppState;
use crate::model::{Session, UndoState};
use tauri::{AppHandle, Emitter};

pub type AppStateHandle = Arc<Mutex<AppState>>;

/// Width of the recording mini-bar window in physical pixels.
pub(super) const MINIBAR_WIDTH: u32 = 380;
/// Height of the recording mini-bar window in logical pixels.
pub(super) const MINIBAR_HEIGHT: u32 = 40;
/// Fallback window restore position and size used when no saved geometry is available.
pub const DEFAULT_RESTORE_RECT: (i32, i32, u32, u32) = (100, 100, 900, 650);

/// Width of a monitor-identification badge window in logical pixels.
pub(super) const BADGE_WIDTH: f64 = 120.0;
/// Height of a monitor-identification badge window in logical pixels.
pub(super) const BADGE_HEIGHT: f64 = 76.0;
/// Margin from the screen edge for badge windows in logical pixels.
pub(super) const BADGE_MARGIN: f64 = 24.0;
/// How long (in seconds) each identification badge window stays visible.
pub(super) const BADGE_DISPLAY_SECS: u64 = 3;

/// Normalize a filesystem path to forward slashes for consistent frontend display.
pub(super) fn normalize_path_for_frontend(path: &str) -> String {
    path.replace('\\', "/")
}

/// Push a snapshot of the current session onto the undo stack and clear redo.
/// Caps history at 50 entries (oldest dropped first).
pub(super) fn push_undo(st: &mut AppState) {
    if let Some(ref session) = st.session {
        if st.undo_history.len() >= 50 {
            st.undo_history.remove(0);
        }
        st.undo_history.push(session.clone());
        st.redo_history.clear();
    }
}

/// Emit an `undo-state-changed` event reflecting the current stack depths.
/// Acquires the state lock internally — call this **after** releasing any other
/// lock on the same state to avoid deadlocks.
pub(super) fn emit_undo_state(state: &AppStateHandle, app_handle: &AppHandle) {
    let (can_undo, can_redo) = {
        let st = state.lock().unwrap_or_else(|e| e.into_inner());
        (!st.undo_history.is_empty(), !st.redo_history.is_empty())
    };
    let _ = app_handle.emit("undo-state-changed", UndoState { can_undo, can_redo });
}

/// Apply a mutation to the active session, persist it, emit `session-updated`,
/// and emit `undo-state-changed`. The closure receives a `&mut Session` and
/// returns `Ok(())` or an error string; on `Err` the state is still saved if
/// the session exists (the closure should bail early in that case).
///
/// The undo snapshot is pushed **before** the mutation so the previous state
/// can be restored. Pass `push_undo_before = false` for read-only style
/// mutations that should not be undoable (currently unused, kept for clarity).
pub(super) fn mutate_session<F>(
    state: &AppStateHandle,
    app_handle: &AppHandle,
    push_undo_before: bool,
    f: F,
) -> Result<(), String>
where
    F: FnOnce(&mut Session) -> Result<(), String>,
{
    let session = {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        if push_undo_before {
            push_undo(&mut st);
        }
        if let Some(ref mut session) = st.session {
            f(session)?;
            if let Err(e) = crate::session::save_session(session) {
                eprintln!("[save_session] failed: {e}");
            }
        }
        st.session.clone()
    };
    if let Some(s) = session {
        app_handle.emit("session-updated", &s).map_err(|e| e.to_string())?;
    }
    emit_undo_state(state, app_handle);
    Ok(())
}
