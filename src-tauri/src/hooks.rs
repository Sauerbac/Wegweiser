use crate::model::ClickPoint;
use crate::session::save_session;
use crate::state::{AppState, CaptureTask, RecordingState};
use rdev::{listen, Button, EventType, Key};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Spawns the global input hook on a dedicated thread and a single
/// long-lived capture worker thread.
///
/// # Windows note
/// `rdev::listen()` calls `SetWindowsHookEx` internally. It must run on its
/// own thread — never call it from the main/UI thread.
///
/// Both threads run for the lifetime of the process; rdev provides no
/// cancellation API.  The capture worker exits when its receiving end of the
/// channel is dropped (i.e. when the process exits), so it is implicitly
/// idle whenever no recording is in progress.
pub fn spawn_hook_thread(app_handle: AppHandle, state: Arc<Mutex<AppState>>) {
    // ------------------------------------------------------------------
    // Capture worker — processes click captures sequentially via a bounded
    // channel, keeping at most 32 unprocessed captures in flight at once.
    // This replaces the unbounded per-click thread::spawn and bounds memory
    // and disk I/O to one in-flight capture at a time.
    // ------------------------------------------------------------------
    let (tx, rx) = std::sync::mpsc::sync_channel::<CaptureTask>(32);

    {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        st.capture_tx = Some(tx);
    }

    std::thread::Builder::new()
        .name("capture-worker".into())
        .spawn(move || {
            for task in rx {
                match crate::capture::capture_step(
                    task.monitor_idx,
                    task.click,
                    task.step_id,
                    task.order,
                    &task.session_dir,
                    task.keystrokes,
                    task.all_monitors,
                ) {
                    Ok(step) => {
                        // Push the step into the session and persist it — save
                        // outside the mutex lock to keep the critical section
                        // as short as possible.
                        let session_to_save = {
                            let mut st = task.state.lock().unwrap_or_else(|e| e.into_inner());
                            if let Some(ref mut session) = st.session {
                                session.steps.push(step.clone());
                                Some(session.clone())
                            } else {
                                None
                            }
                        };
                        if let Some(ref s) = session_to_save {
                            if let Err(e) = save_session(s) {
                                eprintln!("[save_session] failed: {e}");
                            }
                        }
                        let _ = task.app_handle.emit("step-captured", &step);
                    }
                    Err(e) => {
                        eprintln!("[capture] step capture error: {e}");
                        let _ = task.app_handle.emit("step-capture-error", format!("{e}"));
                    }
                }
            }
        })
        .expect("failed to spawn capture worker");

    // ------------------------------------------------------------------
    // Hook thread — receives raw input events from rdev and dispatches
    // capture tasks to the worker via the channel.
    // ------------------------------------------------------------------
    std::thread::Builder::new()
        .name("hook".to_string())
        .spawn(move || {
            let mut ctrl_held = false;
            let mut shift_held = false;
            let mut last_x: f64 = 0.0;
            let mut last_y: f64 = 0.0;

            // Keep a handle outside the callback closure so we can emit hook-error
            // if rdev::listen() exits with an error (issue error-handling-005).
            let app_handle_for_error = app_handle.clone();

            let callback = move |event: rdev::Event| {
                match event.event_type {
                    EventType::MouseMove { x, y } => {
                        last_x = x;
                        last_y = y;
                    }
                    EventType::ButtonPress(Button::Left) => {
                        let click_x = last_x as i32;
                        let click_y = last_y as i32;

                        let task_opt = {
                            let mut st = state.lock().unwrap_or_else(|e| e.into_inner());

                            if st.recording_state != RecordingState::Recording {
                                return;
                            }

                            // Filter clicks on the mini-bar window itself using the
                            // cached position/size — avoids per-click get_webview_window
                            // + OS API calls.
                            if let Some((pos, size)) = st.rec_window_bounds {
                                if click_x >= pos.x
                                    && click_x < pos.x + size.width as i32
                                    && click_y >= pos.y
                                    && click_y < pos.y + size.height as i32
                                {
                                    return;
                                }
                            }

                            // Extract everything we need from the session before mutating.
                            // Use the pre-allocated next_order counter (not steps.len() + 1)
                            // to avoid a race where two rapid clicks both see steps.len() == 0
                            // before either capture thread has pushed its Step.
                            let session_dir = match st.session.as_ref() {
                                Some(s) => s.session_dir.clone(),
                                None => return,
                            };
                            let order = st.next_order;
                            st.next_order += 1;

                            // Determine which monitor to capture; remember whether we are in
                            // "All monitors" mode so the capture thread can grab the extras.
                            let (monitor_idx, all_monitors) = match st.selected_monitor {
                                Some(idx) => {
                                    // Single monitor mode: only capture if the click is on the selected monitor
                                    if let Some(selected_monitor_idx) = find_monitor_for_click(
                                        &st.monitor_infos,
                                        click_x,
                                        click_y,
                                    ) {
                                        if selected_monitor_idx == idx {
                                            (idx, false)
                                        } else {
                                            // Click is on a different monitor, skip capture
                                            return;
                                        }
                                    } else {
                                        // Click is not on any monitor, skip capture
                                        return;
                                    }
                                }
                                None => {
                                    // "All monitors": primary is the one containing the click
                                    let idx = find_monitor_for_click(
                                        &st.monitor_infos,
                                        click_x,
                                        click_y,
                                    )
                                    .unwrap_or(0);
                                    (idx, true)
                                }
                            };

                            let step_id = st.next_step_id;
                            st.next_step_id += 1;
                            let keystrokes = if st.pending_keystrokes.is_empty() {
                                None
                            } else {
                                Some(std::mem::take(&mut st.pending_keystrokes))
                            };

                            let task = CaptureTask {
                                monitor_idx,
                                click: Some(ClickPoint { x: click_x as u32, y: click_y as u32 }),
                                step_id,
                                order,
                                session_dir,
                                keystrokes,
                                all_monitors,
                                app_handle: app_handle.clone(),
                                state: Arc::clone(&state),
                            };
                            Some((task, st.capture_tx.clone()))
                        };

                        if let Some((task, Some(tx))) = task_opt {
                            if let Err(e) = tx.try_send(task) {
                                eprintln!("[hook] capture queue full, dropping click: {e}");
                            }
                        }
                    }
                    EventType::KeyPress(key) => match key {
                        Key::ControlLeft | Key::ControlRight => {
                            ctrl_held = true;
                            let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
                            st.ctrl_held = true;
                        }
                        Key::ShiftLeft | Key::ShiftRight => {
                            shift_held = true;
                            let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
                            st.shift_held = true;
                        }
                        Key::Alt | Key::AltGr => {
                            let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
                            st.alt_held = true;
                        }
                        _ => {
                            // SECURITY: This hook captures keystrokes from ALL applications system-wide
                            // while recording is active. Users should avoid typing passwords or other
                            // sensitive input in any application during a recording session.
                            // The hook thread runs for the entire process lifetime (rdev has no cancellation
                            // API); events are only accumulated during RecordingState::Recording.
                            // Accumulate keystrokes for the next step — single lock acquires both
                            // alt_held and pending_keystrokes to avoid a double-lock.
                            let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
                            if st.recording_state == RecordingState::Recording {
                                let alt = st.alt_held;
                                if let Some(token) = key_token(&key, ctrl_held, shift_held, alt) {
                                    st.pending_keystrokes.push_str(&token);
                                }
                            }
                        }
                    },
                    EventType::KeyRelease(key) => match key {
                        Key::ControlLeft | Key::ControlRight => {
                            ctrl_held = false;
                            let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
                            st.ctrl_held = false;
                        }
                        Key::ShiftLeft | Key::ShiftRight => {
                            shift_held = false;
                            let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
                            st.shift_held = false;
                        }
                        Key::Alt | Key::AltGr => {
                            let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
                            st.alt_held = false;
                        }
                        _ => {}
                    },
                    _ => {}
                }
            };

            if let Err(e) = listen(callback) {
                eprintln!("[hook] rdev listen error: {e:?}");
                // Notify the frontend so the user knows recording input is broken
                let _ = app_handle_for_error.emit("hook-error", format!("Input capture failed: {e:?}"));
            }
        })
        .expect("failed to spawn hook thread");
}

