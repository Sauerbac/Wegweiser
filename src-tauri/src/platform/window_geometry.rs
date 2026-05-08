/// Win32 window-placement helpers (`GetWindowPlacement`).

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
