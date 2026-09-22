//! Native context menus matching Electron `register-workspace.ts`.

use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, WebviewWindow};
use tokio::sync::oneshot;

use crate::error::{AppError, AppResult};

const MENU_TIMEOUT: Duration = Duration::from_secs(120);
const FOCUS_GRACE: Duration = Duration::from_millis(280);

pub struct MenuWaiter {
    tx: std::sync::Mutex<Option<oneshot::Sender<Option<String>>>>,
}

impl Default for MenuWaiter {
    fn default() -> Self {
        Self::new()
    }
}

impl MenuWaiter {
    pub fn new() -> Self {
        Self {
            tx: std::sync::Mutex::new(None),
        }
    }

    pub fn dispatch(app: &AppHandle, id: &str) {
        if let Some(waiter) = app.try_state::<MenuWaiter>() {
            waiter.resolve(Some(id.to_string()));
        }
    }

    fn begin(&self) -> oneshot::Receiver<Option<String>> {
        let (tx, rx) = oneshot::channel();
        if let Some(previous) = self.lock().replace(tx) {
            let _ = previous.send(None);
        }
        rx
    }

    fn resolve(&self, value: Option<String>) {
        if let Some(tx) = self.lock().take() {
            let _ = tx.send(value);
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Option<oneshot::Sender<Option<String>>>> {
        self.tx
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

async fn popup_choice(
    app: &AppHandle,
    window: &WebviewWindow,
    menu: &Menu<tauri::Wry>,
) -> AppResult<Option<String>> {
    let waiter = app.state::<MenuWaiter>();
    let mut rx = waiter.begin();
    window.popup_menu(menu)?;
    let started = Instant::now();
    loop {
        tokio::select! {
            result = &mut rx => {
                return Ok(result.ok().flatten());
            }
            _ = tokio::time::sleep(Duration::from_millis(80)) => {
                if started.elapsed() > MENU_TIMEOUT {
                    waiter.resolve(None);
                    continue;
                }
                // Windows/Linux: dismissing the menu refocuses the window.
                // macOS keeps the window focused while NSMenu is open, so this
                // only fires after the grace period when focus is still true
                // *and* no item has been chosen — a second right-click also
                // cancels via `begin()`.
                if started.elapsed() > FOCUS_GRACE && window.is_focused().unwrap_or(false) {
                    #[cfg(not(target_os = "macos"))]
                    waiter.resolve(None);
                }
            }
        }
    }
}

fn item(app: &AppHandle, id: &str, label: &str, enabled: bool) -> AppResult<MenuItem<tauri::Wry>> {
    MenuItem::with_id(app, id, label, enabled, None::<&str>).map_err(AppError::from)
}

fn zh(locale: Option<&str>) -> bool {
    locale.unwrap_or("en-US").eq_ignore_ascii_case("zh-CN")
}

fn reveal_label(is_zh: bool) -> &'static str {
    if cfg!(target_os = "macos") {
        if is_zh {
            "在 Finder 中显示"
        } else {
            "Reveal in Finder"
        }
    } else if cfg!(target_os = "windows") {
        if is_zh {
            "在文件资源管理器中显示"
        } else {
            "Show in File Explorer"
        }
    } else if is_zh {
        "在文件管理器中显示"
    } else {
        "Show in File Manager"
    }
}

#[tauri::command]
pub async fn workspace_project_context_menu(
    app: AppHandle,
    window: WebviewWindow,
    project_key: String,
    project_root: String,
    is_pinned: Option<bool>,
    locale: Option<String>,
) -> AppResult<Option<String>> {
    let _ = (project_key, project_root);
    let chinese = zh(locale.as_deref());
    let pinned = is_pinned.unwrap_or(false);
    let pin = item(
        &app,
        if pinned { "unpin" } else { "pin" },
        if pinned {
            if chinese {
                "取消置顶"
            } else {
                "Unpin"
            }
        } else if chinese {
            "置顶"
        } else {
            "Pin"
        },
        true,
    )?;
    let open = item(&app, "open", if chinese { "打开" } else { "Open" }, true)?;
    let edit = item(&app, "edit", if chinese { "编辑" } else { "Edit" }, true)?;
    let rename = item(
        &app,
        "rename",
        if chinese { "重命名" } else { "Rename" },
        true,
    )?;
    let archive = item(
        &app,
        "archive-chats",
        if chinese { "归档" } else { "Archive" },
        true,
    )?;
    let worktree = item(
        &app,
        "create-worktree",
        if chinese {
            "创建分支"
        } else {
            "Create Branch"
        },
        true,
    )?;
    let export_html = item(
        &app,
        "export-html",
        if chinese {
            "导出 HTML"
        } else {
            "Export HTML"
        },
        true,
    )?;
    let export_md = item(
        &app,
        "export-md",
        if chinese {
            "导出 Markdown"
        } else {
            "Export Markdown"
        },
        true,
    )?;
    let reveal = item(&app, "reveal", reveal_label(chinese), true)?;
    let remove = item(
        &app,
        "remove",
        if chinese { "删除" } else { "Delete" },
        true,
    )?;
    let sep1 = PredefinedMenuItem::separator(&app)?;
    let sep2 = PredefinedMenuItem::separator(&app)?;
    let menu = Menu::with_items(
        &app,
        &[
            &pin,
            &open,
            &edit,
            &rename,
            &archive,
            &worktree,
            &sep1,
            &export_html,
            &export_md,
            &reveal,
            &sep2,
            &remove,
        ],
    )?;
    popup_choice(&app, &window, &menu).await
}

#[tauri::command]
pub async fn workspace_session_folder_context_menu(
    app: AppHandle,
    window: WebviewWindow,
    locale: Option<String>,
) -> AppResult<Option<String>> {
    let remove = item(
        &app,
        "remove",
        if zh(locale.as_deref()) {
            "移除"
        } else {
            "Remove"
        },
        true,
    )?;
    let menu = Menu::with_items(&app, &[&remove])?;
    popup_choice(&app, &window, &menu).await
}

#[tauri::command]
pub async fn sessions_context_menu(
    app: AppHandle,
    window: WebviewWindow,
    session_id: String,
    is_worktree: Option<bool>,
    is_pinned: Option<bool>,
    locale: Option<String>,
) -> AppResult<Option<String>> {
    let _ = (session_id, is_worktree, is_pinned);
    let chinese = zh(locale.as_deref());
    let rename = item(
        &app,
        "rename",
        if chinese { "重命名" } else { "Rename" },
        true,
    )?;
    let delete = item(
        &app,
        "delete",
        if chinese { "删除" } else { "Delete" },
        true,
    )?;
    let menu = Menu::with_items(&app, &[&rename, &delete])?;
    popup_choice(&app, &window, &menu).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchMenuInput {
    pub locale: Option<String>,
    pub branch_name: String,
    pub branch_type: String,
    pub current: bool,
    pub upstream: Option<String>,
    pub upstream_choices: Option<Vec<String>>,
}

#[tauri::command]
pub async fn git_branch_context_menu(
    app: AppHandle,
    window: WebviewWindow,
    input: GitBranchMenuInput,
) -> AppResult<Option<Value>> {
    let locale = input.locale;
    let branch_name = input.branch_name;
    let branch_type = input.branch_type;
    let current = input.current;
    let upstream = input.upstream;
    let upstream_choices = input.upstream_choices;
    let menu = {
        let chinese = zh(locale.as_deref());
        let checkout_label = if chinese {
            format!("检出 {branch_name}")
        } else {
            format!("Checkout {branch_name}")
        };
        let checkout = item(&app, "checkout", &checkout_label, !current)?;
        let push = item(&app, "push", if chinese { "推送" } else { "Push" }, true)?;
        let merge = item(
            &app,
            "merge",
            if chinese {
                "合并到当前分支"
            } else {
                "Merge into current branch"
            },
            !current,
        )?;
        let rebase = item(
            &app,
            "rebase",
            if chinese {
                "将当前分支 Rebase 到此分支"
            } else {
                "Rebase current branch onto this branch"
            },
            !current,
        )?;
        let create = item(
            &app,
            "create-branch",
            if chinese {
                "从此处创建分支…"
            } else {
                "Create branch here…"
            },
            true,
        )?;
        let rename = item(
            &app,
            "rename",
            if chinese { "重命名…" } else { "Rename…" },
            true,
        )?;
        let unset = item(
            &app,
            "unset-upstream",
            if chinese {
                "取消上游分支"
            } else {
                "Unset upstream"
            },
            true,
        )?;
        let delete = item(
            &app,
            "delete",
            if chinese {
                "删除分支…"
            } else {
                "Delete branch…"
            },
            !current,
        )?;
        let copy = item(
            &app,
            "copy-name",
            if chinese {
                "复制分支名称"
            } else {
                "Copy branch name"
            },
            true,
        )?;
        let sep1 = PredefinedMenuItem::separator(&app)?;
        let sep2 = PredefinedMenuItem::separator(&app)?;
        let sep3 = PredefinedMenuItem::separator(&app)?;
        let sep4 = PredefinedMenuItem::separator(&app)?;

        let choices = upstream_choices.unwrap_or_default();
        let mut checks = Vec::new();
        for choice in &choices {
            let id = format!("set-upstream\t{choice}");
            checks.push(CheckMenuItem::with_id(
                &app,
                id,
                choice,
                true,
                upstream.as_deref() == Some(choice.as_str()),
                None::<&str>,
            )?);
        }
        let check_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
            checks.iter().map(|item| item as _).collect();
        let upstream_menu = if branch_type == "local" && !choices.is_empty() {
            Some(Submenu::with_id_and_items(
                &app,
                "set-upstream-menu",
                if chinese {
                    "设置上游分支"
                } else {
                    "Set upstream"
                },
                true,
                &check_refs,
            )?)
        } else {
            None
        };

        let mut entries: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = vec![&checkout];
        if branch_type == "local" {
            entries.push(&push);
        }
        entries.extend_from_slice(&[&sep1, &merge, &rebase, &sep2, &create]);
        if branch_type == "local" {
            entries.push(&rename);
            if let Some(submenu) = upstream_menu.as_ref() {
                entries.push(submenu);
            }
            if upstream.as_deref().is_some_and(|value| !value.is_empty()) {
                entries.push(&unset);
            }
            entries.extend_from_slice(&[&sep3, &delete]);
        }
        entries.extend_from_slice(&[&sep4, &copy]);
        Menu::with_items(&app, &entries)?
    };
    let selected = popup_choice(&app, &window, &menu).await?;
    Ok(selected.map(|id| {
        if let Some((action, value)) = id.split_once('\t') {
            json!({ "action": action, "value": value })
        } else {
            json!({ "action": id })
        }
    }))
}
