use crate::capture::{capture_step, list_monitor_infos};
use xcap::Monitor;
use crate::model::{ImageEdit, Session, UndoState};
use crate::session::{self, SessionMeta};
use crate::state::{AppState, RecordingState};
use base64::Engine;
use chrono::Local;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use uuid::Uuid;

type AppStateHandle = Arc<Mutex<AppState>>;

/// Width of the recording mini-bar window in physical pixels.
const MINIBAR_WIDTH: u32 = 380;
/// Height of the recording mini-bar window in logical pixels.
const MINIBAR_HEIGHT: u32 = 40;
/// Fallback window restore position and size used when no saved geometry is available.
pub const DEFAULT_RESTORE_RECT: (i32, i32, u32, u32) = (100, 100, 900, 650);

/// Width of a monitor-identification badge window in logical pixels.
const BADGE_WIDTH: f64 = 120.0;
/// Height of a monitor-identification badge window in logical pixels.
const BADGE_HEIGHT: f64 = 76.0;
/// Margin from the screen edge for badge windows in logical pixels.
const BADGE_MARGIN: f64 = 24.0;
/// How long (in seconds) each identification badge window stays visible.
const BADGE_DISPLAY_SECS: u64 = 3;

/// Normalize a filesystem path to forward slashes for consistent frontend display.
fn normalize_path_for_frontend(path: &str) -> String {
    path.replace('\\', "/")
}

/// Push a snapshot of the current session onto the undo stack and clear redo.
/// Caps history at 50 entries (oldest dropped first).
fn push_undo(st: &mut AppState) {
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
fn emit_undo_state(state: &AppStateHandle, app_handle: &AppHandle) {
    let (can_undo, can_redo) = {
        let st = state.lock().unwrap_or_else(|e| e.into_inner());
        (!st.undo_history.is_empty(), !st.redo_history.is_empty())
    };
    let _ = app_handle.emit("undo-state-changed", UndoState { can_undo, can_redo });
}

/// Construct a new Session value for the given monitor selection.
///
/// Does not touch any filesystem or AppState — callers are responsible for
/// calling `session::create_session_dir()` beforehand and storing the result
/// in AppState afterwards.
fn build_session(
    monitor_index: Option<usize>,
    session_dir: PathBuf,
) -> Session {
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

/// Morph the main window into recording mini-bar mode.
///
/// Resizes to `MINIBAR_WIDTH × MINIBAR_HEIGHT`, removes decorations, sets
/// always-on-top, centres at the top edge of `monitor`, and applies the
/// Windows `WDA_EXCLUDEFROMCAPTURE` flag so the bar is invisible to xcap.
fn morph_to_minibar(window: &WebviewWindow, monitor: &crate::model::MonitorInfo) {
    // MINIBAR_WIDTH/HEIGHT are logical (CSS) pixel dimensions.
    // LogicalSize lets the webview content fill the window correctly on HiDPI
    // displays — PhysicalSize would make the window too small on e.g. a 150%
    // laptop screen where 380 physical px = only ~253 CSS px.
    if let Err(e) = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
        width: MINIBAR_WIDTH as f64,
        height: MINIBAR_HEIGHT as f64,
    })) {
        eprintln!("morph_to_minibar: set_size failed: {e}");
    }
    if let Err(e) = window.set_decorations(false) {
        eprintln!("morph_to_minibar: set_decorations failed: {e}");
    }
    if let Err(e) = window.set_resizable(false) {
        eprintln!("morph_to_minibar: set_resizable failed: {e}");
    }
    if let Err(e) = window.set_always_on_top(true) {
        eprintln!("morph_to_minibar: set_always_on_top failed: {e}");
    }
    // monitor.x / monitor.y / monitor.width are physical pixels (from xcap).
    // Use PhysicalPosition so the placement is correct regardless of DPI scale.
    // The bar's physical width = MINIBAR_WIDTH * scale_factor, so we subtract
    // that from the monitor width to compute the centred X offset.
    let bar_phys_width = (MINIBAR_WIDTH as f64 * monitor.scale_factor) as i32;
    let x = monitor.x + (monitor.width as i32 - bar_phys_width) / 2;
    let y = monitor.y;
    if let Err(e) = window.set_position(tauri::PhysicalPosition { x, y }) {
        eprintln!("morph_to_minibar: set_position failed: {e}");
    }
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        crate::platform::set_window_exclude_from_capture(hwnd.0 as isize, true);
    }
}

