//! Sidecar process plumbing: which Node binary to use and where the runtime
//! entry script lives.
//!
//! Resolution order (dev-first; packaging comes with the release phase):
//! 1. `PI_HARNESS_NODE` env var (explicit override, also used by tests).
//! 2. `node` on PATH.
//!
//! The runtime script is `runtime/dist/index.js` relative to the repository
//! root. In packaged builds this will move into bundled resources.

use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

/// Locate the Node binary used to spawn the runtime sidecar.
pub fn resolve_node() -> AppResult<PathBuf> {
    if let Ok(explicit) = std::env::var("PI_HARNESS_NODE") {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Ok(path);
        }
        return Err(AppError::io(format!(
            "PI_HARNESS_NODE points to a missing file: {}",
            path.display()
        )));
    }

    let program = if cfg!(windows) { "node.exe" } else { "node" };
    let discovered = which_on_path(program).ok_or_else(|| {
        AppError::io("Node.js was not found on PATH. Install Node.js >= 22 or set PI_HARNESS_NODE.")
    })?;
    Ok(discovered)
}

/// Resolve the compiled runtime entry script.
pub fn resolve_runtime_script() -> AppResult<PathBuf> {
    // In dev the crate lives at <repo>/src-tauri; tests run with the same cwd.
    let script = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("runtime")
        .join("dist")
        .join("index.js");
    if script.is_file() {
        return Ok(script);
    }
    Err(AppError::runtime_unavailable(format!(
        "Runtime sidecar is not built: {} is missing. Run `pnpm runtime:build`.",
        script.display()
    )))
}

fn which_on_path(program: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(program))
        .find(|candidate| candidate.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_a_node_binary_in_test_env() {
        // Tests run on machines with Node available; if truly missing the
        // test fails loudly instead of skipping — the supervisor tests need it.
        let node = resolve_node().expect("node on PATH or PI_HARNESS_NODE");
        assert!(node.is_file(), "node binary must exist: {}", node.display());
    }

    #[test]
    fn runtime_script_must_be_built() {
        let script = resolve_runtime_script().expect("runtime/dist/index.js built");
        assert!(
            script.is_file(),
            "runtime script must exist: {}",
            script.display()
        );
    }
}
