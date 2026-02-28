/// Windows-specific platform helpers.

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

    let affinity: WINDOW_DISPLAY_AFFINITY = if exclude {
        WDA_EXCLUDEFROMCAPTURE
    } else {
        WDA_NONE
    };

    // SAFETY: hwnd is obtained from Tauri's WebviewWindow::hwnd() which
    // guarantees it is a valid, live Win32 window handle while the window
    // object is alive.
    unsafe {
        let _ = SetWindowDisplayAffinity(HWND(hwnd as *mut core::ffi::c_void), affinity);
    }
}

#[cfg(not(windows))]
pub fn set_window_exclude_from_capture(_hwnd: isize, _exclude: bool) {
    // No-op on non-Windows platforms.
}
