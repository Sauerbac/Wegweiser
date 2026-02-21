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
    pub click: Option<ClickPoint>,
    pub description: String,
    pub timestamp: DateTime<Utc>,
    pub keystrokes: Option<String>,
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
