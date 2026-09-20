//! System integration: open paths and reveal items with the platform's
//! native handlers. Arguments are passed as argv (never through a shell), so
//! renderer-supplied paths cannot inject shell syntax.

use std::path::Path;
use std::process::Command;

use crate::error::{AppError, AppResult};

fn require_existing(path: &str) -> AppResult<&Path> {
    let resolved = Path::new(path);
    if path.is_empty() || !resolved.exists() {
        return Err(AppError::invalid_path(format!(
            "Path does not exist: {path}"
        )));
    }
    Ok(resolved)
}

/// Open a file or directory with the OS default handler.
pub fn open_path(path: &str) -> AppResult<()> {
    let resolved = require_existing(path)?;
    let status = if cfg!(target_os = "macos") {
        Command::new("open").arg(resolved).status()
    } else if cfg!(target_os = "windows") {
        Command::new("explorer").arg(resolved).status()
    } else {
        Command::new("xdg-open").arg(resolved).status()
    }
    .map_err(|error| AppError::io(format!("Failed to open path: {error}")))?;

    if status.success() {
        Ok(())
    } else {
        Err(AppError::io(format!(
            "Open path failed with status {}",
            status.code().unwrap_or(-1)
        )))
    }
}

/// Reveal a file in the platform file manager.
pub fn show_item(path: &str) -> AppResult<()> {
    let resolved = require_existing(path)?;
    let status = if cfg!(target_os = "macos") {
        Command::new("open").arg("-R").arg(resolved).status()
    } else if cfg!(target_os = "windows") {
        Command::new("explorer")
            .arg(format!("/select,{}", resolved.display()))
            .status()
    } else {
        // Linux has no cross-desktop reveal verb; open the parent directory.
        let parent = resolved
            .parent()
            .ok_or_else(|| AppError::invalid_path("Path has no parent directory"))?;
        Command::new("xdg-open").arg(parent).status()
    }
    .map_err(|error| AppError::io(format!("Failed to show item: {error}")))?;

    if status.success() {
        Ok(())
    } else {
        Err(AppError::io(format!(
            "Show item failed with status {}",
            status.code().unwrap_or(-1)
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_missing_paths() {
        let error = open_path("/definitely/not/a/real/path").expect_err("missing path");
        assert_eq!(error.parts().0, "PATH_DENIED");

        let error = show_item("").expect_err("empty path");
        assert_eq!(error.parts().0, "PATH_DENIED");
    }
}
