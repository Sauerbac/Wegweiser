use crate::state::{AppState, RecordingState};
use egui::Context;

/// Compact recording bar shown while the user is capturing steps.
///
/// This does NOT resize the window; full window-shrink + always-on-top is a
/// Phase 6 enhancement. For now we show a compact panel in the normal window.
pub fn show(ctx: &Context, state: &mut AppState) {
    egui::CentralPanel::default().show(ctx, |ui| {
        ui.add_space(8.0);

        let is_paused = state.recording_state == RecordingState::Paused;
        let step_count = state.session.as_ref().map(|s| s.steps.len()).unwrap_or(0);

        // Status + step count
        ui.horizontal(|ui| {
            if is_paused {
                ui.label(egui::RichText::new("⏸  Paused").color(egui::Color32::YELLOW).strong());
            } else {
                ui.label(egui::RichText::new("⏺  Recording").color(egui::Color32::RED).strong());
            }
            ui.separator();
            ui.label(format!("{step_count} step(s) captured"));
        });

        ui.add_space(8.0);
        ui.separator();
        ui.add_space(8.0);

        ui.horizontal(|ui| {
            if is_paused {
                if ui.button("▶  Resume").clicked() {
                    state.recording_state = RecordingState::Recording;
                }
            } else if ui.button("⏸  Pause").clicked() {
                state.recording_state = RecordingState::Paused;
            }

            if ui.button("⏹  Stop").clicked() {
                state.stop_recording_requested = true;
            }
        });

        ui.add_space(12.0);
        ui.separator();
        ui.add_space(4.0);
        ui.small("Hotkeys:  Ctrl+Shift+P pause/resume  ·  Ctrl+Shift+Q stop  ·  Ctrl+Shift+S manual capture");

        if let Some(err) = &state.error_message.clone() {
            ui.add_space(8.0);
            ui.colored_label(egui::Color32::RED, format!("⚠  {err}"));
        }
    });
}
