use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Controls which monitor image(s) are included when exporting a step.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(tag = "type", content = "value")]
pub enum StepExportChoice {
    /// Include only the primary (annotated, click-monitor) image. Default.
    #[default]
    Primary,
    /// Include only the extra image at index `i` (extra_image_paths[i]) as the main image.
    Extra(usize),
    /// Include the primary image first, then all extra images as secondary figures.
    All,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
    /// Index of the monitor used for this session, or `None` for "All Monitors".
    pub monitor_index: Option<usize>,
    pub steps: Vec<Step>,
    pub session_dir: PathBuf,
    /// Whether this session has been successfully exported at least once.
    #[serde(default)]
    pub exported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Step {
    pub id: usize,
    pub order: usize,
    pub image_path: PathBuf,
    /// Extra screenshots captured when "All monitors" is selected.
    /// Each entry is the path to a plain (unannotated) PNG for a monitor other
    /// than the one where the click occurred.  The field is absent in older
    /// session.json files — `#[serde(default)]` handles that transparently.
    #[serde(default)]
    pub extra_image_paths: Vec<PathBuf>,
    /// Index into the monitor list for the monitor that was clicked (primary image).
    #[serde(default)]
    pub click_monitor_index: usize,
    /// Monitor indices for each entry in `extra_image_paths` (parallel array).
    #[serde(default)]
    pub extra_monitor_indices: Vec<usize>,
    pub click: Option<ClickPoint>,
    pub description: String,
    pub timestamp: DateTime<Utc>,
    pub keystrokes: Option<String>,
    /// Which monitor image(s) to include when exporting this step.
    /// Absent in older session.json files — defaults to `Primary`.
    #[serde(default)]
    pub export_choice: StepExportChoice,
}

/// Physical-pixel description of a connected monitor, cached at startup/refresh.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorInfo {
    pub name: String,
    /// Top-left X of this monitor in the virtual desktop (physical pixels).
    pub x: i32,
    /// Top-left Y of this monitor in the virtual desktop (physical pixels).
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClickPoint {
    /// Physical pixel X coordinate on the monitor
    pub x: u32,
    /// Physical pixel Y coordinate on the monitor
    pub y: u32,
}