/// Register global hotkeys for pause (Ctrl+Shift+P) and stop (Ctrl+Shift+Q).
///
/// Uses the OS-level global shortcut API via `tauri-plugin-global-shortcut`,
/// which intercepts hotkeys before the Chromium WebView can consume them
/// (e.g. Ctrl+Shift+P would otherwise open the Print dialog).
pub fn register_global_hotkeys(
    app_handle: &AppHandle,
    state: Arc<Mutex<AppState>>,
) -> Result<(), Box<dyn std::error::Error>> {
    let shortcuts = app_handle.global_shortcut();

    // Ctrl+Shift+P → toggle pause/resume
    let state_pause = state.clone();
    let app_pause = app_handle.clone();
    shortcuts.on_shortcut("ctrl+shift+p", move |_app, _shortcut, event| {
        if event.state != ShortcutState::Pressed {
            return;
        }
        let mut st = state_pause.lock().unwrap_or_else(|e| e.into_inner());
        match st.recording_state {
            RecordingState::Recording => {
                st.recording_state = RecordingState::Paused;
            }
            RecordingState::Paused => {
                st.recording_state = RecordingState::Recording;
            }
            _ => return,
        }
        let new_state = st.recording_state.clone();
        drop(st);
        let _ = app_pause.emit("recording-state-changed", new_state);
    })?;

    // Ctrl+Shift+Q → stop recording
    let state_stop = state.clone();
    let app_stop = app_handle.clone();
    shortcuts.on_shortcut("ctrl+shift+q", move |_app, _shortcut, event| {
        if event.state != ShortcutState::Pressed {
            return;
        }
        let (current_session, restore_rect, was_maximized) = {
            let mut st = state_stop.lock().unwrap_or_else(|e| e.into_inner());
            if st.recording_state != RecordingState::Recording
                && st.recording_state != RecordingState::Paused
            {
                return;
            }
            st.recording_state = RecordingState::Reviewing;
            st.rec_window_bounds = None;
            if let Some(ref session) = st.session {
                if let Err(e) = save_session(session) {
                    eprintln!("[save_session] failed: {e}");
                }
            }
            let restore_rect = st.pre_recording_restore_rect.take();
            let was_maximized = st.pre_recording_maximized;
            (st.session.clone(), restore_rect, was_maximized)
        };

        // Restore full window — reset capture-affinity first.
        if let Some(window) = app_stop.get_webview_window("main") {
            #[cfg(windows)]
            if let Ok(hwnd) = window.hwnd() {
                crate::platform::set_window_exclude_from_capture(hwnd.0 as isize, false);
            }
            let _ = window.set_always_on_top(false);
            let _ = window.set_decorations(true);
            // Restore pre-recording geometry rather than hard-coding 900×650.
            let (rx, ry, rw, rh) = restore_rect.unwrap_or((100, 100, 900, 650));
            // Set size and position first so Windows knows the restore rect when
            // un-maximizing (rcNormalPosition).
            let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize { width: rw, height: rh }));
            let _ = window.set_position(tauri::PhysicalPosition { x: rx, y: ry });
            if was_maximized {
                let _ = window.maximize();
            }
        }

        // Auto-delete empty recordings and reset to Idle
        if let Some(ref sess) = current_session {
            if sess.steps.is_empty() {
                // error-handling-015: log failure to delete empty session directory
                if let Err(e) = crate::session::delete_session(&sess.session_dir) {
                    eprintln!("Failed to delete empty session directory: {e}");
                }
                {
                    let mut st = state_stop.lock().unwrap_or_else(|e| e.into_inner());
                    st.recording_state = RecordingState::Idle;
                    st.session = None;
                }
                let _ = app_stop.emit("recording-state-changed", RecordingState::Idle);
                return;
            }
        }

        // Emit session data and state change to review screen
        if let Some(ref sess) = current_session {
            let _ = app_stop.emit("session-updated", sess);
        }
        let _ = app_stop.emit("recording-state-changed", RecordingState::Reviewing);
    })?;

    Ok(())
}

