//! Pi-Harness Tauri host library.
//!
//! Shell responsibilities only: window, bridge commands, runtime
//! supervision. Agent/harness business logic stays in the Node sidecar.

pub mod commands;
pub mod error;
pub mod process;
pub mod runtime;
pub mod state;
pub mod system;

use tauri::Manager;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Cargo.toml `version` is kept in sync with package.json and
    // tauri.conf.json during release.
    let app_version = env!("CARGO_PKG_VERSION").to_string();

    let app = match tauri::Builder::default()
        .manage(AppState::new(app_version))
        .invoke_handler(tauri::generate_handler![
            commands::system::system_info,
            commands::system::system_open_path,
            commands::system::system_show_item,
            commands::window::window_minimize,
            commands::window::window_maximize_toggle,
            commands::window::window_close,
            commands::window::window_start_drag,
            commands::runtime::runtime_ping,
            commands::runtime::runtime_version,
            commands::runtime::runtime_status,
            commands::runtime::runtime_start,
            commands::runtime::runtime_stop,
            commands::runtime::runtime_restart,
            commands::runtime::runtime_request,
        ])
        .setup(|app| {
            // Sidecar stores (runs / policy / orchestration) live in the same
            // user-data root Electron uses, injected at spawn via env.
            if let Ok(dir) = app.path().app_data_dir() {
                std::env::set_var("PI_HARNESS_USER_DATA", dir);
            }
            // Lazy start: the runtime sidecar is NOT started here. It boots
            // on the first `runtime_start` (or a later phase's first
            // agent-dependent feature). Settings/theme/about never spawn Node.
            let state = app.state::<AppState>();
            commands::runtime::install_event_forwarder(app.handle(), &state.runtime);
            Ok(())
        })
        .build(tauri::generate_context!())
    {
        Ok(app) => app,
        Err(error) => {
            eprintln!("[pi-harness] failed to build app: {error}");
            std::process::exit(1);
        }
    };

    app.run(|_app_handle, _event| {});
}
