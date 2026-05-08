use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

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
    pub exported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Step {
    pub id: usize,
    pub order: usize,
    pub image_path: PathBuf,
    /// Extra screenshots captured when "All monitors" is selected.
    /// Each entry is the path to a plain (unannotated) PNG for a monitor other
    /// than the one where the click occurred.
    pub extra_image_paths: Vec<PathBuf>,
    /// Index into the monitor list for the monitor that was clicked (primary image).
    pub click_monitor_index: usize,
    /// Monitor indices for each entry in `extra_image_paths` (parallel array).
    pub extra_monitor_indices: Vec<usize>,
    pub click: Option<ClickPoint>,
    /// The click position relative to the top-left corner of the clicked monitor
    /// (physical pixels). Populated for every new step so the annotation editor
    /// can place the editable click indicator without needing the live monitor list.
    pub click_relative: Option<ClickPoint>,
    pub description: String,
    pub timestamp: DateTime<Utc>,
    pub keystrokes: Option<String>,
    /// Which monitor image(s) to include when exporting this step.
    /// Vec<bool> where index 0 = primary, index i+1 = extra_image_paths[i].
    pub export_choice: Vec<bool>,
    /// Visible window bounding boxes captured at screenshot time, in monitor-relative pixels.
    pub window_rects: Vec<WindowRect>,
    /// Incremented on each image edit; used by the frontend as a cache-busting key.
    pub image_version: u32,
    /// Serialized Fabric.js canvas JSON for non-destructive overlay annotations.
    pub annotations_json: Option<String>,
    /// Path to the flattened preview PNG (base image + annotations baked in).
    pub preview_path: Option<PathBuf>,
}

impl Step {
    /// Returns a full-length boolean slice indicating which monitor images are
    /// included in the export for this step. Short `export_choice` is padded
    /// with `false` to `total_count` entries.
    pub fn effective_export_selection(&self, total_count: usize) -> Vec<bool> {
        (0..total_count)
            .map(|i| self.export_choice.get(i).copied().unwrap_or(false))
            .collect()
    }
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
    pub scale_factor: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClickPoint {
    /// Physical pixel X coordinate on the monitor
    pub x: u32,
    /// Physical pixel Y coordinate on the monitor
    pub y: u32,
}