fn find_monitor_for_click(monitors: &[crate::model::MonitorInfo], x: i32, y: i32) -> Option<usize> {
    monitors.iter().position(|m| {
        x >= m.x
            && x < m.x + m.width as i32
            && y >= m.y
            && y < m.y + m.height as i32
    })
}

/// Build the token to append to `pending_keystrokes` for a key press.
///
/// Returns `None` for modifier keys (they are tracked separately) and for any
/// key that should be silently ignored. Otherwise returns the string to append:
/// - With Ctrl or Alt held: `[Ctrl+C]`, `[Alt+F4]`, `[Ctrl+Alt+Del]`, etc.
/// - With only Shift held on a letter/digit: uppercase/shifted char (e.g. `"A"`)
/// - With only Shift held on a special key: `[Shift+Enter]`, `[Shift+Tab]`, etc.
/// - Plain printable key (letter, digit) with no modifiers: the character itself (e.g. `"a"`, `"1"`)
/// - Plain special key with no modifiers: bracketed name (e.g. `[Space]`, `[Enter]`, `[Backspace]`)
fn key_token(key: &Key, ctrl: bool, shift: bool, alt: bool) -> Option<String> {
    // Modifier keys themselves never produce a token.
    match key {
        Key::ShiftLeft
        | Key::ShiftRight
        | Key::ControlLeft
        | Key::ControlRight
        | Key::Alt
        | Key::AltGr
        | Key::MetaLeft
        | Key::MetaRight
        | Key::CapsLock => return None,
        _ => {}
    }

    // The display name used inside bracketed tokens.
    let name: &str = match key {
        Key::KeyA => "A", Key::KeyB => "B", Key::KeyC => "C", Key::KeyD => "D",
        Key::KeyE => "E", Key::KeyF => "F", Key::KeyG => "G", Key::KeyH => "H",
        Key::KeyI => "I", Key::KeyJ => "J", Key::KeyK => "K", Key::KeyL => "L",
        Key::KeyM => "M", Key::KeyN => "N", Key::KeyO => "O", Key::KeyP => "P",
        Key::KeyQ => "Q", Key::KeyR => "R", Key::KeyS => "S", Key::KeyT => "T",
        Key::KeyU => "U", Key::KeyV => "V", Key::KeyW => "W", Key::KeyX => "X",
        Key::KeyY => "Y", Key::KeyZ => "Z",
        Key::Num0 => "0", Key::Num1 => "1", Key::Num2 => "2", Key::Num3 => "3",
        Key::Num4 => "4", Key::Num5 => "5", Key::Num6 => "6", Key::Num7 => "7",
        Key::Num8 => "8", Key::Num9 => "9",
        Key::Return    => "Enter",
        Key::Space     => "Space",
        Key::Tab       => "Tab",
        Key::Backspace => "Backspace",
        Key::Delete    => "Delete",
        Key::Escape    => "Esc",
        Key::Home      => "Home",
        Key::End       => "End",
        Key::PageUp    => "PgUp",
        Key::PageDown  => "PgDn",
        Key::UpArrow   => "Up",
        Key::DownArrow => "Down",
        Key::LeftArrow => "Left",
        Key::RightArrow => "Right",
        Key::F1  => "F1",  Key::F2  => "F2",  Key::F3  => "F3",  Key::F4  => "F4",
        Key::F5  => "F5",  Key::F6  => "F6",  Key::F7  => "F7",  Key::F8  => "F8",
        Key::F9  => "F9",  Key::F10 => "F10", Key::F11 => "F11", Key::F12 => "F12",
        Key::Unknown(_) => "?",
        // Anything else (numpad, media keys, etc.) — ignore silently.
        _ => return None,
    };

    // Printable single-character keys (letters, digits, and Space).
    let is_printable = matches!(
        key,
        Key::KeyA | Key::KeyB | Key::KeyC | Key::KeyD | Key::KeyE | Key::KeyF
        | Key::KeyG | Key::KeyH | Key::KeyI | Key::KeyJ | Key::KeyK | Key::KeyL
        | Key::KeyM | Key::KeyN | Key::KeyO | Key::KeyP | Key::KeyQ | Key::KeyR
        | Key::KeyS | Key::KeyT | Key::KeyU | Key::KeyV | Key::KeyW | Key::KeyX
        | Key::KeyY | Key::KeyZ
        | Key::Num0 | Key::Num1 | Key::Num2 | Key::Num3 | Key::Num4
        | Key::Num5 | Key::Num6 | Key::Num7 | Key::Num8 | Key::Num9
        | Key::Space
    );

    if ctrl || alt {
        // Modifier combo: [Ctrl+Shift+Z], [Alt+F4], etc.
        let mut token = String::from("[");
        if ctrl  { token.push_str("Ctrl+"); }
        if alt   { token.push_str("Alt+"); }
        if shift { token.push_str("Shift+"); }
        token.push_str(name);
        token.push(']');
        Some(token)
    } else if shift {
        if is_printable {
            // Shift + letter/digit → uppercase (rdev gives no shift-symbol info,
            // so we uppercase ASCII letters and keep digits as-is).
            // Shift + Space → [Shift+Space] (Space is special)
            if matches!(key, Key::Space) {
                Some("[Shift+Space]".to_string())
            } else {
                let ch = match name.chars().next() {
                    Some(c) => c,
                    None => return None,
                };
                Some(ch.to_ascii_uppercase().to_string())
            }
        } else {
            // Shift + special key → [Shift+Enter], [Shift+Tab], etc.
            Some(format!("[Shift+{name}]"))
        }
    } else if is_printable {
        // Plain printable key → lowercase character.
        // Space is special: return a literal space character when pressed alone.
        if matches!(key, Key::Space) {
            Some(" ".to_string())
        } else {
            Some(name.to_ascii_lowercase().to_string())
        }
    } else {
        // Plain special key → [Enter], [Backspace], etc.
        Some(format!("[{name}]"))
    }
}
