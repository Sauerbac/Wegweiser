use crate::state::{HookEvent, HotKey};
use rdev::{listen, Button, EventType, Key};
use std::sync::mpsc;

/// Spawns the global input hook on a dedicated thread.
///
/// # Windows note
/// `rdev::listen()` calls `SetWindowsHookEx` internally. It must run on its
/// own thread — never call it from the eframe/egui thread.
///
/// The thread runs for the lifetime of the process; rdev provides no
/// cancellation API. Clicks during non-recording states are ignored in app.rs.
pub fn spawn_hook_thread(tx: mpsc::Sender<HookEvent>) {
    std::thread::Builder::new()
        .name("hook".to_string())
        .spawn(move || {
            let mut ctrl_held = false;
            let mut shift_held = false;
            // Last-known physical cursor position (rdev gives f64).
            let mut last_x: f64 = 0.0;
            let mut last_y: f64 = 0.0;

            let callback = move |event: rdev::Event| {
                match event.event_type {
                    EventType::MouseMove { x, y } => {
                        last_x = x;
                        last_y = y;
                    }
                    EventType::ButtonPress(Button::Left) => {
                        let _ = tx.send(HookEvent::Click(last_x as i32, last_y as i32));
                    }
                    EventType::KeyPress(key) => match key {
                        Key::ControlLeft | Key::ControlRight => ctrl_held = true,
                        Key::ShiftLeft | Key::ShiftRight => shift_held = true,
                        Key::KeyP if ctrl_held && shift_held => {
                            let _ = tx.send(HookEvent::KeyCombo(HotKey::Pause));
                        }
                        Key::KeyQ if ctrl_held && shift_held => {
                            let _ = tx.send(HookEvent::KeyCombo(HotKey::Stop));
                        }
                        Key::KeyS if ctrl_held && shift_held => {
                            let _ = tx.send(HookEvent::KeyCombo(HotKey::ManualCapture));
                        }
                        _ => {}
                    },
                    EventType::KeyRelease(key) => match key {
                        Key::ControlLeft | Key::ControlRight => ctrl_held = false,
                        Key::ShiftLeft | Key::ShiftRight => shift_held = false,
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
