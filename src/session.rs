use crate::model::Session;
use anyhow::Result;
use std::fs;
use std::path::Path;

/// Save `session` as pretty-printed JSON to `<session.session_dir>/session.json`.
pub fn save_session(session: &Session) -> Result<()> {
    let path = session.session_dir.join("session.json");
    let json = serde_json::to_string_pretty(session)?;
    fs::write(path, json)?;
    Ok(())
}

/// Load a session from a JSON file at `path`.
pub fn load_session(path: &Path) -> Result<Session> {
    let json = fs::read_to_string(path)?;
    let session: Session = serde_json::from_str(&json)?;
    Ok(session)
}
