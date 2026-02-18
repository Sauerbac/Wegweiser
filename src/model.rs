use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub monitor_index: usize,
    pub steps: Vec<Step>,
    pub session_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Step {
    pub id: usize,
    pub order: usize,
    pub image_path: PathBuf,
    pub click: Option<ClickPoint>,
    pub description: String,
    pub timestamp: DateTime<Utc>,
    pub keystrokes: Option<String>, // Phase 2
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClickPoint {
    /// Physical pixel X coordinate on the monitor
    pub x: u32,
    /// Physical pixel Y coordinate on the monitor
    pub y: u32,
}
