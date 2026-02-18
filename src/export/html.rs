use crate::model::Session;
use anyhow::Result;
use base64::Engine;
use std::fs;
use std::path::Path;

/// Export the session as a fully self-contained HTML file.
///
/// All images are embedded as base64 data URIs so the file can be shared
/// without the `images/` folder.
pub fn export(session: &Session, output_path: &Path) -> Result<()> {
    let mut steps_html = String::new();

    for step in &session.steps {
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
    }}
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
  <h1>{title}</h1>
  <p class="meta">Created: {created} &nbsp;·&nbsp; {step_count} step(s)</p>
{steps_html}
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
