use crate::model::{ClickPoint, MonitorInfo, Session};
use std::sync::{Arc, Mutex};

/// A capture job dispatched from the hook thread to the dedicated capture worker.
pub struct CaptureTask {
    pub monitor_idx: usize,
    pub click: Option<ClickPoint>,
    pub step_id: usize,
    pub order: usize,
    pub session_dir: std::path::PathBuf,
    pub keystrokes: Option<String>,
    pub all_monitors: bool,
    pub app_handle: tauri::AppHandle,
    pub state: Arc<Mutex<AppState>>,
}

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
    /// Monotonically increasing step order counter.
    /// Incremented atomically in the click handler to avoid a race condition
    /// where two rapid clicks both read `steps.len() + 1` before either
    /// capture thread has finished appending its Step to the session.
    pub next_order: usize,
    /// Keystrokes typed since the last click; drained into the next Step on click.
    pub pending_keystrokes: String,
    /// Modifier key state.
    pub ctrl_held: bool,
    pub shift_held: bool,
    pub alt_held: bool,
    /// Physical-pixel bounding box of the recording mini-bar window.
    /// Cached once when recording starts; used to filter out self-clicks on the mini-bar
    /// without querying the OS on every mouse click.
    pub rec_window_bounds: Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)>,
    /// Window geometry saved just before morphing to mini-bar, used to restore after stop.
    /// `restore_rect` is the un-maximized (x, y, w, h) from GetWindowPlacement — valid
    /// whether the window was maximized or not.  `maximized` records whether it was
    /// maximized so we know whether to call maximize() on restore.
    pub pre_recording_restore_rect: Option<(i32, i32, u32, u32)>,
    pub pre_recording_maximized: bool,
    /// Sender to the long-lived capture worker thread.
    /// Populated once by `spawn_hook_thread`; `None` only before that call.
    /// The worker processes captures sequentially, bounding concurrent disk I/O
    /// to a single in-flight capture regardless of click rate.
    pub capture_tx: Option<std::sync::mpsc::SyncSender<CaptureTask>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            recording_state: RecordingState::Idle,
            session: None,
            monitor_infos: Vec::new(),
            selected_monitor: None,
            next_step_id: 1,
            next_order: 1,
            pending_keystrokes: String::new(),
            ctrl_held: false,
            shift_held: false,
            alt_held: false,
            rec_window_bounds: None,
            pre_recording_restore_rect: None,
            pre_recording_maximized: false,
            capture_tx: None,
        }
    }
}
