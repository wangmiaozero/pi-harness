//! Pi-Harness Tauri host library.
//!
//! Shell responsibilities: window, filesystem/git security boundary,
//! runtime supervision. Agent/harness business logic stays in the Node sidecar.

pub mod commands;
pub mod environment;
pub mod error;
pub mod files;
pub mod git;
pub mod host;
pub mod persist;
pub mod process;
pub mod runtime;
pub mod security;
pub mod state;
pub mod system;
pub mod workspace;
pub mod worktree;

use tauri::Manager;

use host::DesktopHost;
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_version = env!("CARGO_PKG_VERSION").to_string();

    let app = match tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            commands::workspace::workspace_pick_directory,
            commands::workspace::workspace_pick_workspace_sources,
            commands::workspace::workspace_pick_workspace_file,
            commands::workspace::workspace_save_workspace_file,
            commands::workspace::workspace_allow_root,
            commands::workspace::workspace_authorize_dropped_root,
            commands::workspace::workspace_get_path_for_file,
            commands::workspace::workspace_get_active,
            commands::workspace::workspace_sync,
            commands::workspace::workspace_open_file,
            commands::workspace::workspace_save,
            commands::workspace::workspace_search,
            commands::workspace::workspace_open_terminal,
            commands::workspace::workspace_relocate_folder,
            commands::workspace::workspace_list_recent,
            commands::workspace::workspace_bind_session,
            commands::workspace::workspace_get_session_binding,
            commands::workspace::workspace_list_session_bindings,
            commands::workspace::workspace_assert_cwd,
            commands::workspace::files_list,
            commands::workspace::files_read,
            commands::workspace::files_write,
            commands::workspace::files_upload,
            commands::workspace::git_status,
            commands::workspace::git_status_many,
            commands::workspace::git_diff,
            commands::workspace::git_stage,
            commands::workspace::git_unstage,
            commands::workspace::git_commit,
            commands::workspace::git_generate_commit_message,
            commands::workspace::git_history,
            commands::workspace::git_overview,
            commands::workspace::git_commit_details,
            commands::workspace::git_commit_diff,
            commands::workspace::git_action,
            commands::workspace::git_file_history,
            commands::workspace::worktrees_list,
            commands::workspace::worktrees_create,
            commands::workspace::worktrees_remove,
            commands::menus::workspace_project_context_menu,
            commands::menus::workspace_session_folder_context_menu,
            commands::menus::sessions_context_menu,
            commands::menus::git_branch_context_menu,
            commands::desktop::environment_snapshot,
            commands::desktop::pi_copy_install_command,
            commands::desktop::pi_open_node_download,
            commands::desktop::backup_open_folder,
            commands::desktop::logs_open_folder,
            commands::desktop::diagnostics_copy,
            commands::desktop::diagnostics_export,
            commands::desktop::capabilities_open_homepage,
        ])
        .manage(commands::menus::MenuWaiter::new())
        .on_menu_event(|app, event| {
            commands::menus::MenuWaiter::dispatch(app, event.id().as_ref());
        })
        .on_webview_event(|webview, event| {
            if let tauri::WebviewEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                commands::workspace::handle_native_folder_drop(webview.app_handle(), paths);
            }
        })
        .setup(|app| {
            if let Ok(dir) = app.path().app_data_dir() {
                std::env::set_var("PI_HARNESS_USER_DATA", &dir);
                match DesktopHost::new(dir, app.handle().clone()) {
                    Ok(host) => {
                        app.manage(host);
                    }
                    Err(error) => eprintln!("[pi-harness] workspace host failed to load: {error}"),
                }
            }
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
