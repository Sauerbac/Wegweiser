/// Windows-specific platform helpers.

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

/// Apply or remove the `WDA_EXCLUDEFROMCAPTURE` display-affinity flag on the
/// given window handle.  When `exclude` is `true` the window becomes invisible
/// to all screen-capture APIs (xcap, DXGI, BitBlt, …) while remaining fully
/// visible to the user on screen.  When `exclude` is `false` the affinity is
/// reset to `WDA_NONE` so the window reappears in captures.
///
/// This is a no-op on non-Windows targets.
#[cfg(windows)]
pub fn set_window_exclude_from_capture(hwnd: isize, exclude: bool) {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
        WINDOW_DISPLAY_AFFINITY,
    };
    use windows::Win32::Foundation::HWND;

    if hwnd == 0 {
        return;
    }

    let affinity: WINDOW_DISPLAY_AFFINITY = if exclude {
        WDA_EXCLUDEFROMCAPTURE
    } else {
        WDA_NONE
    };

    // SAFETY: hwnd is obtained from window.hwnd().0 immediately before this call
    // and is verified non-zero. The window object is alive for the duration of
    // this call as it is referenced via the &WebviewWindow parameter.
    unsafe {
        let _ = SetWindowDisplayAffinity(HWND(hwnd as *mut core::ffi::c_void), affinity);
    }
}

#[cfg(not(windows))]
pub fn set_window_exclude_from_capture(_hwnd: isize, _exclude: bool) {
    // No-op on non-Windows platforms.
}

/// Returns the restore rect (x, y, width, height) of a window in physical pixels —
/// i.e. the position and size the window would have if it were un-maximized.
/// Uses `GetWindowPlacement` so the values are correct even when the window is
/// currently maximized.
#[cfg(windows)]
pub fn get_window_restore_rect(hwnd: isize) -> Option<(i32, i32, u32, u32)> {
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowPlacement, WINDOWPLACEMENT};
    use windows::Win32::Foundation::HWND;

    if hwnd == 0 {
        return None;
    }

    let mut wp = WINDOWPLACEMENT::default();
    wp.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
    // SAFETY: hwnd is obtained from window.hwnd().0 immediately before this call
    // and is verified non-zero. The window object is alive for the duration of
    // this call as it is referenced via the &WebviewWindow parameter.
    unsafe {
        if GetWindowPlacement(HWND(hwnd as *mut core::ffi::c_void), &mut wp).is_ok() {
            let r = wp.rcNormalPosition;
            let w = (r.right - r.left) as u32;
            let h = (r.bottom - r.top) as u32;
            Some((r.left, r.top, w, h))
        } else {
            None
        }
    }
}

#[cfg(not(windows))]
pub fn get_window_restore_rect(_hwnd: isize) -> Option<(i32, i32, u32, u32)> {
    None
}
