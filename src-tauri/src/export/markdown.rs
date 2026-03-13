use crate::model::{Session, StepExportChoice};
use anyhow::Result;
use std::fs;
use std::path::Path;

/// Export the session as a Markdown file with a sibling `images/` folder.
///
/// Output layout:
/// ```
/// <output_path>          (e.g. tutorial.md)
/// images/
///   step_0001.png
///   step_0002.png
///   …
/// ```
pub fn export(session: &Session, output_path: &Path) -> Result<()> {
    let parent = output_path
        .parent()
        .unwrap_or_else(|| Path::new("."));
    let images_dir = parent.join("images");
    fs::create_dir_all(&images_dir)?;

    let mut md = String::new();
    let safe_name = session.name.replace('\n', " ").replace('\r', "");
    md.push_str(&format!("# {}\n\n", safe_name));
    md.push_str(&format!(
        "*Created: {}*\n\n",
        session.created_at.format("%Y-%m-%d %H:%M UTC")
    ));
    md.push_str("---\n\n");

    for step in session.steps.iter() {
        if step.export_choice == StepExportChoice::Skip {
            continue;
        }
        md.push_str(&format!("## Step {}\n\n", step.order));

        match &step.export_choice {
            StepExportChoice::Primary => {
                // Only the annotated primary image (current behavior).
                let img_filename = format!("step_{:04}.png", step.id);
                let img_dest = images_dir.join(&img_filename);
                fs::copy(&step.image_path, &img_dest)?;
                md.push_str(&format!(
                    "![Step {}](images/{})\n\n",
                    step.order, img_filename
                ));
            }
            StepExportChoice::Extra(i) => {
                // Use the requested extra image, falling back to primary if index is out of range.
                let src_path = step.extra_image_paths.get(*i)
                    .map(|p| p.as_path())
                    .unwrap_or_else(|| step.image_path.as_path());
                let img_filename = format!("step_{:04}.png", step.id);
                let img_dest = images_dir.join(&img_filename);
                fs::copy(src_path, &img_dest)?;
                md.push_str(&format!(
                    "![Step {}](images/{})\n\n",
                    step.order, img_filename
                ));
            }
            StepExportChoice::All => {
                // Primary image first, then each extra as a secondary figure.
                let primary_filename = format!("step_{:04}.png", step.id);
                let primary_dest = images_dir.join(&primary_filename);
                fs::copy(&step.image_path, &primary_dest)?;
                md.push_str(&format!(
                    "![Step {}](images/{})\n\n",
                    step.order, primary_filename
                ));

                for (i, extra_path) in step.extra_image_paths.iter().enumerate() {
                    let extra_filename = format!("step_{:04}_extra_{}.png", step.id, i);
                    let extra_dest = images_dir.join(&extra_filename);
                    fs::copy(extra_path, &extra_dest)?;
                    let mon_idx = step.extra_monitor_indices.get(i).copied().unwrap_or(i + 1);
                    md.push_str(&format!("**Monitor {}:**\n\n", mon_idx + 1));
                    md.push_str(&format!(
                        "![Step {} Monitor {}](images/{})\n\n",
                        step.order, mon_idx + 1, extra_filename
                    ));
                }
            }
            // Skip is handled by the continue guard above; unreachable here.
            StepExportChoice::Skip => {}
        }

        if !step.description.is_empty() {
            let safe_desc = step.description.replace('<', "&lt;").replace('>', "&gt;");
            md.push_str(&safe_desc);
            md.push_str("\n\n");
        }

        if let Some(ref ks) = step.keystrokes {
            if !ks.is_empty() {
                let safe_ks = ks.replace('<', "&lt;").replace('>', "&gt;");
                md.push_str(&format!("> Typed: `{safe_ks}`\n\n"));
            }
        }

        md.push_str("---\n\n");
    }

    fs::write(output_path, &md)?;
    Ok(())
}
