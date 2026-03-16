use crate::model::Session;
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
        let extra_count = step.extra_image_paths.len();
        let total_count = 1 + extra_count;

        // Derive effective selection from export_choice.
        // Empty vec = all included (migration sentinel for old `All`).
        let sel: Vec<bool> = if step.export_choice.is_empty() {
            vec![true; total_count]
        } else {
            (0..total_count)
                .map(|i| step.export_choice.get(i).copied().unwrap_or(false))
                .collect()
        };

        // Skip step if all monitors are excluded.
        if sel.iter().all(|&b| !b) {
            continue;
        }

        md.push_str(&format!("## Step {}\n\n", step.order));

        // Primary image (index 0).
        if sel[0] {
            let img_filename = format!("step_{:04}.png", step.id);
            let img_dest = images_dir.join(&img_filename);
            fs::copy(&step.image_path, &img_dest)?;
            md.push_str(&format!(
                "![Step {}](images/{})\n\n",
                step.order, img_filename
            ));
        }

        // Extra images (index i+1).
        for (i, extra_path) in step.extra_image_paths.iter().enumerate() {
            if sel[i + 1] {
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
