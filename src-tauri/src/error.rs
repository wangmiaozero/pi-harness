//! Typed command error, serialised across the IPC boundary with the same
//! shape as the Electron `AppErrorPayload` (`src/shared/types/errors.ts`),
//! so renderer error handling needs no platform branch.

use serde::ser::{Serialize, SerializeStruct, Serializer};

/// Subset of `AppErrorCode` used by the Tauri host today. The string values
/// must stay identical to the TypeScript union.
pub const APP_ERROR: &str = "APP_ERROR";
pub const IPC_ERROR: &str = "IPC_ERROR";
pub const PROCESS_FAILED: &str = "PROCESS_FAILED";
pub const FILE_SYSTEM_ERROR: &str = "FILE_SYSTEM_ERROR";
pub const PATH_DENIED: &str = "PATH_DENIED";
pub const RUNTIME_UNAVAILABLE: &str = "RUNTIME_UNAVAILABLE";
pub const RUNTIME_ERROR: &str = "RUNTIME_ERROR";
pub const RUNTIME_TIMEOUT: &str = "RUNTIME_TIMEOUT";
pub const SHELL_METHOD_PENDING: &str = "SHELL_METHOD_PENDING";
pub const VALIDATION_ERROR: &str = "VALIDATION_ERROR";
pub const FILE_CONFLICT: &str = "FILE_CONFLICT";
pub const GIT_ERROR: &str = "GIT_ERROR";

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{message}")]
    Payload { code: String, message: String },

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Tauri(#[from] tauri::Error),
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        AppError::Payload {
            code: code.to_string(),
            message: message.into(),
        }
    }

    pub fn runtime(message: impl Into<String>) -> Self {
        AppError::new(RUNTIME_ERROR, message)
    }

    pub fn runtime_unavailable(message: impl Into<String>) -> Self {
        AppError::new(RUNTIME_UNAVAILABLE, message)
    }

    pub fn timeout(message: impl Into<String>) -> Self {
        AppError::new(RUNTIME_TIMEOUT, message)
    }

    pub fn io(message: impl Into<String>) -> Self {
        AppError::new(PROCESS_FAILED, message)
    }

    pub fn invalid_path(message: impl Into<String>) -> Self {
        AppError::new(PATH_DENIED, message)
    }

    pub fn validation(message: impl Into<String>) -> Self {
        AppError::new(VALIDATION_ERROR, message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        AppError::new(FILE_CONFLICT, message)
    }

    pub fn git(message: impl Into<String>) -> Self {
        AppError::new(GIT_ERROR, message)
    }

    pub fn fs(message: impl Into<String>) -> Self {
        AppError::new(FILE_SYSTEM_ERROR, message)
    }

    /// (`code`, `message`) pair expected by the renderer's error normaliser.
    pub fn parts(&self) -> (String, String) {
        match self {
            AppError::Payload { code, message } => (code.clone(), message.clone()),
            AppError::Io(err) => (PROCESS_FAILED.to_string(), err.to_string()),
            AppError::Tauri(err) => (IPC_ERROR.to_string(), err.to_string()),
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let (code, message) = self.parts();
        let mut state = serializer.serialize_struct("AppErrorPayload", 2)?;
        state.serialize_field("code", &code)?;
        state.serialize_field("message", &message)?;
        state.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_shape_matches_renderer_contract() {
        let error = AppError::runtime_unavailable("Pi Runtime is not running");
        let json = serde_json::to_value(&error).expect("serialisable");
        assert_eq!(json["code"], "RUNTIME_UNAVAILABLE");
        assert_eq!(json["message"], "Pi Runtime is not running");
    }

    #[test]
    fn io_errors_map_to_process_failed() {
        let error: AppError = std::io::Error::new(std::io::ErrorKind::NotFound, "no node").into();
        let json = serde_json::to_value(&error).expect("serialisable");
        assert_eq!(json["code"], "PROCESS_FAILED");
    }
}
