// Hide the console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod annotate;
mod app;
mod capture;
mod export;
mod hooks;
mod model;
mod session;
mod state;
mod ui;

fn main() -> eframe::Result<()> {
    let native_options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("rec — Step Recorder")
            .with_inner_size([900.0, 650.0])
            .with_min_inner_size([600.0, 420.0]),
        ..Default::default()
    };

    eframe::run_native(
        "rec",
        native_options,
        Box::new(|cc| Ok(Box::new(app::RecApp::new(cc)))),
    )
}
