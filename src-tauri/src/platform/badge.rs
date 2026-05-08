/// Badge window creation — Tauri API, no Win32 FFI.

use tauri::{AppHandle, WebviewUrl, WebviewWindow};

/// Create a monitor-identification badge window.
///
/// The window is positioned at (`x`, `y`) in logical pixels and sized
/// `w` × `h` logical pixels.  It is created hidden, transparent,
/// borderless, and always-on-top so the frontend page can show it
/// without a white-flash on first paint.
///
/// Returns the newly built `WebviewWindow` on success.
pub fn create_monitor_badge_window(
    app: &AppHandle,
    label: &str,
    index: usize,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> tauri::Result<WebviewWindow> {
    let url = WebviewUrl::App(format!("identify?monitor={}", index).into());
    tauri::WebviewWindowBuilder::new(app, label, url)
        .title(format!("Monitor {}", index + 1))
        .inner_size(w, h)
        .position(x, y)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .visible(false) // hidden until page signals ready → no flash
        .build()
}
