use crate::model::{MonitorInfo, Session};
use egui::TextureHandle;
use std::collections::HashMap;
use std::sync::mpsc;

/// Top-level application state machine.
#[derive(Debug, Clone, PartialEq)]
pub enum RecordingState {
    Idle,
    Recording,
    Paused,
    Reviewing,
}

/// Events sent from the hook thread to the main thread.
#[derive(Debug)]
pub enum HookEvent {
    /// Left-click at physical pixel coordinates.
    Click(i32, i32),
    /// A recognized hotkey combination was pressed.
    KeyCombo(HotKey),
}

#[derive(Debug)]
pub enum HotKey {
    Pause,
    Stop,
    ManualCapture,
}

pub struct AppState {
    pub recording_state: RecordingState,
    pub session: Option<Session>,

    /// Index into `monitor_names` / xcap monitor list.
    pub selected_monitor_index: usize,
    /// Display strings for the monitor ComboBox.
    pub monitor_names: Vec<String>,
    /// Full position+size info for each monitor (parallel to monitor_names).
    pub monitor_infos: Vec<MonitorInfo>,

    /// When true, clicks outside the selected monitor are silently ignored.
    pub capture_selected_only: bool,
    /// Bounding rect (x, y, w, h) of the selected monitor in physical pixels,
    /// populated when recording starts and used to filter off-monitor clicks.
    pub selected_monitor_rect: Option<(i32, i32, u32, u32)>,

    /// Receives events from the global hook thread (created once at startup).
    pub hook_rx: Option<mpsc::Receiver<HookEvent>>,

    /// Receives completed Steps from per-click capture threads.
    pub step_rx: Option<mpsc::Receiver<crate::model::Step>>,
    /// Cloned into every capture thread.
    pub step_tx: Option<mpsc::Sender<crate::model::Step>>,

    /// Monotonically increasing step ID counter.
    pub next_step_id: usize,

    /// Cached egui textures keyed by Step.id.
    pub textures: HashMap<usize, TextureHandle>,

    /// Index of the currently selected step in the review panel.
    pub selected_step_idx: Option<usize>,

    /// Physical-pixel bounding box [x, y, w, h] of the rec window itself,
    /// used to filter out clicks on the recording bar.
    pub rec_window_bounds: Option<[f32; 4]>,

    /// Shown as a red label when non-empty.
    pub error_message: Option<String>,
    /// Shown as a green label after a successful export.
    pub export_message: Option<String>,

    /// Set by the recording bar "Stop" button; consumed in app.rs update().
    pub stop_recording_requested: bool,

    /// While Some and not yet expired, an overlay window is shown on each monitor.
    pub identify_until: Option<std::time::Instant>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            recording_state: RecordingState::Idle,
            session: None,
            selected_monitor_index: 0,
            monitor_names: Vec::new(),
            monitor_infos: Vec::new(),
            capture_selected_only: true,
            selected_monitor_rect: None,
            hook_rx: None,
            step_rx: None,
            step_tx: None,
            next_step_id: 1,
            textures: HashMap::new(),
            selected_step_idx: None,
            rec_window_bounds: None,
            error_message: None,
            export_message: None,
            stop_recording_requested: false,
            identify_until: None,
        }
    }
}
