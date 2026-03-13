use crate::model::{Session, Step, StepExportChoice};
use anyhow::Result;
use base64::Engine;
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::Path;

/// Export the session as a fully self-contained HTML file.
///
/// All images are embedded as base64 data URIs so the file can be shared
/// without the `images/` folder.
///
/// If `on_progress` is provided, it is called after each step is encoded with
/// a value in [0.0, 1.0] representing the fraction of steps completed.
pub fn export(
    session: &Session,
    output_path: &Path,
    on_progress: Option<impl Fn(f32)>,
) -> Result<()> {
    let exported_steps: Vec<&Step> = session
        .steps
        .iter()
        .filter(|s| s.export_choice != StepExportChoice::Skip)
        .collect();
    let total = exported_steps.len();

    let file = File::create(output_path)?;
    let mut w = BufWriter::new(file);

    let created = session.created_at.format("%Y-%m-%d %H:%M UTC");
    let title = html_escape(&session.name);

    // Write the HTML header and style block directly to the file.
    write!(
        w,
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title}</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; }}
    body {{
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 960px;
      margin: 0 auto;
      padding: 2rem 1rem;
      color: #1a1a2e;
      background: #f8f9fa;
    }}
    h1 {{ margin-bottom: 0.25rem; }}
    .meta {{ color: #666; font-size: 0.875rem; margin-bottom: 2rem; }}
    .step {{
      background: #fff;
      border: 1px solid #dee2e6;
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 2rem;
    }}
    .step h2 {{ margin-top: 0; color: #495057; }}
    .step img {{
      max-width: 100%;
      height: auto;
      border: 1px solid #ced4da;
      border-radius: 4px;
      display: block;
      cursor: zoom-in;
    }}
    /* ── lightbox ── */
    #lb {{
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,.92);
      z-index: 9999;
      justify-content: center;
      align-items: center;
      cursor: zoom-out;
    }}
    #lb.on {{ display: flex; }}
    #lb img {{
      max-width: 95vw;
      max-height: 95vh;
      object-fit: contain;
      border-radius: 4px;
      box-shadow: 0 0 60px rgba(0,0,0,.8);
    }}
    #lb-close {{
      position: fixed;
      top: 1rem;
      right: 1.25rem;
      color: #fff;
      font-size: 2rem;
      line-height: 1;
      cursor: pointer;
      user-select: none;
      opacity: .8;
    }}
    #lb-close:hover {{ opacity: 1; }}
    .desc {{ margin-top: 0.75rem; line-height: 1.6; }}
    blockquote {{
      background: #f1f3f5;
      border-left: 4px solid #4c6ef5;
      margin: 0.75rem 0 0;
      padding: 0.5rem 1rem;
      border-radius: 0 4px 4px 0;
    }}
    code {{ font-family: ui-monospace, monospace; }}
    .monitor-label {{ margin-top: 1rem; margin-bottom: 0.25rem; }}
    @media (prefers-color-scheme: dark) {{
      body {{ color: #e1e1e6; background: #121214; }}
      .meta {{ color: #999; }}
      .step {{ background: #1e1e24; border-color: #2e2e38; }}
      .step h2 {{ color: #a0a0b0; }}
      .step img {{ border-color: #3a3a4a; }}
      blockquote {{ background: #1a1a2e; border-left-color: #748ffc; }}
    }}
  </style>
</head>
<body>
  <!-- lightbox overlay -->
  <div id="lb" onclick="closeLb()">
    <span id="lb-close" onclick="closeLb()" title="Close (Esc)">&times;</span>
    <img id="lb-img" src="" alt="" onclick="event.stopPropagation()" />
  </div>

  <h1>{title}</h1>
  <p class="meta">Created: {created} &nbsp;·&nbsp; {step_count} step(s) &nbsp;·&nbsp;
    <em>Click any image to zoom</em></p>
"#,
        title = title,
        created = created,
        step_count = session.steps.len(),
    )?;

    // Write each step directly to the file without accumulating in memory.
    for (i, step) in exported_steps.iter().enumerate() {
        // Build the image(s) HTML based on the step's export_choice.
        match &step.export_choice {
            StepExportChoice::Primary => {
                let img_bytes = fs::read(&step.image_path)?;
                let b64 = base64::engine::general_purpose::STANDARD.encode(&img_bytes);
                write!(
                    w,
                    "  <section class=\"step\">\n    <h2>Step {order}</h2>\n    <img src=\"data:image/png;base64,{b64}\" alt=\"Step {order}\" loading=\"lazy\" />\n",
                    order = step.order,
                    b64 = b64,
                )?;
            }
            StepExportChoice::Extra(idx) => {
                let path = step.extra_image_paths.get(*idx).unwrap_or(&step.image_path);
                let img_bytes = fs::read(path)?;
                let b64 = base64::engine::general_purpose::STANDARD.encode(&img_bytes);
                write!(
                    w,
                    "  <section class=\"step\">\n    <h2>Step {order}</h2>\n    <img src=\"data:image/png;base64,{b64}\" alt=\"Step {order}\" loading=\"lazy\" />\n",
                    order = step.order,
                    b64 = b64,
                )?;
            }
            StepExportChoice::All => {
                let primary_bytes = fs::read(&step.image_path)?;
                let primary_b64 = base64::engine::general_purpose::STANDARD.encode(&primary_bytes);
                write!(
                    w,
                    "  <section class=\"step\">\n    <h2>Step {order}</h2>\n    <img src=\"data:image/png;base64,{b64}\" alt=\"Step {order}\" loading=\"lazy\" />\n",
                    order = step.order,
                    b64 = primary_b64,
                )?;
                for (j, extra_path) in step.extra_image_paths.iter().enumerate() {
                    let extra_bytes = fs::read(extra_path)?;
                    let extra_b64 = base64::engine::general_purpose::STANDARD.encode(&extra_bytes);
                    let mon_idx = step.extra_monitor_indices.get(j).copied().unwrap_or(j + 1);
                    write!(
                        w,
                        "    <p class=\"monitor-label\"><strong>Monitor {}:</strong></p>\n    <img src=\"data:image/png;base64,{b64}\" alt=\"Step {order} Monitor {mon_num}\" loading=\"lazy\" />\n",
                        mon_idx + 1,
                        b64 = extra_b64,
                        order = step.order,
                        mon_num = mon_idx + 1,
                    )?;
                }
            }
            // Skip is pre-filtered; this arm is unreachable but satisfies exhaustiveness.
            StepExportChoice::Skip => {}
        }

        if !step.description.is_empty() {
            write!(w, "    <p class=\"desc\">{}</p>\n", html_escape(&step.description))?;
        }

        match &step.keystrokes {
            Some(ks) if !ks.is_empty() => {
                write!(w, "    <blockquote>Typed: <code>{}</code></blockquote>\n", html_escape(ks))?;
            }
            _ => {}
        }

        w.write_all(b"  </section>\n")?;

        // Report per-step progress
        if let Some(ref cb) = on_progress {
            let progress = (i + 1) as f32 / total.max(1) as f32;
            cb(progress);
        }
    }

    // Write the closing script and HTML tags.
    w.write_all(
        b"  <script>\n    function openLb(src) {\n      document.getElementById('lb-img').src = src;\n      document.getElementById('lb').classList.add('on');\n    }\n    function closeLb() {\n      document.getElementById('lb').classList.remove('on');\n    }\n    document.addEventListener('keydown', function(e) {\n      if (e.key === 'Escape') closeLb();\n    });\n    document.querySelectorAll('.step img').forEach(function(img) {\n      img.addEventListener('click', function() { openLb(this.src); });\n    });\n  </script>\n</body>\n</html>\n",
    )?;

    Ok(())
}

fn html_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + s.len() / 8);
    for c in s.chars() {
        match c {
            '&'  => out.push_str("&amp;"),
            '<'  => out.push_str("&lt;"),
            '>'  => out.push_str("&gt;"),
            '"'  => out.push_str("&quot;"),
            '\'' => out.push_str("&#x27;"),
            _    => out.push(c),
        }
    }
    out
}
