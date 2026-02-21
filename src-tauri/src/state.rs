use crate::model::{MonitorInfo, Session};

/// Top-level application state machine.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecordingState {
    Idle,
    Recording,
    Paused,
    Reviewing,
}

pub struct AppState {
    pub recording_state: RecordingState,
    pub session: Option<Session>,
    pub monitor_infos: Vec<MonitorInfo>,
    /// Index into `monitor_infos`, or `None` for "All Monitors".
    pub selected_monitor: Option<usize>,
    /// Monotonically increasing step ID counter.
    pub next_step_id: usize,
    /// Keystrokes typed since the last click; drained into the next Step on click.
    pub pending_keystrokes: String,
    /// Modifier key state.
    pub ctrl_held: bool,
    pub shift_held: bool,
    pub alt_held: bool,
    /// Physical-pixel bounding box (x, y, w, h) of the recording mini-bar window.
    /// Used to filter out self-clicks on the mini-bar.
    pub rec_window_bounds: Option<(i32, i32, i32, i32)>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            recording_state: RecordingState::Idle,
            session: None,
            monitor_infos: Vec::new(),
            selected_monitor: None,
            next_step_id: 1,
            pending_keystrokes: String::new(),
            ctrl_held: false,
            shift_held: false,
            alt_held: false,
            rec_window_bounds: None,
        }
    }
}
