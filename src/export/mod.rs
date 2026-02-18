pub mod html;
pub mod markdown;
// pub mod pdf; // Phase 2 — requires typst-as-lib

use crate::model::Session;
use anyhow::Result;
use std::path::Path;

/// Common interface for all export formats (used by Phase 2 PDF exporter).
#[allow(dead_code)]
pub trait Exporter {
    fn export(&self, session: &Session, output_path: &Path) -> Result<()>;
}
