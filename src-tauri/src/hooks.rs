use crate::model::ClickPoint;
use crate::session::save_session;
use crate::state::{AppState, RecordingState};
use rdev::{listen, Button, EventType, Key};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// Spawns the global input hook on a dedicated thread.
///
/// # Windows note
/// `rdev::listen()` calls `SetWindowsHookEx` internally. It must run on its
/// own thread — never call it from the main/UI thread.
///
/// The thread runs for the lifetime of the process; rdev provides no
/// cancellation API.
pub fn spawn_hook_thread(app_handle: AppHandle, state: Arc<Mutex<AppState>>) {
    std::thread::Builder::new()
        .name("hook".to_string())
        .spawn(move || {
            let mut ctrl_held = false;
            let mut shift_held = false;
            let mut last_x: f64 = 0.0;
            let mut last_y: f64 = 0.0;

            let callback = move |event: rdev::Event| {
                match event.event_type {
                    EventType::MouseMove { x, y } => {
                        last_x = x;
                        last_y = y;
                    }
                    EventType::ButtonPress(Button::Left) => {
                        let click_x = last_x as i32;
                        let click_y = last_y as i32;

                        let (should_capture, monitor_idx, step_id, order, session_dir, keystrokes) = {
                            let mut st = state.lock().unwrap();

                            if st.recording_state != RecordingState::Recording {
                                return;
                            }

                            // Filter clicks on the mini-bar window itself
                            if let Some((wx, wy, ww, wh)) = st.rec_window_bounds {
                                if click_x >= wx
                                    && click_x < wx + ww
                                    && click_y >= wy
                                    && click_y < wy + wh
                                {
                                    return;
                                }
                            }

                            // Extract everything we need from the session before mutating
                            let (order, session_dir) = match st.session.as_ref() {
                                Some(s) => (s.steps.len() + 1, s.session_dir.clone()),
                                None => return,
                            };

                            // Determine which monitor to capture
                            let monitor_idx = match st.selected_monitor {
                                Some(idx) => idx,
                                None => {
                                    // "All monitors": find which monitor the click is on
                                    find_monitor_for_click(&st.monitor_infos, click_x, click_y)
                                        .unwrap_or(0)
                                }
                            };

                            let step_id = st.next_step_id;
                            st.next_step_id += 1;
                            let keystrokes = if st.pending_keystrokes.is_empty() {
                                None
                            } else {
                                Some(std::mem::take(&mut st.pending_keystrokes))
                            };

                            (true, monitor_idx, step_id, order, session_dir, keystrokes)
                        };

                        if !should_capture {
                            return;
                        }

                        // Spawn capture on a dedicated thread
                        let app_handle_clone = app_handle.clone();
                        let state_clone = state.clone();
                        let click = ClickPoint { x: click_x as u32, y: click_y as u32 };

                        std::thread::spawn(move || {
                            match crate::capture::capture_step(
                                monitor_idx,
                                Some(click),
                                step_id,
                                order,
                                &session_dir,
                                keystrokes,
                            ) {
                                Ok(step) => {
                                    let mut st = state_clone.lock().unwrap();
                                    if let Some(ref mut session) = st.session {
                                        session.steps.push(step.clone());
                                        let _ = save_session(session);
                                    }
                                    drop(st);
                                    let _ = app_handle_clone.emit("step-captured", &step);
                                }
                                Err(e) => {
                                    eprintln!("[capture] error: {e}");
                                }
                            }
                        });
                    }
                    EventType::KeyPress(key) => match key {
                        Key::ControlLeft | Key::ControlRight => {
                            ctrl_held = true;
                            let mut st = state.lock().unwrap();
                            st.ctrl_held = true;
                        }
                        Key::ShiftLeft | Key::ShiftRight => {
                            shift_held = true;
                            let mut st = state.lock().unwrap();
                            st.shift_held = true;
                        }
                        Key::Alt | Key::AltGr => {
                            let mut st = state.lock().unwrap();
                            st.alt_held = true;
                        }
                        Key::KeyP if ctrl_held && shift_held => {
                            let mut st = state.lock().unwrap();
                            match st.recording_state {
                                RecordingState::Recording => {
                                    st.recording_state = RecordingState::Paused;
                                }
                                RecordingState::Paused => {
                                    st.recording_state = RecordingState::Recording;
                                }
                                _ => {}
                            }
                            let new_state = st.recording_state.clone();
                            drop(st);
                            let _ = app_handle.emit("recording-state-changed", new_state);
                        }
                        Key::KeyQ if ctrl_held && shift_held => {
                            {
                                let mut st = state.lock().unwrap();
                                if st.recording_state == RecordingState::Recording
                                    || st.recording_state == RecordingState::Paused
                                {
                                    st.recording_state = RecordingState::Reviewing;
                                    if let Some(ref session) = st.session {
                                        let _ = save_session(session);
                                    }
                                } else {
                                    return;
                                }
                            }
                            let _ = app_handle.emit("recording-state-changed", RecordingState::Reviewing);
                        }
                        _ => {
                            // Accumulate keystrokes for the next step
                            let mut st = state.lock().unwrap();
                            if st.recording_state == RecordingState::Recording {
                                if let Some(ch) = key_to_char(key) {
                                    st.pending_keystrokes.push(ch);
                                }
                            }
                        }
                    },
                    EventType::KeyRelease(key) => match key {
                        Key::ControlLeft | Key::ControlRight => {
                            ctrl_held = false;
                            let mut st = state.lock().unwrap();
                            st.ctrl_held = false;
                        }
                        Key::ShiftLeft | Key::ShiftRight => {
                            shift_held = false;
                            let mut st = state.lock().unwrap();
                            st.shift_held = false;
                        }
                        Key::Alt | Key::AltGr => {
                            let mut st = state.lock().unwrap();
                            st.alt_held = false;
                        }
                        _ => {}
                    },
                    _ => {}
                }
            };

            if let Err(e) = listen(callback) {
                eprintln!("[hook] rdev listen error: {e:?}");
            }
        })
        .expect("failed to spawn hook thread");
}

fn find_monitor_for_click(monitors: &[crate::model::MonitorInfo], x: i32, y: i32) -> Option<usize> {
    monitors.iter().position(|m| {
        x >= m.x
            && x < m.x + m.width as i32
            && y >= m.y
            && y < m.y + m.height as i32
    })
}

fn key_to_char(key: Key) -> Option<char> {
    match key {
        Key::KeyA => Some('a'),
        Key::KeyB => Some('b'),
        Key::KeyC => Some('c'),
        Key::KeyD => Some('d'),
        Key::KeyE => Some('e'),
        Key::KeyF => Some('f'),
        Key::KeyG => Some('g'),
        Key::KeyH => Some('h'),
        Key::KeyI => Some('i'),
        Key::KeyJ => Some('j'),
        Key::KeyK => Some('k'),
        Key::KeyL => Some('l'),
        Key::KeyM => Some('m'),
        Key::KeyN => Some('n'),
        Key::KeyO => Some('o'),
        Key::KeyP => Some('p'),
        Key::KeyQ => Some('q'),
        Key::KeyR => Some('r'),
        Key::KeyS => Some('s'),
        Key::KeyT => Some('t'),
        Key::KeyU => Some('u'),
        Key::KeyV => Some('v'),
        Key::KeyW => Some('w'),
        Key::KeyX => Some('x'),
        Key::KeyY => Some('y'),
        Key::KeyZ => Some('z'),
        Key::Space => Some(' '),
        Key::Return => Some('\n'),
        _ => None,
    }
}
