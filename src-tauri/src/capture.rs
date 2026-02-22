use crate::model::{ClickPoint, MonitorInfo, Step};
use anyhow::{anyhow, Result};
use chrono::Utc;
use std::path::PathBuf;
use xcap::Monitor;

/// Return position + size info for every connected monitor.
pub fn list_monitor_infos() -> Vec<MonitorInfo> {
    Monitor::all().unwrap_or_default()
        .into_iter()
        .map(|m| MonitorInfo {
            name: m.name().unwrap_or_default(),
            x: m.x().unwrap_or(0),
            y: m.y().unwrap_or(0),
            width: m.width().unwrap_or(0),
            height: m.height().unwrap_or(0),
        })
        .collect()
}

/// Capture a screenshot of `monitor_index`, draw a click indicator if
/// `click` is provided, save as PNG to `session_dir`, and return a `Step`.
///
/// This function is **slow** (~50–200 ms); always call it from a spawned thread.
pub fn capture_step(
    monitor_index: usize,
    click: Option<ClickPoint>,
    step_id: usize,
    order: usize,
    session_dir: &PathBuf,
    keystrokes: Option<String>,
) -> Result<Step> {
    let monitors = Monitor::all()?;
    let monitor = monitors
        .get(monitor_index)
        .ok_or_else(|| anyhow!("Monitor index {} not found", monitor_index))?;

    // xcap 0.8 returns an RgbaImage directly
    let mut rgba = monitor.capture_image()?;

    if let Some(ref cp) = click {
        // rdev delivers absolute physical-pixel coordinates across the whole
        // virtual desktop. xcap's screenshot is relative to the monitor's own
        // top-left corner, so we must subtract the monitor origin before drawing.
        let mon_x = monitor.x().unwrap_or(0);
        let mon_y = monitor.y().unwrap_or(0);
        let rel_x = (cp.x as i32 - mon_x).max(0) as u32;
        let rel_y = (cp.y as i32 - mon_y).max(0) as u32;
        let adjusted = crate::model::ClickPoint { x: rel_x, y: rel_y };
        crate::annotate::draw_click_indicator(&mut rgba, &adjusted);
    }

    let filename = format!("step_{:04}.png", step_id);
    let image_path = session_dir.join(&filename);
    rgba.save(&image_path)?;

    Ok(Step {
        id: step_id,
        order,
        image_path,
        click,
        description: String::new(),
        timestamp: Utc::now(),
        keystrokes,
    })
}
