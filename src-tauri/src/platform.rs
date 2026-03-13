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

/// Enumerate all visible, non-minimised, non-tool top-level windows and return
/// their bounding boxes in monitor-relative coordinates.
///
/// Only windows that overlap the given monitor rectangle are included.
/// Windows that are completely occluded by higher z-order windows are excluded.
/// The returned coordinates are clamped to the monitor's logical extent
/// so x/y can be negative if the window starts off-screen.
#[cfg(windows)]
pub fn enumerate_visible_windows(
    monitor_x: i32,
    monitor_y: i32,
    monitor_w: u32,
    monitor_h: u32,
) -> Vec<crate::model::WindowRect> {
    use windows::Win32::Foundation::{HWND, LPARAM, RECT, TRUE};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetWindowDisplayAffinity, GetWindowLongPtrW, GetWindowRect,
        GetWindowTextW, IsIconic, IsWindowVisible, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
    };

    /// An absolute-coordinate rectangle collected in z-order pass.
    struct AbsWindow {
        title: String,
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
        /// Whether this window should appear in the selectable result list.
        /// False for untitled/system windows and capture-excluded windows —
        /// they still contribute to occlusion but are not selectable.
        include_in_result: bool,
    }

    struct Collector {
        windows: Vec<AbsWindow>,
        monitor_x: i32,
        monitor_y: i32,
        monitor_w: u32,
        monitor_h: u32,
    }

    unsafe extern "system" fn enum_proc(
        hwnd: HWND,
        lparam: LPARAM,
    ) -> windows::core::BOOL {
        let col = &mut *(lparam.0 as *mut Collector);

        if !IsWindowVisible(hwnd).as_bool() {
            return TRUE;
        }
        if IsIconic(hwnd).as_bool() {
            return TRUE;
        }
        // Skip tool windows (floating toolbars, etc.)
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        if ex_style & WS_EX_TOOLWINDOW.0 != 0 {
            return TRUE;
        }
        // Windows excluded from screen capture (e.g. the recording mini-bar with
        // WDA_EXCLUDEFROMCAPTURE) are invisible in xcap screenshots, so they must
        // not appear in the selectable list.  However they DO occlude windows
        // behind them on screen, so they still need to be collected.
        let mut affinity: u32 = 0;
        let excluded_from_capture =
            GetWindowDisplayAffinity(hwnd, &mut affinity).is_ok() && affinity != 0;

        // Prefer DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS) over
        // GetWindowRect: modern DWM-composited windows have an invisible
        // shadow/resize frame that inflates the GetWindowRect result by ~7-8 px
        // on each side.  The DWM extended-frame bounds match the actual visual
        // content and give correct occlusion checks.
        let mut rect = RECT::default();
        {
            use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
            let ok = unsafe {
                DwmGetWindowAttribute(
                    hwnd,
                    DWMWA_EXTENDED_FRAME_BOUNDS,
                    &mut rect as *mut RECT as *mut core::ffi::c_void,
                    std::mem::size_of::<RECT>() as u32,
                ).is_ok()
            };
            if !ok {
                if GetWindowRect(hwnd, &mut rect).is_err() {
                    return TRUE;
                }
            }
        }
        let abs_w = rect.right - rect.left;
        let abs_h = rect.bottom - rect.top;
        if abs_w <= 0 || abs_h <= 0 {
            return TRUE;
        }

        // Check if the window intersects this monitor at all.
        let mon_right = col.monitor_x + col.monitor_w as i32;
        let mon_bottom = col.monitor_y + col.monitor_h as i32;
        if rect.right <= col.monitor_x
            || rect.left >= mon_right
            || rect.bottom <= col.monitor_y
            || rect.top >= mon_bottom
        {
            return TRUE;
        }

        // Get window title (up to 255 chars).  Untitled windows (e.g. the taskbar,
        // system overlays) are NOT selectable, but they still contribute to occlusion
        // so we keep them in the collected list with include_in_result = false.
        let mut title_buf = [0u16; 256];
        let len = GetWindowTextW(hwnd, &mut title_buf);
        let title = if len > 0 {
            String::from_utf16_lossy(&title_buf[..len as usize])
        } else {
            String::new()
        };
        // Windows.UI.Core.CoreWindow is used exclusively for system input overlays
        // (touch keyboard, emoji picker, Input Experience, etc.) — never a user app.
        let mut class_buf = [0u16; 256];
        let class_len = GetClassNameW(hwnd, &mut class_buf);
        let window_class = String::from_utf16_lossy(&class_buf[..class_len.max(0) as usize]);
        let is_system_overlay = window_class == "Windows.UI.Core.CoreWindow";

        let include_in_result = !excluded_from_capture && !title.is_empty() && !is_system_overlay;

        col.windows.push(AbsWindow {
            title,
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            include_in_result,
        });

        TRUE
    }

    let mut col = Collector {
        windows: Vec::new(),
        monitor_x,
        monitor_y,
        monitor_w,
        monitor_h,
    };
    let lparam = LPARAM(&mut col as *mut Collector as isize);
    // SAFETY: lparam points to `col` which lives for the duration of EnumWindows.
    unsafe {
        let _ = EnumWindows(Some(enum_proc), lparam);
    }

    // EnumWindows returns windows in z-order, topmost first.  Walk them front-to-back,
    // keeping track of "opaque" rects already seen.  A window is considered fully
    // occluded — and therefore excluded from the result — if its entire VISIBLE SLICE
    // on this monitor is contained within a single already-seen opaque rect.
    //
    // Critically: occlusion is checked against the MONITOR-CLAMPED rect, not the
    // full absolute window rect.  Without this, a window that spans two monitors can
    // never be fully contained in any opaque rect (its off-screen portion always
    // sticks out), causing it to appear in the list even when its on-screen slice is
    // completely covered by another window.
    let mon_right = monitor_x + monitor_w as i32;
    let mon_bottom = monitor_y + monitor_h as i32;
    let mut opaque_rects: Vec<(i32, i32, i32, i32)> = Vec::new(); // clamped absolute coords
    let mut result = Vec::new();

    for win in col.windows {
        // Clamp to this monitor's bounds in absolute coordinates.
        let cl = win.left.max(monitor_x);
        let ct = win.top.max(monitor_y);
        let cr = win.right.min(mon_right);
        let cb = win.bottom.min(mon_bottom);

        // Skip windows with no visible area on this monitor (defensive; the
        // intersection filter in enum_proc should already handle this).
        if cl >= cr || ct >= cb {
            continue;
        }

        // Occlusion check uses the clamped rect so cross-monitor windows are
        // correctly evaluated against what is actually visible on this monitor.
        let fully_occluded = opaque_rects.iter().any(|&(ol, ot, or_, ob)| {
            cl >= ol && ct >= ot && cr <= or_ && cb <= ob
        });

        if !fully_occluded && win.include_in_result {
            result.push(crate::model::WindowRect {
                title: win.title,
                x: cl - monitor_x,
                y: ct - monitor_y,
                w: (cr - cl) as u32,
                h: (cb - ct) as u32,
            });
        }

        // Always add the clamped rect to opaque_rects so it can occlude windows
        // behind it, regardless of whether we included it in the result.
        opaque_rects.push((cl, ct, cr, cb));
    }

    result
}

#[cfg(not(windows))]
pub fn enumerate_visible_windows(
    _monitor_x: i32,
    _monitor_y: i32,
    _monitor_w: u32,
    _monitor_h: u32,
) -> Vec<crate::model::WindowRect> {
    Vec::new()
}
