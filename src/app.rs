use crate::capture::{capture_step, list_monitor_infos, monitor_display_name};
use crate::model::ClickPoint;
use crate::state::{AppState, HookEvent, HotKey, RecordingState};
use rdev::Key;
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
        // ── 0. Try to latch the mini-bar bounding rect (retried each frame
        //       until egui reports a valid inner_rect after the resize).
        if self.state.window_is_mini && self.state.rec_window_bounds.is_none() {
            if let Some(rect) = ctx.input(|i| i.viewport().inner_rect) {
                let ppp = ctx.pixels_per_point();
                self.state.rec_window_bounds = Some([
                    rect.min.x * ppp,
                    rect.min.y * ppp,
                    rect.width() * ppp,
                    rect.height() * ppp,
                ]);
            }
        }

        // ── 1. Drain inter-thread channels ────────────────────────────────────
        self.drain_hook_events(ctx);
        self.drain_step_completions();
        self.drain_export_progress(ctx);

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

        // ── 6. Error modal (dismissible floating window) ──────────────────────
        self.show_error_modal(ctx);

        // ── 7. Apply mini-bar / normal window mode ────────────────────────────
        self.apply_window_mode(ctx);

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
            HookEvent::KeyPress(key) => {
                if self.state.recording_state != RecordingState::Recording {
                    return;
                }
                let ctrl = self.state.ctrl_held;
                let shift = self.state.shift_held;
                let alt = self.state.alt_held;
                if let Some(token) = key_token(&key, ctrl, shift, alt) {
                    self.state.pending_keystrokes.push_str(&token);
                }
            }
            HookEvent::ModifierDown(key) => {
                use rdev::Key;
                match key {
                    Key::ControlLeft | Key::ControlRight => self.state.ctrl_held = true,
                    Key::ShiftLeft | Key::ShiftRight => self.state.shift_held = true,
                    Key::Alt | Key::AltGr => self.state.alt_held = true,
                    _ => {}
                }
            }
            HookEvent::ModifierUp(key) => {
                use rdev::Key;
                match key {
                    Key::ControlLeft | Key::ControlRight => self.state.ctrl_held = false,
                    Key::ShiftLeft | Key::ShiftRight => self.state.shift_held = false,
                    Key::Alt | Key::AltGr => self.state.alt_held = false,
                    _ => {}
                }
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

        // Drain the keystroke buffer for this step and clear it.
        let keystrokes = if self.state.pending_keystrokes.is_empty() {
            None
        } else {
            Some(std::mem::take(&mut self.state.pending_keystrokes))
        };

        std::thread::Builder::new()
            .name(format!("capture-{step_id}"))
            .spawn(move || {
                match capture_step(monitor_index, click, step_id, order, &session_dir, keystrokes) {
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

    /// Drain messages from the HTML export background thread.
    fn drain_export_progress(&mut self, ctx: &egui::Context) {
        use crate::state::ExportMsg;

        let rx = match self.state.export_rx.take() {
            Some(r) => r,
            None => return,
        };

        let mut finished = false;
        loop {
            match rx.try_recv() {
                Ok(ExportMsg::Progress(p)) => {
                    self.state.export_progress = Some(p);
                }
                Ok(ExportMsg::Done(Ok(path))) => {
                    self.state.export_progress = None;
                    self.state.export_message =
                        Some(format!("Exported → {}", path.display()));
                    self.state.error_message = None;
                    // Open the file in the default browser / viewer.
                    let _ = open::that(&path);
                    finished = true;
                    break;
                }
                Ok(ExportMsg::Done(Err(e))) => {
                    self.state.export_progress = None;
                    self.state.error_message = Some(format!("HTML export failed: {e}"));
                    finished = true;
                    break;
                }
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => {
                    // Thread ended without sending Done — treat as error.
                    self.state.export_progress = None;
                    finished = true;
                    break;
                }
            }
        }

        if !finished {
            // Put the receiver back so we keep polling next frame.
            self.state.export_rx = Some(rx);
            // Keep repainting so the progress bar animates.
            ctx.request_repaint();
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

    /// Show a dismissible error modal when `state.error_message` is set.
    fn show_error_modal(&mut self, ctx: &egui::Context) {
        // Only show modal when NOT in mini mode; in mini mode error is shown inline.
        if self.state.window_is_mini {
            return;
        }
        let msg = match self.state.error_message.clone() {
            Some(m) => m,
            None => return,
        };
        egui::Window::new("Error")
            .anchor(egui::Align2::CENTER_CENTER, egui::vec2(0.0, 0.0))
            .collapsible(false)
            .resizable(false)
            .min_width(280.0)
            .show(ctx, |ui| {
                ui.add_space(4.0);
                ui.colored_label(egui::Color32::from_rgb(220, 70, 70), format!("⚠  {msg}"));
                ui.add_space(8.0);
                if ui.button("  Dismiss  ").clicked() {
                    self.state.error_message = None;
                }
                ui.add_space(4.0);
            });
    }

    /// Shrink the window to a compact borderless mini-bar during recording,
    /// and restore the full window when idle or reviewing.
    fn apply_window_mode(&mut self, ctx: &egui::Context) {
        let should_be_mini = matches!(
            self.state.recording_state,
            RecordingState::Recording | RecordingState::Paused
        );

        if should_be_mini && !self.state.window_is_mini {
            self.state.window_is_mini = true;
            ctx.send_viewport_cmd(egui::ViewportCommand::Decorations(false));
            ctx.send_viewport_cmd(egui::ViewportCommand::Resizable(false));
            ctx.send_viewport_cmd(egui::ViewportCommand::InnerSize(egui::vec2(380.0, 64.0)));
            ctx.send_viewport_cmd(egui::ViewportCommand::WindowLevel(
                egui::WindowLevel::AlwaysOnTop,
            ));
        } else if !should_be_mini && self.state.window_is_mini {
            self.state.window_is_mini = false;
            self.state.rec_window_bounds = None;
            ctx.send_viewport_cmd(egui::ViewportCommand::WindowLevel(
                egui::WindowLevel::Normal,
            ));
            ctx.send_viewport_cmd(egui::ViewportCommand::Decorations(true));
            ctx.send_viewport_cmd(egui::ViewportCommand::Resizable(true));
            ctx.send_viewport_cmd(egui::ViewportCommand::InnerSize(egui::vec2(900.0, 650.0)));
        }
    }
}

/// Build the token to append to `pending_keystrokes` for a key press.
///
/// Returns `None` for modifier keys (they are tracked separately) and for any
/// key that should be silently ignored.  Otherwise returns the string to append:
/// - With Ctrl or Alt held: `[Ctrl+C]`, `[Alt+F4]`, `[Ctrl+Shift+Z]`, etc.
/// - With only Shift held on a letter: uppercase letter (e.g. `"A"`)
/// - With only Shift held on a special key: `[Shift+Enter]`, `[Shift+Tab]`, etc.
/// - Plain printable key (letter, digit): the character itself (e.g. `"a"`, `"1"`)
/// - Plain special key: bracketed name (e.g. `[Space]`, `[Enter]`, `[Backspace]`)
fn key_token(key: &Key, ctrl: bool, shift: bool, alt: bool) -> Option<String> {
    // Modifier keys themselves never produce a token.
    match key {
        Key::ShiftLeft
        | Key::ShiftRight
        | Key::ControlLeft
        | Key::ControlRight
        | Key::Alt
        | Key::AltGr
        | Key::MetaLeft
        | Key::MetaRight
        | Key::CapsLock => return None,
        _ => {}
    }

    // The display name used inside bracketed tokens.
    let name: &str = match key {
        Key::KeyA => "A", Key::KeyB => "B", Key::KeyC => "C", Key::KeyD => "D",
        Key::KeyE => "E", Key::KeyF => "F", Key::KeyG => "G", Key::KeyH => "H",
        Key::KeyI => "I", Key::KeyJ => "J", Key::KeyK => "K", Key::KeyL => "L",
        Key::KeyM => "M", Key::KeyN => "N", Key::KeyO => "O", Key::KeyP => "P",
        Key::KeyQ => "Q", Key::KeyR => "R", Key::KeyS => "S", Key::KeyT => "T",
        Key::KeyU => "U", Key::KeyV => "V", Key::KeyW => "W", Key::KeyX => "X",
        Key::KeyY => "Y", Key::KeyZ => "Z",
        Key::Num0 => "0", Key::Num1 => "1", Key::Num2 => "2", Key::Num3 => "3",
        Key::Num4 => "4", Key::Num5 => "5", Key::Num6 => "6", Key::Num7 => "7",
        Key::Num8 => "8", Key::Num9 => "9",
        Key::Return    => "Enter",
        Key::Space     => "Space",
        Key::Tab       => "Tab",
        Key::Backspace => "Backspace",
        Key::Delete    => "Delete",
        Key::Escape    => "Esc",
        Key::Home      => "Home",
        Key::End       => "End",
        Key::PageUp    => "PgUp",
        Key::PageDown  => "PgDn",
        Key::UpArrow   => "Up",
        Key::DownArrow => "Down",
        Key::LeftArrow => "Left",
        Key::RightArrow=> "Right",
        Key::F1  => "F1",  Key::F2  => "F2",  Key::F3  => "F3",  Key::F4  => "F4",
        Key::F5  => "F5",  Key::F6  => "F6",  Key::F7  => "F7",  Key::F8  => "F8",
        Key::F9  => "F9",  Key::F10 => "F10", Key::F11 => "F11", Key::F12 => "F12",
        Key::Unknown(_) => "?",
        // Anything else (numpad, media keys, etc.) — ignore silently.
        _ => return None,
    };

    // Printable single-character keys (letters and digits).
    let is_printable = matches!(
        key,
        Key::KeyA | Key::KeyB | Key::KeyC | Key::KeyD | Key::KeyE | Key::KeyF
        | Key::KeyG | Key::KeyH | Key::KeyI | Key::KeyJ | Key::KeyK | Key::KeyL
        | Key::KeyM | Key::KeyN | Key::KeyO | Key::KeyP | Key::KeyQ | Key::KeyR
        | Key::KeyS | Key::KeyT | Key::KeyU | Key::KeyV | Key::KeyW | Key::KeyX
        | Key::KeyY | Key::KeyZ
        | Key::Num0 | Key::Num1 | Key::Num2 | Key::Num3 | Key::Num4
        | Key::Num5 | Key::Num6 | Key::Num7 | Key::Num8 | Key::Num9
    );

    if ctrl || alt {
        // Modifier combo: [Ctrl+Shift+Z], [Alt+F4], etc.
        let mut token = String::from("[");
        if ctrl  { token.push_str("Ctrl+"); }
        if alt   { token.push_str("Alt+"); }
        if shift { token.push_str("Shift+"); }
        token.push_str(name);
        token.push(']');
        Some(token)
    } else if shift {
        if is_printable {
            // Shift + letter/digit → uppercase / shifted char (rdev gives no shift info,
            // so we just uppercase ASCII letters and keep digits as-is).
            let ch = name.chars().next().unwrap();
            Some(ch.to_ascii_uppercase().to_string())
        } else {
            // Shift + special key → [Shift+Enter], [Shift+Tab], etc.
            Some(format!("[Shift+{name}]"))
        }
    } else if is_printable {
        // Plain printable key → lowercase character.
        Some(name.to_ascii_lowercase().to_string())
    } else {
        // Plain special key → [Space], [Enter], [Backspace], etc.
        Some(format!("[{name}]"))
    }
}
