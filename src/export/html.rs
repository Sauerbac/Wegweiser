use crate::model::Session;
use anyhow::Result;
use base64::Engine;
use std::fs;
use std::path::Path;
use std::sync::mpsc;

/// Export the session as a fully self-contained HTML file.
///
/// All images are embedded as base64 data URIs so the file can be shared
/// without the `images/` folder.
///
/// If `progress_tx` is provided, a `Progress(f32)` message is sent after
/// each step is encoded (values in [0.0, 1.0]).  The caller is responsible
/// for sending `Done(…)` itself — this function just sends progress ticks.
pub fn export(
    session: &Session,
    output_path: &Path,
    progress_tx: Option<&mpsc::Sender<crate::state::ExportMsg>>,
) -> Result<()> {
    let total = session.steps.len();
    let mut steps_html = String::new();

    for (i, step) in session.steps.iter().enumerate() {
        let img_bytes = fs::read(&step.image_path)?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&img_bytes);

        let desc_html = if step.description.is_empty() {
            String::new()
        } else {
            format!(
                "<p class=\"desc\">{}</p>",
                html_escape(&step.description)
            )
        };

        let keystroke_html = match &step.keystrokes {
            Some(ks) if !ks.is_empty() => {
                format!("<blockquote>Typed: <code>{}</code></blockquote>", html_escape(ks))
            }
            _ => String::new(),
        };

        steps_html.push_str(&format!(
            r#"
  <section class="step">
    <h2>Step {order}</h2>
    <img src="data:image/png;base64,{b64}" alt="Step {order}" loading="lazy" />
    {desc_html}
    {keystroke_html}
  </section>
"#,
            order = step.order,
            b64 = b64,
            desc_html = desc_html,
            keystroke_html = keystroke_html,
        ));

        // Report per-step progress
        if let Some(tx) = progress_tx {
            let progress = (i + 1) as f32 / total.max(1) as f32;
            let _ = tx.send(crate::state::ExportMsg::Progress(progress));
        }
    }

    let created = session.created_at.format("%Y-%m-%d %H:%M UTC");
    let title = html_escape(&session.name);

    let html = format!(
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
{steps_html}
  <script>
    function openLb(src) {{
      document.getElementById('lb-img').src = src;
      document.getElementById('lb').classList.add('on');
    }}
    function closeLb() {{
      document.getElementById('lb').classList.remove('on');
    }}
    document.addEventListener('keydown', function(e) {{
      if (e.key === 'Escape') closeLb();
    }});
    document.querySelectorAll('.step img').forEach(function(img) {{
      img.addEventListener('click', function() {{ openLb(this.src); }});
    }});
  </script>
</body>
</html>
"#,
        title = title,
        created = created,
        step_count = session.steps.len(),
        steps_html = steps_html,
    );

    fs::write(output_path, html.as_bytes())?;
    Ok(())
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#x27;")
}
