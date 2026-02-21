use crate::state::{AppState, RecordingState};
use egui::Context;

pub fn show(ctx: &Context, state: &mut AppState) {
    let fill = egui::Color32::from_rgb(22, 25, 37);

    egui::CentralPanel::default()
        .frame(egui::Frame::NONE.fill(fill))
        .show(ctx, |ui| {
            let is_paused = state.recording_state == RecordingState::Paused;
            let step_count = state
                .session
                .as_ref()
                .map(|s| s.steps.len())
                .unwrap_or(0);

            // Make the whole bar draggable so the user can move the mini-bar.
            // Buttons placed later will capture their own clicks first.
            let drag_resp = ui.interact(
                ui.max_rect(),
                egui::Id::new("rec_bar_drag"),
                egui::Sense::drag(),
            );
            if drag_resp.dragged() {
                ctx.send_viewport_cmd(egui::ViewportCommand::StartDrag);
            }
            drag_resp.on_hover_cursor(egui::CursorIcon::Grab);

            // Single horizontally-centered row
            ui.allocate_ui_with_layout(
                egui::vec2(ui.available_width(), ui.available_height()),
                egui::Layout::left_to_right(egui::Align::Center),
                |ui| {
                    ui.add_space(10.0);

                    // ── Status label ──────────────────────────────────────
                    if is_paused {
                        ui.label(
                            egui::RichText::new("⏸  Paused")
                                .color(egui::Color32::YELLOW)
                                .strong(),
                        );
                    } else {
                        ui.label(
                            egui::RichText::new("⏺  Recording")
                                .color(egui::Color32::from_rgb(255, 90, 90))
                                .strong(),
                        );
                    }

                    ui.separator();

                    ui.label(
                        egui::RichText::new(format!("{step_count} step(s)"))
                            .color(egui::Color32::from_rgb(170, 175, 195)),
                    );

                    // Error indicator (inline for mini mode)
                    if state.error_message.is_some() {
                        ui.separator();
                        ui.label(
                            egui::RichText::new("⚠ error")
                                .color(egui::Color32::from_rgb(220, 70, 70))
                                .small(),
                        )
                        .on_hover_text(state.error_message.as_deref().unwrap_or(""));
                    }

                    // ── Buttons pushed to the right ───────────────────────
                    ui.with_layout(
                        egui::Layout::right_to_left(egui::Align::Center),
                        |ui| {
                            ui.add_space(10.0);

                            let stop_btn = egui::Button::new(
                                egui::RichText::new("⏹  Stop").color(egui::Color32::WHITE),
                            )
                            .fill(egui::Color32::from_rgb(170, 35, 35));

                            if ui.add(stop_btn).clicked() {
                                state.stop_recording_requested = true;
                            }

                            ui.add_space(4.0);

                            if is_paused {
                                if ui.button("▶  Resume").clicked() {
                                    state.recording_state = RecordingState::Recording;
                                }
                            } else if ui.button("⏸  Pause").clicked() {
                                state.recording_state = RecordingState::Paused;
                            }
                        },
                    );
                },
            );
        });
}
