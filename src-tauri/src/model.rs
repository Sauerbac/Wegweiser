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
    /// Exclude this step from the export entirely.
    Skip,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
    /// Index of the monitor used for this session, or `None` for "All Monitors".
    pub monitor_index: Option<usize>,
    pub steps: Vec<Step>,
    #[serde(skip)]
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
    /// Visible window bounding boxes captured at screenshot time, in monitor-relative pixels.
    #[serde(default)]
    pub window_rects: Vec<WindowRect>,
    /// Incremented on each image edit; used by the frontend as a cache-busting key.
    #[serde(default)]
    pub image_version: u32,
}

/// Bounding box of a visible top-level window, in monitor-relative physical pixels.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WindowRect {
    pub title: String,
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// Sent to the frontend after every undo-able mutation to indicate whether
/// undo/redo are currently available.
#[derive(Clone, Serialize)]
pub struct UndoState {
    pub can_undo: bool,
    pub can_redo: bool,
}

/// Describes an image-manipulation operation for `apply_image_edit`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ImageEdit {
    Blur { x: i32, y: i32, w: u32, h: u32, sigma: f32 },
    Crop { x: i32, y: i32, w: u32, h: u32 },
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
    /// DPI scale factor (e.g. 1.0 = 100%, 1.5 = 150%, 2.0 = 200%).
    #[serde(default = "default_scale_factor")]
    pub scale_factor: f64,
}

fn default_scale_factor() -> f64 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClickPoint {
    /// Physical pixel X coordinate on the monitor
    pub x: u32,
    /// Physical pixel Y coordinate on the monitor
    pub y: u32,
}
