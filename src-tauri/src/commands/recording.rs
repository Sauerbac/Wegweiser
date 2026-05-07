use super::AppStateHandle;
use super::window::{apply_minibar_morph, restore_window, save_window_geometry};
use crate::capture::{capture_step, list_monitor_infos};
use crate::model::Session;
use crate::session;
use crate::state::{AppState, RecordingState};
use chrono::Local;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use uuid::Uuid;

/// Construct a new Session value for the given monitor selection.
///
/// Does not touch any filesystem or AppState — callers are responsible for
/// calling `session::create_session_dir()` beforehand and storing the result
/// in AppState afterwards.
pub(super) fn build_session(monitor_index: Option<usize>, session_dir: PathBuf) -> Session {
    let now_local = Local::now();
    let session_name = format!("Recording {}", now_local.format("%Y-%m-%d %H-%M"));
    let now_utc = now_local.with_timezone(&chrono::Utc);
    Session {
        id: Uuid::new_v4().to_string(),
        name: session_name,
        created_at: now_utc,
        monitor_index,
        steps: Vec::new(),
        session_dir,
        exported: false,
    }
}

#[tauri::command]
pub fn start_recording(
    monitor_index: Option<usize>,
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    // Create session directory and construct a new Session value.
    let session_dir = session::create_session_dir().map_err(|e| e.to_string())?;
    let new_session = build_session(monitor_index, session_dir);

    {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        st.session = Some(new_session.clone());
        st.selected_monitor = monitor_index;
        st.recording_state = RecordingState::Recording;
        st.next_step_id = 1;
        st.next_order = 1;
        st.pending_keystrokes.clear();
        // Clear undo/redo history for the new recording.
        st.undo_history.clear();
        st.redo_history.clear();
        // Refresh monitor infos
        st.monitor_infos = list_monitor_infos();
    }

    // Save current geometry so we can restore it after recording stops.
    save_window_geometry(&window, &state);

    // Morph window to mini-bar and position it at the top-center of the selected monitor.
    // Use selected monitor or primary monitor (index 0) as fallback.
    let monitor_idx = monitor_index.unwrap_or(0);
    apply_minibar_morph(&window, &state, monitor_idx);

    app_handle
        .emit("recording-state-changed", RecordingState::Recording)
        .map_err(|e| e.to_string())?;

    app_handle
        .emit("session-updated", &new_session)
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Capture a keystroke-only step when stopping a recording with pending keystrokes.
///
/// Called by `perform_stop_recording` to avoid duplicating the
/// capture + push + save + emit logic at each call site.
///
/// Returns the updated `Session` on success, or the original `current_session` on error.
fn capture_pending_keystrokes_step(
    state: &Arc<Mutex<AppState>>,
    app_handle: &AppHandle,
    pending_ks: String,
    step_id: usize,
    order: usize,
    current_session: Option<crate::model::Session>,
    monitor_index: Option<usize>,
    all_monitors: bool,
) -> Option<crate::model::Session> {
    let sess = match current_session {
        Some(ref s) => s,
        None => return current_session,
    };
    let mon_idx = monitor_index.unwrap_or(0);
    match capture_step(mon_idx, None, step_id, order, &sess.session_dir, Some(pending_ks), all_monitors) {
        Ok(new_step) => {
            {
                let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
                if let Some(ref mut session) = st.session {
                    session.steps.push(new_step.clone());
                    if let Err(e) = session::save_session(session) {
                        eprintln!("[save_session] failed: {e}");
                    }
                }
            }
            let _ = app_handle.emit("step-captured", &new_step);
            // Return updated session from state.
            let st = state.lock().unwrap_or_else(|e| e.into_inner());
            st.session.clone()
        }
        Err(e) => {
            eprintln!("[capture_pending_keystrokes_step] failed: {e}");
            current_session
        }
    }
}

/// Core stop-recording logic shared by the `stop_recording` Tauri command and
/// the Ctrl+Shift+Q global hotkey handler in `hooks.rs`.
///
/// Both callers perform the same eight steps in the same order:
/// 1. Guard — return early when not in Recording or Paused state.
/// 2. Transition `recording_state` → Reviewing and clear `rec_window_bounds`.
/// 3. Extract `pending_keystrokes`, `step_id`, `order`, monitor info.
/// 4. Increment counters for the pending-keystroke step (if any).
/// 5. Persist the in-progress session to disk.
/// 6. Optionally capture a final keystroke-only step.
/// 7. Restore the window from mini-bar mode.
/// 8. Auto-delete empty sessions (reset to Idle) or emit Reviewing state.
///
/// The function obtains the main window from `app_handle` so it works from
/// both a Tauri command context (which could pass its own `WebviewWindow`) and
/// from a background thread (hotkey handler) where no window parameter is
/// available.
pub fn perform_stop_recording(
    state: &Arc<Mutex<AppState>>,
    app_handle: &AppHandle,
) -> Result<(), String> {
    // Step 1-5: collect state, transition, persist.
    let (current_session, pending_ks, step_id, order, monitor_index, all_monitors, restore_rect, was_maximized) = {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        if st.recording_state != RecordingState::Recording
            && st.recording_state != RecordingState::Paused
        {
            return Ok(());
        }
        // Transition to Reviewing BEFORE extracting pending_ks so no new
        // keystrokes can be added by the hook thread after this point.
        st.recording_state = RecordingState::Reviewing;
        st.rec_window_bounds = None;

        let pending_ks = std::mem::take(&mut st.pending_keystrokes);
        let step_id = st.next_step_id;
        let order = st.next_order;
        let monitor_index = st.selected_monitor;
        // "All monitors" is indicated by selected_monitor being None while
        // the session itself stores monitor_index as None too.
        let all_monitors = st.session.as_ref().map_or(false, |s| s.monitor_index.is_none());

        // Increment counters now so that no other thread can reuse these IDs,
        // even though we are about to stop.
        if !pending_ks.is_empty() {
            st.next_step_id += 1;
            st.next_order += 1;
        }

        if let Some(ref session) = st.session {
            if let Err(e) = session::save_session(session) {
                eprintln!("[save_session] failed: {e}");
            }
        }

        let restore_rect = st.window_geometry.restore_rect.take();
        let was_maximized = st.window_geometry.maximized;

        (st.session.clone(), pending_ks, step_id, order, monitor_index, all_monitors, restore_rect, was_maximized)
    };

    // Step 6: capture a keystroke-only step if pending keystrokes remain.
    let current_session = if !pending_ks.is_empty() {
        capture_pending_keystrokes_step(
            state,
            app_handle,
            pending_ks,
            step_id,
            order,
            current_session,
            monitor_index,
            all_monitors,
        )
    } else {
        // Re-read session from state to get the most recent version
        // (capture worker may have pushed a step since we cloned above).
        let st = state.lock().unwrap_or_else(|e| e.into_inner());
        st.session.clone()
    };

    // Step 7: restore the window from mini-bar mode.
    // Reset capture-affinity first so the review window is visible in any
    // subsequent captures the user might take.
    if let Some(window) = app_handle.get_webview_window("main") {
        restore_window(&window, restore_rect, was_maximized);
    }

    // Step 8a: auto-delete empty recordings and reset to Idle.
    if let Some(ref sess) = current_session {
        if sess.steps.is_empty() {
            // error-handling-015: log failure to delete empty session directory
            if let Err(e) = session::delete_session(&sess.session_dir) {
                eprintln!("Failed to delete empty session directory: {e}");
            }
            {
                let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
                st.recording_state = RecordingState::Idle;
                st.session = None;
            }
            app_handle
                .emit("recording-state-changed", RecordingState::Idle)
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
    }

    // Step 8b: emit session data before state transition so Review screen has
    // data ready, then signal the new state.
    if let Some(ref sess) = current_session {
        app_handle
            .emit("session-updated", sess)
            .map_err(|e| e.to_string())?;
    }
    app_handle
        .emit("recording-state-changed", RecordingState::Reviewing)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn stop_recording(
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
    _window: WebviewWindow,
) -> Result<(), String> {
    perform_stop_recording(&*state, &app_handle)
}

#[tauri::command]
pub fn pause_recording(
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
) -> Result<(), String> {
    {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
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
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
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
pub fn record_more(
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    // Transition from Reviewing back to Recording, keeping the existing session.
    // next_step_id and next_order are set to continue past the existing steps so
    // that newly captured steps never collide with existing IDs.
    let (session_clone, monitor_index) = {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        if st.recording_state != RecordingState::Reviewing {
            return Err("record_more requires Reviewing state".to_string());
        }
        let session = st.session.as_ref().ok_or("No session to extend")?;
        // Find the highest step id and order currently in the session.
        let max_id = session.steps.iter().map(|s| s.id).max().unwrap_or(0);
        let max_order = session.steps.iter().map(|s| s.order).max().unwrap_or(0);
        let monitor_index = session.monitor_index;
        st.next_step_id = max_id + 1;
        st.next_order = max_order + 1;
        st.pending_keystrokes.clear();
        st.recording_state = RecordingState::Recording;
        st.selected_monitor = monitor_index;
        // Refresh monitor infos
        st.monitor_infos = list_monitor_infos();
        (st.session.clone(), monitor_index)
    };

    // Save current geometry before morphing to mini-bar.
    save_window_geometry(&window, &state);

    // Morph to mini-bar on the selected monitor (or primary as fallback).
    let monitor_idx = monitor_index.unwrap_or(0);
    apply_minibar_morph(&window, &state, monitor_idx);

    // Record mini-bar window position and size for self-click filtering.
    // Use outer_size() to get the real physical footprint from the OS rather than
    // computing logical × scale — see the same comment in start_recording.
    if let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        st.rec_window_bounds = Some((pos, size));
    }
    {
        let state_arc = Arc::clone(&*state);
        let window_for_event = window.clone();
        window.on_window_event(move |event| {
            match event {
                tauri::WindowEvent::Moved(new_pos) => {
                    if let Ok(mut st) = state_arc.lock() {
                        if let Some((_, size)) = st.rec_window_bounds {
                            st.rec_window_bounds = Some((*new_pos, size));
                        }
                    }
                }
                tauri::WindowEvent::Resized(_) => {
                    // Re-read the full physical rect from the OS so that DPI scaling
                    // changes during recording don't leave a stale bounding box.
                    if let (Ok(pos), Ok(size)) = (
                        window_for_event.outer_position(),
                        window_for_event.outer_size(),
                    ) {
                        if let Ok(mut st) = state_arc.lock() {
                            if st.rec_window_bounds.is_some() {
                                st.rec_window_bounds = Some((pos, size));
                            }
                        }
                    }
                }
                _ => {}
            }
        });
    }

    app_handle
        .emit("recording-state-changed", RecordingState::Recording)
        .map_err(|e| e.to_string())?;

    if let Some(ref sess) = session_clone {
        app_handle
            .emit("session-updated", sess)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn new_recording(
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    let (was_recording, restore_rect, was_maximized) = {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        let was_recording = st.recording_state == RecordingState::Recording
            || st.recording_state == RecordingState::Paused;
        st.recording_state = RecordingState::Idle;
        st.session = None;
        st.rec_window_bounds = None;
        st.undo_history.clear();
        st.redo_history.clear();
        (was_recording, st.window_geometry.restore_rect.take(), st.window_geometry.maximized)
    };

    // Only restore the window geometry if we were actually in mini-bar mode.
    // When navigating from Reviewing → Idle the window is already at full size;
    // resizing it would reset any user resize the user made.
    if was_recording {
        restore_window(&window, restore_rect, was_maximized);
    }

    app_handle
        .emit("recording-state-changed", RecordingState::Idle)
        .map_err(|e| e.to_string())?;
    Ok(())
}
