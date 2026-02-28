use crate::model::Session;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Metadata about a saved session, used for the session library on the idle screen.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMeta {
    pub id: String,
    pub name: String,
    pub step_count: usize,
    pub session_dir: PathBuf,
}

/// Returns the base directory where all sessions are stored:
/// `{LocalAppData}/Wegweiser/sessions/` on Windows (falls back to `%TEMP%/wegweiser_sessions/`).
pub fn sessions_base_dir() -> PathBuf {
    dirs::data_local_dir()
        .map(|d| d.join("Wegweiser").join("sessions"))
        .unwrap_or_else(|| std::env::temp_dir().join("wegweiser_sessions"))
}

/// Canonicalize `path` and verify it lies within the sessions base directory.
/// Returns the canonical path on success, or an error string on failure.
pub fn confine_to_sessions_dir(path: &Path) -> Result<PathBuf, String> {
    let canonical_path = std::fs::canonicalize(path)
        .map_err(|_| "Invalid path".to_string())?;
    let canonical_base = std::fs::canonicalize(sessions_base_dir())
        .map_err(|_| "Sessions directory not found".to_string())?;
    if !canonical_path.starts_with(&canonical_base) {
        return Err("Access denied: path is outside sessions directory".to_string());
    }
    Ok(canonical_path)
}

/// Create a new session directory inside `sessions_base_dir()` and return its path.
/// Directory name: `<uuid8>` (8-character prefix of a random UUID v4).
pub fn create_session_dir() -> Result<PathBuf> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let dir_name = &session_id[..8];
    let session_dir = sessions_base_dir().join(dir_name);
    fs::create_dir_all(&session_dir)?;
    Ok(session_dir)
}

/// Scan `base` for subdirectories that contain a `session.json`, read the name
/// and step count from each, and return them sorted newest-first by directory
/// modification time.
pub fn list_sessions(base: &Path) -> Vec<SessionMeta> {
    let entries = match fs::read_dir(base) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    let mut metas: Vec<(std::time::SystemTime, SessionMeta)> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let json_path = path.join("session.json");
        if !json_path.exists() {
            continue;
        }
        let mtime = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

        match load_session(&json_path) {
            Ok(session) => {
                let meta = SessionMeta {
                    id: session.id.clone(),
                    name: session.name.clone(),
                    step_count: session.steps.len(),
                    session_dir: path,
                };
                metas.push((mtime, meta));
            }
            Err(_) => {
                // Skip sessions whose JSON cannot be parsed.
            }
        }
    }

    // Sort newest-first.
    metas.sort_by(|a, b| b.0.cmp(&a.0));
    metas.into_iter().map(|(_, m)| m).collect()
}

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
    let mut session: Session = serde_json::from_str(&json)?;

    // --- security-005: validate session_dir confinement and step image paths ---
    let canonical_base = fs::canonicalize(sessions_base_dir())
        .map_err(|e| anyhow::anyhow!("Sessions base dir not found: {}", e))?;
    // Use canonicalize if dir exists, otherwise just check string prefix
    let canonical_session_dir = fs::canonicalize(&session.session_dir)
        .unwrap_or_else(|_| session.session_dir.clone());
    if !canonical_session_dir.starts_with(&canonical_base) {
        return Err(anyhow::anyhow!(
            "Session directory is outside sessions base: {:?}",
            session.session_dir
        ));
    }
    // Clear any step image paths that escape the session directory
    for step in &mut session.steps {
        let canonical_step_dir = fs::canonicalize(&session.session_dir)
            .unwrap_or_else(|_| session.session_dir.clone());
        if !step.image_path.as_os_str().is_empty() {
            let canonical_img = fs::canonicalize(&step.image_path)
                .unwrap_or_else(|_| step.image_path.clone());
            if !canonical_img.starts_with(&canonical_step_dir) {
                step.image_path = PathBuf::new();
            }
        }
        step.extra_image_paths.retain(|p| {
            if p.as_os_str().is_empty() {
                return true;
            }
            let c = fs::canonicalize(p).unwrap_or_else(|_| p.clone());
            c.starts_with(&canonical_step_dir)
        });
    }
    // --- end security-005 ---

    // Migrate: old sessions stored order=1 for every step due to a race
    // condition that has since been fixed. Re-number sequentially on load
    // so exports always produce correct Step 1, Step 2, … headers.
    let needs_renumber = session.steps.windows(2).any(|w| w[0].order >= w[1].order)
        || session.steps.iter().any(|s| s.order == 0);
    if needs_renumber {
        for (i, step) in session.steps.iter_mut().enumerate() {
            step.order = i + 1;
        }
        if let Err(e) = save_session(&session) {
            eprintln!("[session] migration save failed: {e}");
        }
    }

    Ok(session)
}

/// Delete a session directory and all its contents from disk.
/// Validates that the directory is within the sessions base directory to prevent
/// arbitrary directory deletion attacks.
///
/// Reuses `confine_to_sessions_dir` (which canonicalises both paths) instead
/// of duplicating that logic.
pub fn delete_session(dir: &Path) -> Result<()> {
    let canonical_path = confine_to_sessions_dir(dir)
        .map_err(|e| anyhow::anyhow!("{e}"))?;

    // Verify the path is actually a directory (not a file or symlink)
    if !canonical_path.is_dir() {
        return Err(anyhow::anyhow!("Not a directory: {:?}", canonical_path));
    }

    // Only then delete the directory and its contents
    fs::remove_dir_all(&canonical_path)?;
    Ok(())
}
