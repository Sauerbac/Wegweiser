use super::{emit_undo_state, push_undo, AppStateHandle};
use crate::model::ImageEdit;
use crate::session;
use base64::Engine;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub fn get_step_image(image_path: String) -> Result<String, String> {
    let path = std::path::Path::new(&image_path);

    // architecture-014: use the shared confine_to_sessions_dir helper
    let canonical_path = session::confine_to_sessions_dir(path)?;

    // Verify the file has a .png extension
    if !canonical_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("png"))
        .unwrap_or(false)
    {
        return Err("Only PNG files are allowed".to_string());
    }

    let bytes = std::fs::read(&canonical_path).map_err(|e| e.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/png;base64,{}", b64))
}

#[tauri::command]
pub fn save_annotations(
    step_id: usize,
    annotations_json: Option<String>,
    preview_png_base64: Option<String>,
    extra_index: Option<usize>,
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let session_clone = {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        push_undo(&mut st);

        let session = st.session.as_mut().ok_or("No active session")?;
        let step = session.steps.iter_mut().find(|s| s.id == step_id)
            .ok_or("Step not found")?;

        let new_version = step.image_version + 1;

        // Determine which image path to operate on (primary vs extra).
        let base_image_path = match extra_index {
            None => &step.image_path,
            Some(i) => step.extra_image_paths.get(i)
                .ok_or("Extra image index out of range")?,
        };

        // Write or clear the preview PNG. Filenames are versioned so each save
        // produces a new file rather than overwriting the previous one — past
        // undo snapshots in `undo_history` reference the path their save wrote,
        // so destroying that file would render those undo entries non-restorable.
        // Old preview files are retained for the lifetime of the session and
        // reclaimed when the session directory is deleted.
        if let Some(ref b64) = preview_png_base64 {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|e| format!("Invalid base64: {e}"))?;
            let preview_filename = match extra_index {
                None => format!("step_{:04}_preview_v{}.png", step_id, new_version),
                Some(ei) => format!("step_{:04}_extra{}_preview_v{}.png", step_id, ei, new_version),
            };
            let dir = base_image_path.parent().unwrap_or(std::path::Path::new("."));
            let preview_path = dir.join(preview_filename);
            std::fs::write(&preview_path, &bytes).map_err(|e| e.to_string())?;
            step.preview_path = Some(preview_path);
        } else {
            // Annotations cleared: drop the reference but do NOT delete the file —
            // a prior undo snapshot may still reference it.
            step.preview_path = None;
        }

        step.annotations_json = annotations_json;
        step.image_version = new_version;

        if let Err(e) = session::save_session(session) {
            eprintln!("[save_annotations] save failed: {e}");
        }

        st.session.clone()
    };

    if let Some(s) = session_clone {
        app_handle.emit("session-updated", &s).map_err(|e| e.to_string())?;
    }
    emit_undo_state(&state, &app_handle);
    Ok(())
}

#[tauri::command]
pub fn apply_image_edit(
    step_id: usize,
    edit: ImageEdit,
    extra_index: Option<usize>,
    state: State<'_, AppStateHandle>,
    app_handle: AppHandle,
) -> Result<(), String> {
    // Phase 1: push undo, collect the image path and current version (with lock).
    let (image_path, current_version) = {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        push_undo(&mut st);
        let session = st.session.as_ref().ok_or("No active session")?;
        let step = session.steps.iter().find(|s| s.id == step_id)
            .ok_or("Step not found")?;
        let path = match extra_index {
            None => step.image_path.clone(),
            Some(i) => step.extra_image_paths.get(i)
                .ok_or("Extra image index out of range")?
                .clone(),
        };
        (path, step.image_version)
    };

    // Phase 2: image manipulation — no lock held.
    let new_version = current_version + 1;

    // Determine output path for the versioned edited file.
    let dir = image_path.parent().unwrap_or(std::path::Path::new("."));
    let new_image_path = match extra_index {
        None => dir.join(format!("step_{:04}_edit{}.png", step_id, new_version)),
        Some(ei) => dir.join(format!("step_{:04}_extra{}_edit{}.png", step_id, ei, new_version)),
    };

    let img = image::open(&image_path).map_err(|e| e.to_string())?.to_rgba8();

    // Track the final crop rect (in image pixels) so we can transform window_rects
    // in Phase 3 — only set for Crop edits, None for Blur.
    let mut crop_rect: Option<(u32, u32, u32, u32)> = None;

    let result_img: image::RgbaImage = match edit {
        ImageEdit::Blur { x, y, w, h, sigma } => {
            let px = (x.max(0) as u32).min(img.width());
            let py = (y.max(0) as u32).min(img.height());
            let pw = w.min(img.width().saturating_sub(px));
            let ph = h.min(img.height().saturating_sub(py));
            if pw == 0 || ph == 0 {
                return Err("Blur region is empty".to_string());
            }
            let sub = image::imageops::crop_imm(&img, px, py, pw, ph).to_image();
            let blurred = imageproc::filter::gaussian_blur_f32(&sub, sigma);
            let mut result = img.clone();
            image::imageops::replace(&mut result, &blurred, px as i64, py as i64);
            result
        }
        ImageEdit::Crop { x, y, w, h } => {
            let px = (x.max(0) as u32).min(img.width());
            let py = (y.max(0) as u32).min(img.height());
            let pw = w.min(img.width().saturating_sub(px));
            let ph = h.min(img.height().saturating_sub(py));
            if pw == 0 || ph == 0 {
                return Err("Crop region is empty".to_string());
            }
            crop_rect = Some((px, py, pw, ph));
            image::imageops::crop_imm(&img, px, py, pw, ph).to_image()
        }
    };

    result_img.save(&new_image_path).map_err(|e| e.to_string())?;

    // Phase 3: update session metadata (with lock).
    let session_clone = {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(ref mut session) = st.session {
            if let Some(step) = session.steps.iter_mut().find(|s| s.id == step_id) {
                step.image_version = new_version;
                match extra_index {
                    None => {
                        step.image_path = new_image_path;
                        // Bug-004: after a crop the window_rects still reference the
                        // original coordinate space.  Translate by the crop origin and
                        // clamp to the new image dimensions so subsequent window-select
                        // operations in the editor stay aligned.
                        if let Some((crop_x, crop_y, crop_w, crop_h)) = crop_rect {
                            step.window_rects = step.window_rects.iter()
                                .filter_map(|wr| {
                                    let nx = wr.x - crop_x as i32;
                                    let ny = wr.y - crop_y as i32;
                                    let cx = nx.max(0);
                                    let cy = ny.max(0);
                                    let cw = ((nx + wr.w as i32).min(crop_w as i32) - cx).max(0) as u32;
                                    let ch = ((ny + wr.h as i32).min(crop_h as i32) - cy).max(0) as u32;
                                    if cw == 0 || ch == 0 {
                                        None // rect is fully outside the crop area
                                    } else {
                                        Some(crate::model::WindowRect {
                                            title: wr.title.clone(),
                                            x: cx,
                                            y: cy,
                                            w: cw,
                                            h: ch,
                                        })
                                    }
                                })
                                .collect();
                        }
                    }
                    Some(ei) => {
                        if let Some(p) = step.extra_image_paths.get_mut(ei) {
                            *p = new_image_path;
                        }
                    }
                }
            }
            if let Err(e) = session::save_session(session) {
                eprintln!("[save_session] failed: {e}");
            }
        }
        st.session.clone()
    };

    if let Some(s) = session_clone {
        app_handle.emit("session-updated", &s).map_err(|e| e.to_string())?;
    }
    emit_undo_state(&state, &app_handle);
    Ok(())
}
