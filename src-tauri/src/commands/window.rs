use super::{
    AppStateHandle, BADGE_DISPLAY_SECS, BADGE_HEIGHT, BADGE_MARGIN, BADGE_WIDTH, DEFAULT_RESTORE_RECT,
    MINIBAR_HEIGHT, MINIBAR_WIDTH,
};
use tauri::{Manager, WebviewWindow};
use xcap::Monitor;

/// Morph the main window into recording mini-bar mode.
///
/// Resizes to `MINIBAR_WIDTH × MINIBAR_HEIGHT`, removes decorations, sets
/// always-on-top, centres at the top edge of `monitor`, and applies the
/// Windows `WDA_EXCLUDEFROMCAPTURE` flag so the bar is invisible to xcap.
pub(super) fn morph_to_minibar(window: &WebviewWindow, monitor: &crate::model::MonitorInfo) {
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
pub fn restore_window(
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

/// Save the pre-minibar window geometry into `AppState.window_geometry`.
///
/// Called from both `start_recording` and `record_more` before morphing to
/// mini-bar so that the original size and position can be restored on stop.
pub(super) fn save_window_geometry(window: &WebviewWindow, state: &AppStateHandle) {
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

/// Apply `morph_to_minibar` to the window using the monitor at `monitor_idx`
/// from the current monitor list (or a default dummy if not found).
pub(super) fn apply_minibar_morph(
    window: &WebviewWindow,
    state: &AppStateHandle,
    monitor_idx: usize,
) {
    let infos = {
        let st = state.lock().unwrap_or_else(|e| e.into_inner());
        st.monitor_infos.clone()
    };
    let selected_monitor = infos.get(monitor_idx).cloned();
    if let Some(ref monitor) = selected_monitor {
        morph_to_minibar(window, monitor);
    } else {
        let dummy = crate::model::MonitorInfo {
            name: String::new(),
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            scale_factor: 1.0,
        };
        morph_to_minibar(window, &dummy);
    }
}

#[tauri::command]
pub fn identify_monitors(app_handle: tauri::AppHandle) -> Result<(), String> {
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
