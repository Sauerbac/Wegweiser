use crate::capture::{list_monitor_infos, monitor_display_name};
use crate::model::Session;
use crate::state::{AppState, RecordingState};
use chrono::Utc;
use egui::Context;

const IDENTIFY_SECS: u64 = 3;

pub fn show(ctx: &Context, state: &mut AppState) {
    egui::CentralPanel::default().show(ctx, |ui| {
        ui.add_space(30.0);
        ui.heading("rec — Step Recorder");
        ui.label("A modern replacement for Windows Steps Recorder.");
        ui.separator();
        ui.add_space(10.0);

        // ── Monitor selector ─────────────────────────────────────────────────
        ui.label("Monitor to record:");

        let selected_name = match state.selected_monitor {
            None => "All Monitors".to_string(),
            Some(idx) => state
                .monitor_names
                .get(idx)
                .cloned()
                .unwrap_or_else(|| "No monitors detected".to_string()),
        };

        ui.horizontal(|ui| {
            egui::ComboBox::from_id_salt("monitor_picker")
                .selected_text(&selected_name)
                .show_ui(ui, |ui| {
                    // "All Monitors" entry at the top.
                    let all_selected = state.selected_monitor.is_none();
                    if ui
                        .selectable_label(all_selected, "All Monitors")
                        .clicked()
                    {
                        state.selected_monitor = None;
                    }
                    for (i, name) in state.monitor_names.iter().enumerate() {
                        let is_selected = state.selected_monitor == Some(i);
                        if ui.selectable_label(is_selected, name).clicked() {
                            state.selected_monitor = Some(i);
                        }
                    }
                });

            if ui.button("Identify…").clicked() {
                state.identify_until = Some(
                    std::time::Instant::now()
                        + std::time::Duration::from_secs(IDENTIFY_SECS),
                );
            }
        });

        ui.add_space(4.0);
        if ui.small_button("Refresh monitors").clicked() {
            refresh_monitors(state);
        }

        ui.add_space(10.0);

        // ── Capture filter ───────────────────────────────────────────────────
        ui.checkbox(
            &mut state.capture_selected_only,
            "Only capture clicks on the selected monitor",
        );

        ui.add_space(20.0);

        // ── Start / Load ─────────────────────────────────────────────────────
        ui.horizontal(|ui| {
            if ui.button("▶  Start Recording").clicked() {
                start_recording(state);
            }
            if ui.button("📂  Load Session").clicked() {
                load_session_picker(state);
            }
        });

        ui.add_space(16.0);
        ui.separator();
        ui.add_space(8.0);

        ui.small("Hotkeys during recording:");
        ui.small("  Ctrl+Shift+P  — pause / resume");
        ui.small("  Ctrl+Shift+Q  — stop recording");
        ui.small("  Ctrl+Shift+S  — manual capture (no click indicator)");

        ui.add_space(16.0);

        // ── Recent Sessions library ──────────────────────────────────────────
        ui.separator();
        ui.add_space(8.0);

        ui.horizontal(|ui| {
            ui.heading("Recent Sessions");
            ui.add_space(8.0);
            if ui.small_button("Refresh").clicked() {
                let base = crate::session::sessions_base_dir();
                state.known_sessions = crate::session::list_sessions(&base);
            }
        });

        ui.add_space(6.0);

        if state.known_sessions.is_empty() {
            ui.label("No saved sessions found.");
        } else {
            // Collect the sessions we need to display before any mutable borrow.
            // Each row: (name, step_count, session_dir, json_path)
            let session_rows: Vec<(String, usize, std::path::PathBuf, std::path::PathBuf)> = state
                .known_sessions
                .iter()
                .map(|m| {
                    (
                        m.name.clone(),
                        m.step_count,
                        m.session_dir.clone(),
                        m.session_dir.join("session.json"),
                    )
                })
                .collect();

            egui::ScrollArea::vertical()
                .max_height(220.0)
                .id_salt("session_library")
                .show(ui, |ui| {
                    let mut load_path: Option<std::path::PathBuf> = None;
                    let mut confirm_delete: Option<std::path::PathBuf> = None;
                    let mut do_delete: Option<std::path::PathBuf> = None;
                    let mut cancel_delete = false;

                    for (name, step_count, session_dir, json_path) in &session_rows {
                        let is_pending = state.pending_delete.as_deref() == Some(session_dir.as_path());

                        ui.horizontal(|ui| {
                            let step_label = if *step_count == 1 {
                                "1 step".to_string()
                            } else {
                                format!("{step_count} steps")
                            };
                            ui.label(format!("{name}  ({step_label})"));

                            ui.with_layout(
                                egui::Layout::right_to_left(egui::Align::Center),
                                |ui| {
                                    if is_pending {
                                        // Inline confirmation row
                                        if ui.small_button("No").clicked() {
                                            cancel_delete = true;
                                        }
                                        if ui
                                            .small_button(
                                                egui::RichText::new("Yes")
                                                    .color(egui::Color32::from_rgb(220, 60, 60)),
                                            )
                                            .clicked()
                                        {
                                            do_delete = Some(session_dir.clone());
                                        }
                                        ui.colored_label(
                                            egui::Color32::from_rgb(220, 140, 40),
                                            "Delete?",
                                        );
                                    } else {
                                        if ui.small_button("Load").clicked() {
                                            load_path = Some(json_path.clone());
                                        }
                                        if ui
                                            .small_button(
                                                egui::RichText::new("✕")
                                                    .color(egui::Color32::from_rgb(200, 60, 60)),
                                            )
                                            .on_hover_text("Delete this session")
                                            .clicked()
                                        {
                                            confirm_delete = Some(session_dir.clone());
                                        }
                                    }
                                },
                            );
                        });
                        ui.separator();
                    }

                    // Apply deferred mutations after the loop to avoid borrow conflicts.
                    if let Some(path) = load_path {
                        load_session_from_path(state, &path);
                    }
                    if let Some(dir) = confirm_delete {
                        state.pending_delete = Some(dir);
                    }
                    if cancel_delete {
                        state.pending_delete = None;
                    }
                    if let Some(dir) = do_delete {
                        match crate::session::delete_session(&dir) {
                            Ok(_) => {
                                state.pending_delete = None;
                                let base = crate::session::sessions_base_dir();
                                state.known_sessions = crate::session::list_sessions(&base);
                            }
                            Err(e) => {
                                state.error_message =
                                    Some(format!("Failed to delete session: {e}"));
                                state.pending_delete = None;
                            }
                        }
                    }
                });
        }

        ui.add_space(8.0);

        if let Some(err) = &state.error_message.clone() {
            ui.colored_label(egui::Color32::RED, format!("⚠  {err}"));
        }
    });
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn refresh_monitors(state: &mut AppState) {
    let infos = list_monitor_infos();
    state.monitor_names = infos
        .iter()
        .enumerate()
        .map(|(i, m)| monitor_display_name(m, i))
        .collect();
    state.monitor_infos = infos;
    // If the previously selected monitor index is now out of range, fall back to
    // "All Monitors" rather than keeping a stale index.
    if let Some(idx) = state.selected_monitor {
        if idx >= state.monitor_names.len() {
            state.selected_monitor = None;
        }
    }
}

fn start_recording(state: &mut AppState) {
    let session_dir = match crate::session::create_session_dir() {
        Ok(d) => d,
        Err(e) => {
            state.error_message = Some(format!("Cannot create session dir: {e}"));
            return;
        }
    };

    // Derive a short ID from the directory name (last path component).
    let session_id = session_dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    // Cache the selected monitor's physical bounding rect for click filtering.
    // When "All Monitors" is selected (`None`), no rect is needed — filtering is skipped.
    state.selected_monitor_rect = state.selected_monitor.and_then(|idx| {
        state
            .monitor_infos
            .get(idx)
            .map(|m| (m.x, m.y, m.width, m.height))
    });

    let session = Session {
        id: session_id,
        name: format!("Session {}", Utc::now().format("%Y-%m-%d %H:%M")),
        created_at: Utc::now(),
        monitor_index: state.selected_monitor,
        steps: Vec::new(),
        session_dir,
        exported: false,
    };

    state.session = Some(session);
    state.next_step_id = 1;
    state.textures.clear();
    state.selected_step_idx = None;
    state.error_message = None;
    state.export_message = None;
    state.recording_state = RecordingState::Recording;
}

/// Show a file-picker dialog for manually selecting a session.json file.
fn load_session_picker(state: &mut AppState) {
    if let Some(path) = rfd::FileDialog::new()
        .add_filter("Session JSON", &["json"])
        .set_title("Open Session")
        .pick_file()
    {
        load_session_from_path(state, &path);
    }
}

/// Load a session from a known JSON path and switch to the review panel.
fn load_session_from_path(state: &mut AppState, path: &std::path::Path) {
    match crate::session::load_session(path) {
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
