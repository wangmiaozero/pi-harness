//! Open the OS terminal at an authorized directory. No shell command input.

use std::process::{Command, Stdio};

use crate::error::{AppError, AppResult};

pub fn open_directory(directory: &str) -> AppResult<()> {
    if directory.trim().is_empty() {
        return Err(AppError::invalid_path("Terminal directory is required"));
    }
    let mut child = if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.args(["-a", "Terminal", directory]);
        command
    } else if cfg!(target_os = "windows") {
        let mut command = Command::new("cmd.exe");
        command.args(["/c", "start", "", "cmd.exe", "/k", "cd", "/d", directory]);
        command
    } else {
        linux_terminal(directory)
    };
    child
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| AppError::io(format!("Unable to open terminal: {error}")))?
        .stdin
        .take();
    Ok(())
}

fn linux_terminal(directory: &str) -> Command {
    let program = std::env::var("TERMINAL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "x-terminal-emulator".into());
    let mut command = Command::new(&program);
    if program.contains("gnome-terminal") {
        command.args(["--working-directory", directory]);
    } else if program.contains("konsole") {
        command.args(["--workdir", directory]);
    } else if program.contains("xfce4-terminal") {
        command.arg(format!("--working-directory={directory}"));
    } else {
        command.args(["--working-directory", directory]);
    }
    command
}
