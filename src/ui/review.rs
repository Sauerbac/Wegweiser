use crate::model::Step;
use crate::state::{AppState, ExportMsg, RecordingState, TEXTURE_CACHE_CAP};
use egui::{Context, ScrollArea, TextureOptions, Vec2};
use std::path::PathBuf;
use std::sync::mpsc;

pub fn show(ctx: &Context, state: &mut AppState) {
    // ── 1. Lazy-load textures for any step not yet cached ───────────────────
    // Determine the step ID of the currently selected step so we never evict it.
    let selected_step_id: Option<usize> = state.selected_step_idx.and_then(|sel_idx| {
        state
            .session
            .as_ref()
            .and_then(|s| s.steps.get(sel_idx))
            .map(|s| s.id)
    });

    let paths_to_load: Vec<(usize, PathBuf)> = state
        .session
        .as_ref()
        .map(|s| {
            s.steps
                .iter()
                .filter(|step| !state.textures.contains_key(&step.id))
                .map(|step| (step.id, step.image_path.clone()))
                .collect()
        })
        .unwrap_or_default();

    for (id, path) in paths_to_load {
        if let Ok(img) = image::open(&path) {
            let rgba = img.to_rgba8();
            let size = [rgba.width() as usize, rgba.height() as usize];
            let pixels = rgba.into_raw();
            let color_image = egui::ColorImage::from_rgba_unmultiplied(size, &pixels);
            let handle = ctx.load_texture(
                format!("step_{id}"),
                color_image,
                TextureOptions::LINEAR,
            );
            state.textures.insert(id, handle);
            state.texture_lru.push_back(id);

            // Evict least-recently-used textures until we are within the cap.
            // Never evict the currently selected step so its preview never flickers.
            while state.texture_lru.len() > TEXTURE_CACHE_CAP {
                // Find the front-most entry that is not the pinned selected step.
                let evict_pos = state
                    .texture_lru
                    .iter()
                    .position(|&lru_id| Some(lru_id) != selected_step_id);
                match evict_pos {
                    Some(pos) => {
                        let evicted_id = state.texture_lru.remove(pos).unwrap();
                        state.textures.remove(&evicted_id);
                    }
                    None => {
                        // Every entry in the deque is the pinned step — nothing to evict.
                        break;
                    }
                }
            }
        }
    }

    // ── 2. Collect step data to avoid borrow-checker conflicts ──────────────
    let steps: Vec<(usize, usize, PathBuf, String, Option<String>)> = state
        .session
        .as_ref()
        .map(|s| {
            s.steps
                .iter()
                .enumerate()
                .map(|(idx, step)| (idx, step.id, step.image_path.clone(), step.description.clone(), step.keystrokes.clone()))
                .collect()
        })
        .unwrap_or_default();

    // ── 3. Left panel — step list ────────────────────────────────────────────
    egui::SidePanel::left("step_list_panel")
        .min_width(200.0)
        .max_width(280.0)
        .show(ctx, |ui| {
            ui.heading("Steps");
            ui.separator();

            ScrollArea::vertical()
                .id_salt("step_scroll")
                .show(ui, |ui| {
                    for (list_idx, step_id, _path, desc, _ks) in &steps {
                        let selected = state.selected_step_idx == Some(*list_idx);

                        let thumb_size = Vec2::new(180.0, 120.0);
                        let (resp, painter) = ui.allocate_painter(
                            Vec2::new(180.0, 150.0),
                            egui::Sense::click(),
                        );

                        if resp.clicked() {
                            state.selected_step_idx = Some(*list_idx);
                        }

                        // Highlight selected
                        if selected {
                            painter.rect_filled(
                                resp.rect,
                                4.0,
                                egui::Color32::from_rgb(50, 100, 180).gamma_multiply(0.3),
                            );
                        }

                        // Thumbnail
                        if let Some(tex) = state.textures.get(step_id) {
                            let img_rect = egui::Rect::from_min_size(
                                resp.rect.min,
                                thumb_size,
                            );
                            painter.image(
                                tex.id(),
                                img_rect,
                                egui::Rect::from_min_max(
                                    egui::pos2(0.0, 0.0),
                                    egui::pos2(1.0, 1.0),
                                ),
                                egui::Color32::WHITE,
                            );
                        } else {
                            painter.rect_filled(
                                egui::Rect::from_min_size(resp.rect.min, thumb_size),
                                0.0,
                                egui::Color32::from_gray(40),
                            );
                        }

                        // Step number + short desc
                        let label_pos = resp.rect.min + Vec2::new(4.0, thumb_size.y + 2.0);
                        let short = if desc.len() > 28 {
                            format!("{}…", &desc[..28])
                        } else if desc.is_empty() {
                            format!("Step {}", list_idx + 1)
                        } else {
                            desc.clone()
                        };
                        painter.text(
                            label_pos,
                            egui::Align2::LEFT_TOP,
                            short,
                            egui::FontId::proportional(12.0),
                            egui::Color32::LIGHT_GRAY,
                        );

                        ui.add_space(2.0);
                    }
                });
        });

    // ── 4. Right panel — editor + full preview ───────────────────────────────
    egui::CentralPanel::default().show(ctx, |ui| {
        show_editor(ui, state, &steps);
    });
}

