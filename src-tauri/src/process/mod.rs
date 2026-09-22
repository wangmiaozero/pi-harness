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

    crate::environment::resolve_node()
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
