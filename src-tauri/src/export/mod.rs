pub mod html;
pub mod markdown;

use crate::model::Session;
use anyhow::Result;
use std::path::Path;

/// Common interface for all export formats.
#[allow(dead_code)]
pub trait Exporter {
    fn export(&self, session: &Session, output_path: &Path) -> Result<()>;
}
