use crate::model::{ClickPoint, MonitorInfo, Step};
use anyhow::{anyhow, Result};
use chrono::Utc;
use std::fs;
use std::path::PathBuf;
use xcap::Monitor;

/// Return position + size info for every connected monitor.
pub fn list_monitor_infos() -> Vec<MonitorInfo> {
    Monitor::all().unwrap_or_else(|e| {
        eprintln!("[capture] Monitor::all() failed: {e}");
        Vec::new()
    })
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
/// When `all_monitors` is `true` every monitor **other** than `monitor_index`
/// is also captured (without annotation) and their paths are stored in
/// `Step::extra_image_paths`.
///
/// This function is **slow** (~50–200 ms); always call it from a spawned thread.
pub fn capture_step(
    monitor_index: usize,
    click: Option<ClickPoint>,
    step_id: usize,
    order: usize,
    session_dir: &PathBuf,
    keystrokes: Option<String>,
    all_monitors: bool,
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
    fs::create_dir_all(session_dir)?;
    rgba.save(&image_path)?;

    // When "All monitors" is selected, capture the remaining monitors without
    // annotation and collect their paths and indices into the parallel arrays.
    let (extra_image_paths, extra_monitor_indices) = if all_monitors {
        let mut paths = Vec::new();
        let mut indices = Vec::new();
        for (idx, _) in monitors.iter().enumerate().filter(|(idx, _)| *idx != monitor_index) {
            match capture_plain(idx, step_id, idx, session_dir) {
                Ok(path) => {
                    paths.push(path);
                    indices.push(idx);
                }
                Err(e) => eprintln!("[capture] step {step_id}: extra monitor {idx} failed: {e}"),
            }
        }
        (paths, indices)
    } else {
        (Vec::new(), Vec::new())
    };

    Ok(Step {
        id: step_id,
        order,
        image_path,
        extra_image_paths,
        click_monitor_index: monitor_index,
        extra_monitor_indices,
        click,
        description: String::new(),
        timestamp: Utc::now(),
        keystrokes,
        export_choice: Default::default(),
    })
}

/// Capture a plain (unannotated) screenshot of the monitor at `monitor_index`
/// and save it as `step_{step_id:04}_mon{monitor_idx_label}.png` in
/// `session_dir`.  Returns the saved path on success.
///
/// This helper is used by `capture_step` when "All monitors" is selected.
pub fn capture_plain(
    monitor_index: usize,
    step_id: usize,
    monitor_idx_label: usize,
    session_dir: &PathBuf,
) -> Result<PathBuf> {
    let monitors = Monitor::all()?;
    let monitor = monitors
        .get(monitor_index)
        .ok_or_else(|| anyhow!("Monitor index {} not found", monitor_index))?;

    let rgba = monitor.capture_image()?;
    let filename = format!("step_{:04}_mon{}.png", step_id, monitor_idx_label);
    let path = session_dir.join(&filename);
    fs::create_dir_all(session_dir)?;
    rgba.save(&path)?;
    Ok(path)
}