fn show_editor(
    ui: &mut egui::Ui,
    state: &mut AppState,
    steps: &[(usize, usize, PathBuf, String, Option<String>)],
) {
    // Top toolbar
    let exporting = state.export_progress.is_some();
    ui.horizontal(|ui| {
        ui.heading("Review & Export");

        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            // Disable the HTML export button while an export is in progress.
            ui.add_enabled_ui(!exporting, |ui| {
                if ui.button("Export HTML").clicked() {
                    export_html(state);
                }
            });
            if ui.button("Export Markdown").clicked() {
                export_markdown(state);
            }
            if ui.button("Save Session").clicked() {
                if let Some(session) = &state.session {
                    if let Err(e) = crate::session::save_session(session) {
                        state.error_message = Some(format!("Save failed: {e}"));
                    } else {
                        state.export_message = Some(format!(
                            "Saved → {}",
                            session.session_dir.join("session.json").display()
                        ));
                    }
                }
            }
            if ui.button("← New Recording").clicked() {
                state.recording_state = RecordingState::Idle;
                state.session = None;
                state.textures.clear();
                state.texture_lru.clear();
                state.selected_step_idx = None;
            }
        });
    });
    ui.separator();

    // Export progress bar (shown while HTML export is running)
    if let Some(progress) = state.export_progress {
        ui.horizontal(|ui| {
            ui.label("Exporting HTML…");
            ui.add(
                egui::ProgressBar::new(progress)
                    .show_percentage()
                    .desired_width(240.0),
            );
        });
        ui.add_space(4.0);
    }

    // Status / error
    if let Some(msg) = &state.export_message.clone() {
        ui.horizontal(|ui| {
            ui.colored_label(egui::Color32::GREEN, format!("✓  {msg}"));
            if ui.small_button("✕").on_hover_text("Dismiss").clicked() {
                state.export_message = None;
            }
        });
    }
    if let Some(err) = &state.error_message.clone() {
        ui.colored_label(egui::Color32::RED, format!("⚠  {err}"));
    }

    if steps.is_empty() {
        ui.add_space(30.0);
        ui.label("No steps captured yet.");
        return;
    }

    // Step management buttons (only when a step is selected)
    if let Some(sel) = state.selected_step_idx {
        ui.horizontal(|ui| {
            ui.label(format!("Step {} selected", sel + 1));
            ui.separator();
            if sel > 0 && ui.button("▲ Move Up").clicked() {
                move_step_up(state, sel);
            }
            let last = state.session.as_ref().map(|s| s.steps.len().saturating_sub(1)).unwrap_or(0);
            if sel < last && ui.button("▼ Move Down").clicked() {
                move_step_down(state, sel);
            }
            if ui.button("🗑 Delete").clicked() {
                delete_step(state, sel);
                return; // avoid accessing stale sel below
            }
        });
        ui.separator();
    }

    // If a step is selected, show full image + description editor
    let sel_idx = match state.selected_step_idx {
        Some(i) => i,
        None => {
            ui.label("Click a step thumbnail on the left to select it.");
            return;
        }
    };

    let (step_id, desc, keystrokes_opt) = state
        .session
        .as_ref()
        .and_then(|s| s.steps.get(sel_idx))
        .map(|s| (s.id, s.description.clone(), s.keystrokes.clone()))
        .unwrap_or((0, String::new(), None));

    // Description editor
    ui.label("Description:");
    let mut desc_buf = desc.clone();
    let resp = ui.add(
        egui::TextEdit::multiline(&mut desc_buf)
            .desired_width(f32::INFINITY)
            .desired_rows(3),
    );
    if resp.changed() {
        if let Some(session) = &mut state.session {
            if let Some(step) = session.steps.get_mut(sel_idx) {
                step.description = desc_buf;
            }
        }
    }

    // Keystrokes editor
    ui.add_space(4.0);
    ui.label("Keystrokes:");
    let mut ks_buf = keystrokes_opt.clone().unwrap_or_default();
    let ks_resp = ui.add(
        egui::TextEdit::singleline(&mut ks_buf)
            .desired_width(f32::INFINITY)
            .hint_text("(none)"),
    );
    if ks_resp.changed() {
        if let Some(session) = &mut state.session {
            if let Some(step) = session.steps.get_mut(sel_idx) {
                step.keystrokes = if ks_buf.is_empty() { None } else { Some(ks_buf) };
                if let Err(e) = crate::session::save_session(session) {
                    state.error_message = Some(format!("Save failed: {e}"));
                }
            }
        }
    }

    ui.separator();

    // Full screenshot preview
    ScrollArea::both().id_salt("preview_scroll").show(ui, |ui| {
        if let Some(tex) = state.textures.get(&step_id) {
            let available = ui.available_size();
            let tex_size = tex.size_vec2();
            // Scale to fit width, preserve aspect
            let scale = (available.x / tex_size.x).min(1.0);
            let display_size = tex_size * scale;
            ui.image(egui::load::SizedTexture::new(tex.id(), display_size));
        }
    });
}

