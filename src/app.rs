use crate::capture::{capture_step, list_monitor_infos, monitor_display_name};
use crate::model::ClickPoint;
use crate::state::{AppState, HookEvent, HotKey, RecordingState};
use std::sync::mpsc;

pub struct RecApp {
    pub state: AppState,
}

impl RecApp {
    pub fn new(_cc: &eframe::CreationContext<'_>) -> Self {
        // Enumerate monitors immediately so the idle panel's ComboBox is populated.
        let monitor_infos = list_monitor_infos();
        let monitor_names = monitor_infos
            .iter()
            .enumerate()
            .map(|(i, m)| monitor_display_name(m, i))
            .collect();

        // Create the step channel once for the entire app lifetime.
        let (step_tx, step_rx) = mpsc::channel::<crate::model::Step>();

        // Spawn the global input hook (one per process — rdev has no stop API).
        let (hook_tx, hook_rx) = mpsc::channel::<HookEvent>();
        crate::hooks::spawn_hook_thread(hook_tx);

        let mut state = AppState::default();
        state.monitor_names = monitor_names;
        state.monitor_infos = monitor_infos;
        state.hook_rx = Some(hook_rx);
        state.step_rx = Some(step_rx);
        state.step_tx = Some(step_tx);

        Self { state }
    }
}

impl eframe::App for RecApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // ── 1. Drain inter-thread channels ────────────────────────────────────
        self.drain_hook_events(ctx);
        self.drain_step_completions();

        // ── 2. Handle deferred "stop recording" request ───────────────────────
        if self.state.stop_recording_requested {
            self.state.stop_recording_requested = false;
            self.do_stop_recording();
        }

        // ── 3. Identify-monitor overlays ─────────────────────────────────────
        self.show_identify_overlays(ctx);

        // ── 4. Update window title ────────────────────────────────────────────
        let title = match &self.state.session {
            Some(s) => format!("rec — {}", s.name),
            None => "rec — Step Recorder".to_string(),
        };
        ctx.send_viewport_cmd(egui::ViewportCommand::Title(title));

        // ── 5. Route to the correct UI panel ─────────────────────────────────
        match self.state.recording_state {
            RecordingState::Idle => {
                crate::ui::idle::show(ctx, &mut self.state);
            }
            RecordingState::Recording | RecordingState::Paused => {
                crate::ui::recording::show(ctx, &mut self.state);
            }
            RecordingState::Reviewing => {
                crate::ui::review::show(ctx, &mut self.state);
            }
        }

        // Keep repainting during recording or identify so everything stays live.
        // (The identify branch already requests repaint, but also cover recording.)
        if matches!(
            self.state.recording_state,
            RecordingState::Recording | RecordingState::Paused
        ) {
            ctx.request_repaint();
        }
    }
}

// ── private helpers ───────────────────────────────────────────────────────────

impl RecApp {
    /// Show a small OSD badge on every monitor displaying its 1-based index,
    /// similar to Windows Display Settings → "Identify". Transparent borderless
    /// window, dark rounded background, large white number. Auto-closes after
    /// the timer expires.
    fn show_identify_overlays(&mut self, ctx: &egui::Context) {
        let until = match self.state.identify_until {
            Some(t) => t,
            None => return,
        };

        if std::time::Instant::now() >= until {
            self.state.identify_until = None;
            return;
        }

        // Physical → logical pixel conversion for window placement.
        let ppp = ctx.pixels_per_point();
        let infos = self.state.monitor_infos.clone();

        // Badge size in logical pixels — large enough to read, small enough to
        // not cover the screen content.
        let badge_l = 180.0f32;

        for (i, info) in infos.iter().enumerate() {
            let mon_lx = info.x as f32 / ppp;
            let mon_ly = info.y as f32 / ppp;
            let mon_lw = info.width as f32 / ppp;
            let mon_lh = info.height as f32 / ppp;

            // Center the badge on the monitor.
            let bx = mon_lx + mon_lw / 2.0 - badge_l / 2.0;
            let by = mon_ly + mon_lh / 2.0 - badge_l / 2.0;

            let label = format!("{}", i + 1);

            ctx.show_viewport_immediate(
                egui::ViewportId::from_hash_of(format!("identify_{i}")),
                egui::ViewportBuilder::default()
                    .with_position(egui::pos2(bx, by))
                    .with_inner_size(egui::vec2(badge_l, badge_l))
                    .with_decorations(false)
                    .with_always_on_top()
                    .with_transparent(true),
                move |ctx, _class| {
                    // Transparent panel — we paint everything ourselves.
                    egui::CentralPanel::default()
                        .frame(egui::Frame::NONE)
                        .show(ctx, |ui| {
                            let rect = ui.available_rect_before_wrap();
                            let painter = ui.painter();

                            // Dark semi-transparent rounded badge
                            painter.rect_filled(
                                rect,
                                rect.height() * 0.18,
                                egui::Color32::from_rgba_unmultiplied(10, 10, 30, 220),
                            );

                            // Monitor index number
                            painter.text(
                                rect.center(),
                                egui::Align2::CENTER_CENTER,
                                &label,
                                egui::FontId::proportional(rect.height() * 0.65),
                                egui::Color32::WHITE,
                            );
                        });
                },
            );
        }

        // Keep repainting every frame so the timer is checked.
        ctx.request_repaint();
    }

