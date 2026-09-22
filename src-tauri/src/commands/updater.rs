//! App updater. Packaged builds use tauri-plugin-updater; unsigned / GitHub
//! metadata-only releases fall back to `manual-update` + the release page.
//! Failed downloads never replace the running install.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

use crate::error::{AppError, AppResult};

const RELEASE_PAGE: &str = "https://github.com/wangmiaozero/pi-harness/releases/latest";
const RELEASE_API: &str = "https://api.github.com/repos/wangmiaozero/pi-harness/releases/latest";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateState {
    pub supported: bool,
    pub available: bool,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub status: String,
    pub downloaded: bool,
    pub download_progress: Option<f64>,
}

pub struct UpdateHub {
    inner: Mutex<HubInner>,
}

struct HubInner {
    state: AppUpdateState,
    bytes: Option<Vec<u8>>,
}

impl UpdateHub {
    pub fn new(current_version: String) -> Self {
        Self {
            inner: Mutex::new(HubInner {
                state: AppUpdateState {
                    supported: !tauri::is_dev(),
                    available: false,
                    current_version,
                    latest_version: None,
                    status: "idle".into(),
                    downloaded: false,
                    download_progress: None,
                },
                bytes: None,
            }),
        }
    }

    pub fn snapshot(&self) -> AppUpdateState {
        self.lock().state.clone()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HubInner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn patch(&self, app: &AppHandle, mutate: impl FnOnce(&mut HubInner)) -> AppUpdateState {
        let next = {
            let mut inner = self.lock();
            mutate(&mut inner);
            inner.state.clone()
        };
        let _ = app.emit("pi-harness:updater:state", &next);
        next
    }
}

#[tauri::command]
pub fn updater_state(app: AppHandle) -> AppUpdateState {
    hub(&app).snapshot()
}

#[tauri::command]
pub async fn updater_check(app: AppHandle) -> AppResult<AppUpdateState> {
    let current = hub(&app).snapshot().current_version;
    if tauri::is_dev() {
        return Ok(hub(&app).patch(&app, |inner| {
            inner.state.status = "not-available".into();
            inner.state.available = false;
            inner.state.supported = false;
        }));
    }

    hub(&app).patch(&app, |inner| {
        inner.state.status = "checking".into();
        inner.state.supported = true;
        inner.state.downloaded = false;
        inner.state.download_progress = None;
        inner.bytes = None;
    });

    match check_plugin(&app).await {
        Ok(Some(version)) => Ok(hub(&app).patch(&app, |inner| {
            inner.state.available = true;
            inner.state.latest_version = Some(version);
            inner.state.status = "available".into();
            inner.state.supported = true;
        })),
        Ok(None) => match github_latest(&current) {
            Ok(Some(version)) if version_newer(&version, &current) => {
                Ok(hub(&app).patch(&app, |inner| {
                    inner.state.available = true;
                    inner.state.latest_version = Some(version);
                    inner.state.status = "manual-update".into();
                    inner.state.supported = false;
                }))
            }
            Ok(_) => Ok(hub(&app).patch(&app, |inner| {
                inner.state.available = false;
                inner.state.status = "not-available".into();
            })),
            Err(error) => Ok(fail(&app, error)),
        },
        Err(_) => match github_latest(&current) {
            Ok(Some(version)) if version_newer(&version, &current) => {
                Ok(hub(&app).patch(&app, |inner| {
                    inner.state.available = true;
                    inner.state.latest_version = Some(version);
                    inner.state.status = "manual-update".into();
                    inner.state.supported = false;
                }))
            }
            Ok(_) => Ok(hub(&app).patch(&app, |inner| {
                inner.state.available = false;
                inner.state.status = "not-available".into();
            })),
            Err(error) => Ok(fail(&app, error)),
        },
    }
}

#[tauri::command]
pub async fn updater_download(app: AppHandle) -> AppResult<AppUpdateState> {
    let current = hub(&app).snapshot();
    if current.downloaded || current.status == "downloading" {
        return Ok(current);
    }
    if current.status == "manual-update" || !current.supported {
        return Ok(current);
    }

    hub(&app).patch(&app, |inner| {
        inner.state.status = "downloading".into();
        inner.state.download_progress = Some(0.0);
    });

    match download_plugin(&app).await {
        Ok(bytes) => Ok(hub(&app).patch(&app, |inner| {
            inner.bytes = Some(bytes);
            inner.state.downloaded = true;
            inner.state.status = "downloaded".into();
            inner.state.download_progress = Some(100.0);
        })),
        Err(error) => Ok(fail(&app, error)),
    }
}

#[tauri::command]
pub async fn updater_install(app: AppHandle) -> AppResult<()> {
    let bytes = hub(&app).lock().bytes.clone();
    let Some(bytes) = bytes else {
        return Err(AppError::validation("No downloaded update to install"));
    };
    hub(&app).patch(&app, |inner| {
        inner.state.status = "installing".into();
    });
    install_plugin(&app, bytes).await?;
    Ok(())
}

#[tauri::command]
pub fn updater_open_release_page() -> AppResult<()> {
    crate::commands::desktop::open_https_url(RELEASE_PAGE)
}

fn hub(app: &AppHandle) -> tauri::State<'_, UpdateHub> {
    app.state::<UpdateHub>()
}

