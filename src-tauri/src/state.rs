//! Managed application state.

use crate::runtime::supervisor::RuntimeSupervisor;

pub struct AppState {
    pub runtime: RuntimeSupervisor,
    pub app_version: String,
}

impl AppState {
    pub fn new(app_version: String) -> Self {
        AppState {
            runtime: RuntimeSupervisor::new(),
            app_version,
        }
    }
}
