//! Debounced workspace watcher. Emits `pi-harness:event:workspace-changed`.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

const DEBOUNCE: Duration = Duration::from_millis(120);

pub struct WatcherHub {
    inner: Arc<Mutex<WatcherInner>>,
}

struct WatcherInner {
    watcher: Option<RecommendedWatcher>,
    roots: HashSet<PathBuf>,
}

impl WatcherHub {
    pub fn new(app: AppHandle) -> Self {
        let inner = Arc::new(Mutex::new(WatcherInner {
            watcher: None,
            roots: HashSet::new(),
        }));
        let (tx, rx) = mpsc::channel::<()>();
        let watcher = RecommendedWatcher::new(
            move |result: Result<Event, notify::Error>| {
                if result.is_ok() {
                    let _ = tx.send(());
                }
            },
            notify::Config::default(),
        )
        .ok();
        let emit_inner = inner.clone();
        thread::Builder::new()
            .name("pi-workspace-watch".into())
            .spawn(move || loop {
                if rx.recv().is_err() {
                    break;
                }
                loop {
                    match rx.recv_timeout(DEBOUNCE) {
                        Ok(()) => continue,
                        Err(mpsc::RecvTimeoutError::Timeout) => break,
                        Err(mpsc::RecvTimeoutError::Disconnected) => return,
                    }
                }
                let roots: Vec<String> = {
                    let state = emit_inner
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    state
                        .roots
                        .iter()
                        .map(|path| path.to_string_lossy().replace('\\', "/"))
                        .collect()
                };
                let _ = app.emit(
                    "pi-harness:event:workspace-changed",
                    serde_json::json!({ "roots": roots }),
                );
            })
            .ok();
        inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .watcher = watcher;
        Self { inner }
    }

    pub fn sync(&self, roots: &[String]) {
        let mut state = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let next: HashSet<PathBuf> = roots.iter().map(PathBuf::from).collect();
        let to_unwatch: Vec<PathBuf> = state.roots.difference(&next).cloned().collect();
        let to_watch: Vec<PathBuf> = next.difference(&state.roots).cloned().collect();
        if let Some(watcher) = state.watcher.as_mut() {
            for root in &to_unwatch {
                let _ = watcher.unwatch(root);
            }
            for root in &to_watch {
                let _ = watcher.watch(root, RecursiveMode::Recursive);
            }
        }
        state.roots = next;
    }
}
