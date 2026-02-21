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
    md.push_str(&format!("# {}\n\n", session.name));
    md.push_str(&format!(
        "*Created: {}*\n\n",
        session.created_at.format("%Y-%m-%d %H:%M UTC")
    ));
    md.push_str("---\n\n");

    for (idx, step) in session.steps.iter().enumerate() {
        let img_filename = format!("step_{:04}.png", idx + 1);
        let img_dest = images_dir.join(&img_filename);
        fs::copy(&step.image_path, &img_dest)?;

        md.push_str(&format!("## Step {}\n\n", step.order));
        md.push_str(&format!(
            "![Step {}](images/{})\n\n",
            step.order, img_filename
        ));

        if !step.description.is_empty() {
            md.push_str(&step.description);
            md.push_str("\n\n");
        }

        if let Some(ref ks) = step.keystrokes {
            if !ks.is_empty() {
                md.push_str(&format!("> Typed: `{ks}`\n\n"));
            }
        }

        md.push_str("---\n\n");
    }

    fs::write(output_path, &md)?;
    Ok(())
}
