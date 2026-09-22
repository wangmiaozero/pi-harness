//! Sidecar process plumbing: which Node binary to use and where the runtime
//! entry script lives.
//!
//! Resolution order:
//! 1. `PI_HARNESS_NODE` / `PI_HARNESS_RUNTIME_SCRIPT` env overrides (tests).
//! 2. Bundled resources (`PI_HARNESS_RESOURCES_DIR` / packaged resource dir).
//! 3. Dev fallback: `node` on the login-shell PATH and `runtime/dist/index.js`.

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

    if let Some(bundled) = bundled_node() {
        if bundled.is_file() {
            return Ok(bundled);
        }
    }

    crate::environment::resolve_node()
}

/// Resolve the compiled runtime entry script.
pub fn resolve_runtime_script() -> AppResult<PathBuf> {
    if let Ok(explicit) = std::env::var("PI_HARNESS_RUNTIME_SCRIPT") {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Ok(path);
        }
        return Err(AppError::runtime_unavailable(format!(
            "PI_HARNESS_RUNTIME_SCRIPT points to a missing file: {}",
            path.display()
        )));
    }

    if let Some(root) = resource_root() {
        let script = root.join("runtime").join("index.js");
        if script.is_file() {
            return Ok(script);
        }
    }

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

fn bundled_node() -> Option<PathBuf> {
    let root = resource_root()?;
    let name = if cfg!(windows) { "node.exe" } else { "node" };
    Some(root.join("runtime-node").join(name))
}

fn resource_root() -> Option<PathBuf> {
    let dir = std::env::var("PI_HARNESS_RESOURCES_DIR").ok()?;
    let path = PathBuf::from(dir);
    path.is_dir().then_some(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_a_node_binary_in_test_env() {
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