/// Restore the main window from mini-bar mode using the saved pre-recording geometry.
/// Clears the WDA_EXCLUDEFROMCAPTURE flag, disables always-on-top, re-enables decorations,
/// then restores saved size + position (or falls back to DEFAULT_RESTORE_RECT).
pub(crate) fn restore_window(
    window: &WebviewWindow,
    restore_rect: Option<(i32, i32, u32, u32)>,
    was_maximized: bool,
) {
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        crate::platform::set_window_exclude_from_capture(hwnd.0 as isize, false);
    }
    if let Err(e) = window.set_always_on_top(false) {
        eprintln!("restore_window: set_always_on_top failed: {e}");
    }
    if let Err(e) = window.set_resizable(true) {
        eprintln!("restore_window: set_resizable failed: {e}");
    }
    if let Err(e) = window.set_decorations(true) {
        eprintln!("restore_window: set_decorations failed: {e}");
    }
    let (rx, ry, rw, rh) = restore_rect.unwrap_or(DEFAULT_RESTORE_RECT);
    if let Err(e) = window.set_size(tauri::Size::Physical(tauri::PhysicalSize { width: rw, height: rh })) {
        eprintln!("restore_window: set_size failed: {e}");
    }
    if let Err(e) = window.set_position(tauri::PhysicalPosition { x: rx, y: ry }) {
        eprintln!("restore_window: set_position failed: {e}");
    }
    if was_maximized {
        if let Err(e) = window.maximize() {
            eprintln!("restore_window: maximize failed: {e}");
        }
    }
}

