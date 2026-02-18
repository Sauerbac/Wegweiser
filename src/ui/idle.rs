use crate::capture::{list_monitors, monitor_display_name};
use crate::model::Session;
use crate::state::{AppState, RecordingState};
use chrono::Utc;
use egui::Context;

pub fn show(ctx: &Context, state: &mut AppState) {
    egui::CentralPanel::default().show(ctx, |ui| {
        ui.add_space(30.0);
        ui.heading("rec — Step Recorder");
        ui.label("A modern replacement for Windows Steps Recorder.");
        ui.separator();
        ui.add_space(10.0);

        // Monitor selector
        ui.label("Monitor to record:");
        let selected_name = state
            .monitor_names
            .get(state.selected_monitor_index)
            .cloned()
            .unwrap_or_else(|| "No monitors detected".to_string());

        egui::ComboBox::from_id_salt("monitor_picker")
            .selected_text(&selected_name)
            .show_ui(ui, |ui| {
                for (i, name) in state.monitor_names.iter().enumerate() {
                    ui.selectable_value(&mut state.selected_monitor_index, i, name);
                }
            });

        ui.add_space(4.0);
        if ui.small_button("Refresh monitors").clicked() {
            refresh_monitors(state);
        }

        ui.add_space(20.0);

        // Start / load buttons
        ui.horizontal(|ui| {
            if ui.button("▶  Start Recording").clicked() {
                start_recording(state);
            }
            if ui.button("📂  Load Session").clicked() {
                load_session(state);
            }
        });

        ui.add_space(16.0);
        ui.separator();
        ui.add_space(8.0);

        // Hotkey reminder
        ui.small("Hotkeys during recording:");
        ui.small("  Ctrl+Shift+P  — pause / resume");
        ui.small("  Ctrl+Shift+Q  — stop recording");
        ui.small("  Ctrl+Shift+S  — manual capture (no click indicator)");

        ui.add_space(16.0);

        // Error banner
        if let Some(err) = &state.error_message.clone() {
            ui.colored_label(egui::Color32::RED, format!("⚠  {err}"));
        }
    });
}

// ── helpers ─────────────────────────────────────────────────────────────────

fn refresh_monitors(state: &mut AppState) {
    let monitors = list_monitors();
    state.monitor_names = monitors
        .iter()
        .enumerate()
        .map(|(i, m)| monitor_display_name(m, i))
        .collect();
    if state.selected_monitor_index >= state.monitor_names.len() {
        state.selected_monitor_index = 0;
    }
}

fn start_recording(state: &mut AppState) {
    // Create a temp directory for this session's images
    let session_id = uuid::Uuid::new_v4().to_string();
    let dir_name = format!("rec_{}", &session_id[..8]);
    let session_dir = std::env::temp_dir().join(dir_name);

    if let Err(e) = std::fs::create_dir_all(&session_dir) {
        state.error_message = Some(format!("Cannot create session dir: {e}"));
        return;
    }

    let session = Session {
        id: session_id,
        name: format!("Session {}", Utc::now().format("%Y-%m-%d %H:%M")),
        created_at: Utc::now(),
        monitor_index: state.selected_monitor_index,
        steps: Vec::new(),
        session_dir,
    };

    state.session = Some(session);
    state.next_step_id = 1;
    state.textures.clear();
    state.selected_step_idx = None;
    state.error_message = None;
    state.export_message = None;
    state.recording_state = RecordingState::Recording;
}

fn load_session(state: &mut AppState) {
    if let Some(path) = rfd::FileDialog::new()
        .add_filter("Session JSON", &["json"])
        .set_title("Open Session")
        .pick_file()
    {
        match crate::session::load_session(&path) {
            Ok(session) => {
                state.session = Some(session);
                state.textures.clear();
                state.selected_step_idx = None;
                state.error_message = None;
                state.export_message = None;
                state.recording_state = RecordingState::Reviewing;
            }
            Err(e) => {
                state.error_message = Some(format!("Failed to load session: {e}"));
            }
        }
    }
}
