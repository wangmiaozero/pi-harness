//! `window.*` commands for the frameless main window, plus the drag-region
//! shim. The renderer's titlebar uses `-webkit-app-region: drag`, which
//! WKWebView ignores; the platform bridge forwards titlebar mousedowns to
//! `window_start_drag` instead.

use tauri::{AppHandle, Manager, WebviewWindow};

use crate::error::{AppError, AppResult};

const MAIN_WINDOW: &str = "main";

fn main_window(app: &AppHandle) -> AppResult<WebviewWindow> {
    app.get_webview_window(MAIN_WINDOW)
        .ok_or_else(|| AppError::new(crate::error::IPC_ERROR, "Main window is not available"))
}

#[tauri::command]
pub async fn window_minimize(app: AppHandle) -> AppResult<()> {
    main_window(&app)?.minimize()?;
    Ok(())
}

#[tauri::command]
pub async fn window_maximize_toggle(app: AppHandle) -> AppResult<()> {
    let window = main_window(&app)?;
    if window.is_maximized()? {
        window.unmaximize()?;
    } else {
        window.maximize()?;
    }
    Ok(())
}

#[tauri::command]
pub async fn window_close(app: AppHandle) -> AppResult<()> {
    main_window(&app)?.close()?;
    Ok(())
}

#[tauri::command]
pub async fn window_start_drag(app: AppHandle) -> AppResult<()> {
    main_window(&app)?.start_dragging()?;
    Ok(())
}