    fn drain_hook_events(&mut self, ctx: &egui::Context) {
        // Temporarily take the receiver to avoid borrowing self.state while also
        // mutably passing &mut self.state to the handler.
        let rx = match self.state.hook_rx.take() {
            Some(r) => r,
            None => return,
        };

        loop {
            match rx.try_recv() {
                Ok(event) => self.handle_hook_event(event, ctx),
                Err(_) => break,
            }
        }

        self.state.hook_rx = Some(rx);
    }

    fn handle_hook_event(&mut self, event: HookEvent, ctx: &egui::Context) {
        match event {
            HookEvent::Click(x, y) => {
                if self.state.recording_state != RecordingState::Recording {
                    return;
                }
                // Skip clicks that land inside the rec window itself.
                if let Some(bounds) = self.state.rec_window_bounds {
                    let fx = x as f32;
                    let fy = y as f32;
                    if fx >= bounds[0]
                        && fx <= bounds[0] + bounds[2]
                        && fy >= bounds[1]
                        && fy <= bounds[1] + bounds[3]
                    {
                        return;
                    }
                }
                // Skip clicks outside the selected monitor when the filter is on.
                if self.state.capture_selected_only {
                    if let Some((mx, my, mw, mh)) = self.state.selected_monitor_rect {
                        if x < mx || x >= mx + mw as i32 || y < my || y >= my + mh as i32 {
                            return;
                        }
                    }
                }
                self.spawn_capture(Some(ClickPoint { x: x as u32, y: y as u32 }));
            }
            HookEvent::KeyCombo(hotkey) => {
                match hotkey {
                    HotKey::Pause => {
                        if self.state.recording_state == RecordingState::Recording {
                            self.state.recording_state = RecordingState::Paused;
                        } else if self.state.recording_state == RecordingState::Paused {
                            self.state.recording_state = RecordingState::Recording;
                        }
                    }
                    HotKey::Stop => {
                        self.do_stop_recording();
                    }
                    HotKey::ManualCapture => {
                        if self.state.recording_state == RecordingState::Recording {
                            self.spawn_capture(None);
                        }
                    }
                }
                ctx.request_repaint();
            }
        }
    }

    /// Spawn a capture thread for one screenshot.
    fn spawn_capture(&mut self, click: Option<ClickPoint>) {
        let session = match &self.state.session {
            Some(s) => s.clone(),
            None => return,
        };
        let tx = match self.state.step_tx.clone() {
            Some(t) => t,
            None => return,
        };

        let step_id = self.state.next_step_id;
        let order = step_id;
        self.state.next_step_id += 1;

        let monitor_index = session.monitor_index;
        let session_dir = session.session_dir.clone();

        std::thread::Builder::new()
            .name(format!("capture-{step_id}"))
            .spawn(move || {
                match capture_step(monitor_index, click, step_id, order, &session_dir) {
                    Ok(step) => {
                        let _ = tx.send(step);
                    }
                    Err(e) => {
                        eprintln!("[capture-{step_id}] error: {e}");
                    }
                }
            })
            .ok();
    }

    fn drain_step_completions(&mut self) {
        let rx = match self.state.step_rx.take() {
            Some(r) => r,
            None => return,
        };

        let mut got_new = false;
        loop {
            match rx.try_recv() {
                Ok(step) => {
                    if let Some(session) = &mut self.state.session {
                        session.steps.push(step);
                        // Keep steps sorted by ID (arrival may be out of order for rapid clicks).
                        session.steps.sort_by_key(|s| s.id);
                        // Renumber `order` to match position.
                        for (i, s) in session.steps.iter_mut().enumerate() {
                            s.order = i + 1;
                        }
                        got_new = true;
                    }
                }
                Err(_) => break,
            }
        }

        self.state.step_rx = Some(rx);

        // Persist session.json after each new step
        if got_new {
            if let Some(session) = &self.state.session {
                if let Err(e) = crate::session::save_session(session) {
                    eprintln!("[session] auto-save failed: {e}");
                }
            }
        }
    }

    fn do_stop_recording(&mut self) {
        self.state.recording_state = RecordingState::Reviewing;

        if let Some(session) = &self.state.session {
            if let Err(e) = crate::session::save_session(session) {
                self.state.error_message = Some(format!("Session auto-save failed: {e}"));
            }
        }
    }
}