// ── step management helpers ─────────────────────────────────────────────────

fn delete_step(state: &mut AppState, idx: usize) {
    if let Some(session) = &mut state.session {
        if idx < session.steps.len() {
            let step = session.steps.remove(idx);
            state.textures.remove(&step.id);
            // Also remove the deleted step from the LRU deque.
            state.texture_lru.retain(|&lru_id| lru_id != step.id);
            let _ = std::fs::remove_file(&step.image_path);
            // Re-number remaining
            for (i, s) in session.steps.iter_mut().enumerate() {
                s.order = i + 1;
            }
        }
    }
    state.selected_step_idx = None;
}

fn move_step_up(state: &mut AppState, idx: usize) {
    if let Some(session) = &mut state.session {
        if idx > 0 {
            session.steps.swap(idx, idx - 1);
            renumber(&mut session.steps);
            state.selected_step_idx = Some(idx - 1);
        }
    }
}

fn move_step_down(state: &mut AppState, idx: usize) {
    if let Some(session) = &mut state.session {
        if idx + 1 < session.steps.len() {
            session.steps.swap(idx, idx + 1);
            renumber(&mut session.steps);
            state.selected_step_idx = Some(idx + 1);
        }
    }
}

fn renumber(steps: &mut [Step]) {
    for (i, s) in steps.iter_mut().enumerate() {
        s.order = i + 1;
    }
}

// ── export helpers ───────────────────────────────────────────────────────────

fn export_markdown(state: &mut AppState) {
    let session = match &state.session {
        Some(s) => s.clone(),
        None => return,
    };
    if let Some(path) = rfd::FileDialog::new()
        .add_filter("Markdown", &["md"])
        .set_file_name("tutorial.md")
        .set_title("Export as Markdown")
        .save_file()
    {
        match crate::export::markdown::export(&session, &path) {
            Ok(_) => {
                let _ = open::that(&path);
                state.export_message = Some(format!("Exported → {}", path.display()));
                state.error_message = None;
            }
            Err(e) => {
                state.error_message = Some(format!("Markdown export failed: {e}"));
            }
        }
    }
}

fn export_html(state: &mut AppState) {
    // Don't start a second export if one is already running.
    if state.export_progress.is_some() {
        return;
    }

    let session = match &state.session {
        Some(s) => s.clone(),
        None => return,
    };

    let path = match rfd::FileDialog::new()
        .add_filter("HTML", &["html"])
        .set_file_name("tutorial.html")
        .set_title("Export as HTML")
        .save_file()
    {
        Some(p) => p,
        None => return,
    };

    let (tx, rx) = mpsc::channel::<ExportMsg>();
    state.export_rx = Some(rx);
    state.export_progress = Some(0.0);
    state.export_message = None;
    state.error_message = None;

    std::thread::Builder::new()
        .name("html-export".to_string())
        .spawn(move || {
            let result = crate::export::html::export(&session, &path, Some(&tx))
                .map(|_| path.clone())
                .map_err(|e| e.to_string());
            let _ = tx.send(ExportMsg::Done(result));
        })
        .ok();
}