#[tauri::command]
pub fn list_monitors(state: State<'_, AppStateHandle>) -> Vec<crate::model::MonitorInfo> {
    state.lock().unwrap_or_else(|e| e.into_inner()).monitor_infos.clone()
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
    // - Position: GetWindowPlacement gives the correct restore position even when
    //   the window is currently maximized (outer_position() would return the
    //   maximized/offscreen position instead).
    // - Size: window.inner_size() is what set_size() consumes. rcNormalPosition
    //   gives the *outer* rect; using it for set_size would grow the window by one
    //   decoration height on every record/stop cycle.
    {
        let is_maximized = window.is_maximized().unwrap_or(false);
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        st.window_geometry.maximized = is_maximized;

        #[cfg(windows)]
        let restore_pos: Option<(i32, i32)> = window
            .hwnd()
            .ok()
            .and_then(|hwnd| crate::platform::get_window_restore_rect(hwnd.0 as isize))
            .map(|(rx, ry, _, _)| (rx, ry));
        #[cfg(not(windows))]
        let restore_pos: Option<(i32, i32)> = window
            .outer_position()
            .ok()
            .map(|p| (p.x, p.y));

        // When maximized we don't know the pre-maximized inner size; fall back to default.
        let restore_size: Option<(u32, u32)> = if !is_maximized {
            window.inner_size().ok().map(|s| (s.width, s.height))
        } else {
            None
        };

        let (_, _, default_w, default_h) = DEFAULT_RESTORE_RECT;
        if let (Some((rx, ry)), Some((rw, rh))) = (restore_pos, restore_size) {
            st.window_geometry.restore_rect = Some((rx, ry, rw, rh));
        } else if let Some((rx, ry)) = restore_pos {
            st.window_geometry.restore_rect = Some((rx, ry, default_w, default_h));
        }
    }

    // Morph window to mini-bar and position it at the top-center of the selected monitor.
    // Use selected monitor or primary monitor (index 0) as fallback.
    let infos = {
        let st = state.lock().unwrap_or_else(|e| e.into_inner());
        st.monitor_infos.clone()
    };
    let monitor_idx = monitor_index.unwrap_or(0);
    // morph_to_minibar handles resize, decorations, always-on-top, positioning, and
    // WDA_EXCLUDEFROMCAPTURE in one place — avoiding the scattered inline sequence.
    let selected_monitor = infos.get(monitor_idx).cloned();
    if let Some(ref monitor) = selected_monitor {
        morph_to_minibar(&window, monitor);
    } else {
        // Fallback: no monitor info — apply morph without positioning.
        let dummy = crate::model::MonitorInfo { name: String::new(), x: 0, y: 0, width: 1920, height: 1080, scale_factor: 1.0 };
        morph_to_minibar(&window, &dummy);
    }


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
/// Called by both `stop_recording` (commands.rs) and the Ctrl+Shift+Q hotkey handler
/// (hooks.rs) to avoid duplicating the capture + push + save + emit logic.
///
/// Returns the updated `Session` on success, or the original `current_session` on error.
pub(crate) fn capture_pending_keystrokes_step(
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

#[tauri::command]
pub fn stop_recording(
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    // Collect everything we need from state and transition to Reviewing.
    let (current_session, pending_ks, step_id, order, monitor_index, all_monitors) = {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        if st.recording_state != RecordingState::Recording
            && st.recording_state != RecordingState::Paused
        {
            return Ok(());
        }
        st.recording_state = RecordingState::Reviewing;
        st.rec_window_bounds = None;

        let pending_ks = st.pending_keystrokes.clone();
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
            st.pending_keystrokes.clear();
        }

        if let Some(ref session) = st.session {
            if let Err(e) = session::save_session(session) {
                eprintln!("[save_session] failed: {e}");
            }
        }

        (st.session.clone(), pending_ks, step_id, order, monitor_index, all_monitors)
    };

    // If there were buffered keystrokes with no trailing click, capture a final
    // step now (synchronous call is acceptable — we are stopping).
    let current_session = if !pending_ks.is_empty() {
        capture_pending_keystrokes_step(
            &*state,
            &app_handle,
            pending_ks,
            step_id,
            order,
            current_session,
            monitor_index,
            all_monitors,
        )
    } else {
        // Re-read session from state to get the most recent version.
        let st = state.lock().unwrap_or_else(|e| e.into_inner());
        st.session.clone()
    };

    // Restore full window — reset capture-affinity first so the review window
    // is visible in any subsequent captures the user might take.
    let (restore_rect, was_maximized) = {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        (st.window_geometry.restore_rect.take(), st.window_geometry.maximized)
    };
    restore_window(&window, restore_rect, was_maximized);

    // Auto-delete recordings with 0 steps
    if let Some(ref sess) = current_session {
        if sess.steps.is_empty() {
            // Delete the session directory from disk
            // error-handling-015: log failure to delete empty session directory
            if let Err(e) = session::delete_session(&sess.session_dir) {
                eprintln!("Failed to delete empty session directory: {e}");
            }
            // Reset state back to Idle
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

    // Emit session data before state transition so Review screen has data ready
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
pub fn delete_step(
    step_id: usize,
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let session = {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        push_undo(&mut st);
        if let Some(ref mut session) = st.session {
            session.steps.retain(|s| s.id != step_id);
            // Renumber orders
            for (i, step) in session.steps.iter_mut().enumerate() {
                step.order = i + 1;
            }
            if let Err(e) = session::save_session(session) {
                eprintln!("[save_session] failed: {e}");
            }
        }
        st.session.clone()
    };
    if let Some(s) = session {
        app_handle.emit("session-updated", &s).map_err(|e| e.to_string())?;
    }
    emit_undo_state(&state, &app_handle);
    Ok(())
}

#[tauri::command]
pub fn delete_steps(
    step_ids: Vec<usize>,
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let session = {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        push_undo(&mut st);
        if let Some(ref mut session) = st.session {
            let ids_set: std::collections::HashSet<usize> = step_ids.iter().copied().collect();
            session.steps.retain(|s| !ids_set.contains(&s.id));
            for (i, step) in session.steps.iter_mut().enumerate() {
                step.order = i + 1;
            }
            if let Err(e) = session::save_session(session) {
                eprintln!("[save_session] failed: {e}");
            }
        }
        st.session.clone()
    };
    if let Some(s) = session {
        app_handle.emit("session-updated", &s).map_err(|e| e.to_string())?;
    }
    emit_undo_state(&state, &app_handle);
    Ok(())
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
    let session = {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        push_undo(&mut st);
        if let Some(ref mut session) = st.session {
            if let Some(step) = session.steps.iter_mut().find(|s| s.id == step_id) {
                step.description = description;
            }
            if let Err(e) = session::save_session(session) {
                eprintln!("[save_session] failed: {e}");
            }
        }
        st.session.clone()
    };
    if let Some(s) = session {
        app_handle.emit("session-updated", &s).map_err(|e| e.to_string())?;
    }
    emit_undo_state(&state, &app_handle);
    Ok(())
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
    let session = {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        push_undo(&mut st);
        if let Some(ref mut session) = st.session {
            if let Some(step) = session.steps.iter_mut().find(|s| s.id == step_id) {
                step.keystrokes = keystrokes;
            }
            if let Err(e) = session::save_session(session) {
                eprintln!("[save_session] failed: {e}");
            }
        }
        st.session.clone()
    };
    if let Some(s) = session {
        app_handle.emit("session-updated", &s).map_err(|e| e.to_string())?;
    }
    emit_undo_state(&state, &app_handle);
    Ok(())
}

#[tauri::command]
pub fn set_step_export_choice(
    step_id: usize,
    choice: Vec<bool>,
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let session = {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        push_undo(&mut st);
        if let Some(ref mut session) = st.session {
            if let Some(step) = session.steps.iter_mut().find(|s| s.id == step_id) {
                step.export_choice = choice;
            }
            if let Err(e) = session::save_session(session) {
                eprintln!("[save_session] failed: {e}");
            }
        }
        st.session.clone()
    };
    if let Some(s) = session {
        app_handle.emit("session-updated", &s).map_err(|e| e.to_string())?;
    }
    emit_undo_state(&state, &app_handle);
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
    {
        let is_maximized = window.is_maximized().unwrap_or(false);
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        st.window_geometry.maximized = is_maximized;

        #[cfg(windows)]
        let restore_pos: Option<(i32, i32)> = window
            .hwnd()
            .ok()
            .and_then(|hwnd| crate::platform::get_window_restore_rect(hwnd.0 as isize))
            .map(|(rx, ry, _, _)| (rx, ry));
        #[cfg(not(windows))]
        let restore_pos: Option<(i32, i32)> = window
            .outer_position()
            .ok()
            .map(|p| (p.x, p.y));

        let restore_size: Option<(u32, u32)> = if !is_maximized {
            window.inner_size().ok().map(|s| (s.width, s.height))
        } else {
            None
        };

        let (_, _, default_w, default_h) = DEFAULT_RESTORE_RECT;
        if let (Some((rx, ry)), Some((rw, rh))) = (restore_pos, restore_size) {
            st.window_geometry.restore_rect = Some((rx, ry, rw, rh));
        } else if let Some((rx, ry)) = restore_pos {
            st.window_geometry.restore_rect = Some((rx, ry, default_w, default_h));
        }
    }

    // Morph to mini-bar on the selected monitor (or primary as fallback).
    let infos = {
        let st = state.lock().unwrap_or_else(|e| e.into_inner());
        st.monitor_infos.clone()
    };
    let monitor_idx = monitor_index.unwrap_or(0);
    let selected_monitor_resume = infos.get(monitor_idx).cloned();
    if let Some(ref monitor) = selected_monitor_resume {
        morph_to_minibar(&window, monitor);
    } else {
        let dummy = crate::model::MonitorInfo { name: String::new(), x: 0, y: 0, width: 1920, height: 1080, scale_factor: 1.0 };
        morph_to_minibar(&window, &dummy);
    }

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

#[tauri::command]
pub fn get_step_image(image_path: String) -> Result<String, String> {
    let path = std::path::Path::new(&image_path);

    // architecture-014: use the shared confine_to_sessions_dir helper
    let canonical_path = session::confine_to_sessions_dir(path)?;

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
    state.lock().unwrap_or_else(|e| e.into_inner()).session.clone()
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
    let session = {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        push_undo(&mut st);
        if let Some(ref mut session) = st.session {
            session.name = name;
            if let Err(e) = session::save_session(session) {
                eprintln!("[save_session] failed: {e}");
            }
        }
        st.session.clone()
    };
    if let Some(s) = session {
        app_handle.emit("session-updated", &s).map_err(|e| e.to_string())?;
    }
    emit_undo_state(&state, &app_handle);
    Ok(())
}

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
            if st.undo_history.len() >= 50 {
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

#[tauri::command]
pub fn apply_image_edit(
    step_id: usize,
    edit: ImageEdit,
    extra_index: Option<usize>,
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
) -> Result<(), String> {
    // Phase 1: push undo, collect the image path and current version (with lock).
    let (image_path, current_version) = {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        push_undo(&mut st);
        let session = st.session.as_ref().ok_or("No active session")?;
        let step = session.steps.iter().find(|s| s.id == step_id)
            .ok_or("Step not found")?;
        let path = match extra_index {
            None => step.image_path.clone(),
            Some(i) => step.extra_image_paths.get(i)
                .ok_or("Extra image index out of range")?
                .clone(),
        };
        (path, step.image_version)
    };

    // Phase 2: image manipulation — no lock held.
    let new_version = current_version + 1;

    // Determine output path for the versioned edited file.
    let dir = image_path.parent().unwrap_or(std::path::Path::new("."));
    let new_image_path = match extra_index {
        None => dir.join(format!("step_{:04}_edit{}.png", step_id, new_version)),
        Some(ei) => dir.join(format!("step_{:04}_extra{}_edit{}.png", step_id, ei, new_version)),
    };

    let img = image::open(&image_path).map_err(|e| e.to_string())?.to_rgba8();

    // Track the final crop rect (in image pixels) so we can transform window_rects
    // in Phase 3 — only set for Crop edits, None for Blur.
    let mut crop_rect: Option<(u32, u32, u32, u32)> = None;

    let result_img: image::RgbaImage = match edit {
        ImageEdit::Blur { x, y, w, h, sigma } => {
            let px = (x.max(0) as u32).min(img.width());
            let py = (y.max(0) as u32).min(img.height());
            let pw = w.min(img.width().saturating_sub(px));
            let ph = h.min(img.height().saturating_sub(py));
            if pw == 0 || ph == 0 {
                return Err("Blur region is empty".to_string());
            }
            let sub = image::imageops::crop_imm(&img, px, py, pw, ph).to_image();
            let blurred = imageproc::filter::gaussian_blur_f32(&sub, sigma);
            let mut result = img.clone();
            image::imageops::replace(&mut result, &blurred, px as i64, py as i64);
            result
        }
        ImageEdit::Crop { x, y, w, h } => {
            let px = (x.max(0) as u32).min(img.width());
            let py = (y.max(0) as u32).min(img.height());
            let pw = w.min(img.width().saturating_sub(px));
            let ph = h.min(img.height().saturating_sub(py));
            if pw == 0 || ph == 0 {
                return Err("Crop region is empty".to_string());
            }
            crop_rect = Some((px, py, pw, ph));
            image::imageops::crop_imm(&img, px, py, pw, ph).to_image()
        }
    };

    result_img.save(&new_image_path).map_err(|e| e.to_string())?;

    // Phase 3: update session metadata (with lock).
    let session_clone = {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(ref mut session) = st.session {
            if let Some(step) = session.steps.iter_mut().find(|s| s.id == step_id) {
                step.image_version = new_version;
                match extra_index {
                    None => {
                        step.image_path = new_image_path;
                        // Bug-004: after a crop the window_rects still reference the
                        // original coordinate space.  Translate by the crop origin and
                        // clamp to the new image dimensions so subsequent window-select
                        // operations in the editor stay aligned.
                        if let Some((crop_x, crop_y, crop_w, crop_h)) = crop_rect {
                            step.window_rects = step.window_rects.iter()
                                .filter_map(|wr| {
                                    let nx = wr.x - crop_x as i32;
                                    let ny = wr.y - crop_y as i32;
                                    let cx = nx.max(0);
                                    let cy = ny.max(0);
                                    let cw = ((nx + wr.w as i32).min(crop_w as i32) - cx).max(0) as u32;
                                    let ch = ((ny + wr.h as i32).min(crop_h as i32) - cy).max(0) as u32;
                                    if cw == 0 || ch == 0 {
                                        None // rect is fully outside the crop area
                                    } else {
                                        Some(crate::model::WindowRect {
                                            title: wr.title.clone(),
                                            x: cx,
                                            y: cy,
                                            w: cw,
                                            h: ch,
                                        })
                                    }
                                })
                                .collect();
                        }
                    }
                    Some(ei) => {
                        if let Some(p) = step.extra_image_paths.get_mut(ei) {
                            *p = new_image_path;
                        }
                    }
                }
            }
            if let Err(e) = session::save_session(session) {
                eprintln!("[save_session] failed: {e}");
            }
        }
        st.session.clone()
    };

    if let Some(s) = session_clone {
        app_handle.emit("session-updated", &s).map_err(|e| e.to_string())?;
    }
    emit_undo_state(&state, &app_handle);
    Ok(())
}

#[tauri::command]
pub fn reorder_steps(
    step_ids: Vec<usize>,
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let session = {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        push_undo(&mut st);
        if let Some(ref mut session) = st.session {
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
            if let Err(e) = session::save_session(session) {
                eprintln!("[save_session] failed: {e}");
            }
        }
        st.session.clone()
    };
    if let Some(s) = session {
        app_handle.emit("session-updated", &s).map_err(|e| e.to_string())?;
    }
    emit_undo_state(&state, &app_handle);
    Ok(())
}

#[tauri::command]
pub fn identify_monitors(app_handle: AppHandle) -> Result<(), String> {
    // Enumerate monitors via xcap directly so we can read the per-monitor
    // scale_factor and convert physical-pixel coordinates to the logical-pixel
    // space that Tauri's WebviewWindowBuilder::position() expects.
    // Using MonitorInfo (which stores only physical coords) would cause badge
    // windows to land in wrong positions on scaled monitors.
    let monitors = Monitor::all().unwrap_or_else(|e| {
        eprintln!("identify_monitors: Monitor::all() failed: {e}");
        Vec::new()
    });

    for (index, monitor) in monitors.iter().enumerate() {
        let window_label = format!("identify_{}", index);
        let app_clone = app_handle.clone();

        // Convert physical monitor geometry to logical pixels for window placement.
        let scale = monitor.scale_factor().unwrap_or(1.0) as f64;
        let phys_x = monitor.x().unwrap_or(0) as f64;
        let phys_y = monitor.y().unwrap_or(0) as f64;
        let phys_h = monitor.height().unwrap_or(0) as f64;

        // Small badge at bottom-left of this monitor (all values in logical pixels)
        let badge_x = phys_x / scale + BADGE_MARGIN;
        let badge_y = phys_y / scale + phys_h / scale - BADGE_HEIGHT - BADGE_MARGIN;

        let label_clone = window_label.clone();
        std::thread::spawn(move || {
            // Close any existing badge window for this monitor and sleep briefly
            // so Tauri's event loop can fully process the destruction before we
            // create a new window with the same label.
            if let Some(existing) = app_clone.get_webview_window(&label_clone) {
                let _ = existing.destroy();
                std::thread::sleep(std::time::Duration::from_millis(50));
            }

            match crate::platform::create_monitor_badge_window(
                &app_clone,
                &label_clone,
                index,
                badge_x,
                badge_y,
                BADGE_WIDTH,
                BADGE_HEIGHT,
            ) {
                Ok(_) => {
                    std::thread::sleep(std::time::Duration::from_secs(BADGE_DISPLAY_SECS));
                    if let Some(w) = app_clone.get_webview_window(&label_clone) {
                        let _ = w.destroy();
                    }
                }
                Err(e) => {
                    eprintln!(
                        "identify_monitors: failed to create badge window '{}': {}",
                        label_clone, e
                    );
                }
            }
        });
    }

    Ok(())
}