fn fail(app: &AppHandle, error: AppError) -> AppUpdateState {
    eprintln!("[pi-harness] updater error: {error}");
    hub(app).patch(app, |inner| {
        inner.state.status = "error".into();
        inner.state.available = false;
        inner.state.downloaded = false;
        inner.bytes = None;
    })
}

async fn check_plugin(app: &AppHandle) -> AppResult<Option<String>> {
    let updater = app
        .updater()
        .map_err(|error| AppError::runtime(format!("Updater unavailable: {error}")))?;
    let update = updater
        .check()
        .await
        .map_err(|error| AppError::runtime(format!("Update check failed: {error}")))?;
    Ok(update.map(|item| item.version))
}

async fn download_plugin(app: &AppHandle) -> AppResult<Vec<u8>> {
    let updater = app
        .updater()
        .map_err(|error| AppError::runtime(format!("Updater unavailable: {error}")))?;
    let update = updater
        .check()
        .await
        .map_err(|error| AppError::runtime(format!("Update check failed: {error}")))?
        .ok_or_else(|| AppError::runtime("No update available to download"))?;
    let handle = app.clone();
    update
        .download(
            move |chunk, total| {
                if let Some(hub) = handle.try_state::<UpdateHub>() {
                    let progress = total
                        .map(|all| (chunk as f64 / all as f64) * 100.0)
                        .unwrap_or(0.0);
                    hub.patch(&handle, |inner| {
                        inner.state.status = "downloading".into();
                        inner.state.download_progress = Some(progress);
                    });
                }
            },
            || {},
        )
        .await
        .map_err(|error| AppError::runtime(format!("Update download failed: {error}")))
}

async fn install_plugin(app: &AppHandle, bytes: Vec<u8>) -> AppResult<()> {
    let updater = app
        .updater()
        .map_err(|error| AppError::runtime(format!("Updater unavailable: {error}")))?;
    let update = updater
        .check()
        .await
        .map_err(|error| AppError::runtime(format!("Update check failed: {error}")))?
        .ok_or_else(|| AppError::runtime("No update available to install"))?;
    update
        .install(&bytes)
        .map_err(|error| AppError::runtime(format!("Update install failed: {error}")))?;
    app.restart();
}

fn github_latest(current: &str) -> AppResult<Option<String>> {
    let response = ureq::get(RELEASE_API)
        .set("User-Agent", &format!("Pi-Harness/{current}"))
        .set("Accept", "application/vnd.github+json")
        .timeout(std::time::Duration::from_secs(8))
        .call()
        .map_err(|error| AppError::runtime(format!("GitHub release check failed: {error}")))?;
    let body = response
        .into_string()
        .map_err(|error| AppError::runtime(format!("GitHub release body failed: {error}")))?;
    let json: serde_json::Value = serde_json::from_str(&body)
        .map_err(|error| AppError::runtime(format!("GitHub release JSON failed: {error}")))?;
    if json.get("draft").and_then(|v| v.as_bool()) == Some(true)
        || json.get("prerelease").and_then(|v| v.as_bool()) == Some(true)
    {
        return Ok(None);
    }
    let tag = json
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .trim_start_matches('v');
    if tag.is_empty() {
        Ok(None)
    } else {
        Ok(Some(tag.to_string()))
    }
}

fn version_newer(latest: &str, current: &str) -> bool {
    parse_version(latest) > parse_version(current)
}

fn parse_version(value: &str) -> [u64; 3] {
    let mut parts = [0u64; 3];
    for (index, piece) in value.split('.').take(3).enumerate() {
        let digits: String = piece.chars().take_while(|ch| ch.is_ascii_digit()).collect();
        parts[index] = digits.parse().unwrap_or(0);
    }
    parts
}
