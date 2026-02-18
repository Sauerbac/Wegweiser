use crate::model::{ClickPoint, Step};
use anyhow::{anyhow, Result};
use chrono::Utc;
use std::path::PathBuf;
use xcap::Monitor;

/// Return all connected monitors (display names + resolutions).
pub fn list_monitors() -> Vec<Monitor> {
    Monitor::all().unwrap_or_default()
}

/// Human-readable label for a monitor, e.g. "1: DISPLAY1 (2560×1440)".
pub fn monitor_display_name(monitor: &Monitor, index: usize) -> String {
    format!(
        "{}: {} ({}×{})",
        index + 1,
        monitor.name().unwrap_or_default(),
        monitor.width().unwrap_or_default(),
        monitor.height().unwrap_or_default(),
    )
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
) -> Result<Step> {
    let monitors = Monitor::all()?;
    let monitor = monitors
        .get(monitor_index)
        .ok_or_else(|| anyhow!("Monitor index {} not found", monitor_index))?;

    // xcap 0.8 returns an RgbaImage directly
    let mut rgba = monitor.capture_image()?;

    if let Some(ref cp) = click {
        crate::annotate::draw_click_indicator(&mut rgba, cp);
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
        keystrokes: None,
    })
}
