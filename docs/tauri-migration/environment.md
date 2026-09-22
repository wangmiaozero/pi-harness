# Environment（Phase 5）

Finder / Dock 启动的 GUI 进程 PATH 极短。Node 版本管理器（nvm / fnm / Volta /
Homebrew）只出现在 login shell 里。

## 职责切分

```text
Rust EnvironmentResolver
  login-shell PATH（`-c` 参数是常量 printf，无用户字符串）
  which node / npm / pi / git
  启动 sidecar 时注入合并后的 PATH
  Windows 解析 .cmd

Node sidecar EnvironmentManager
  Pi detect / install / bootstrap / update / cancel
  Node installer
  npm argv（非 shell）
  安装任务可观察 + AbortController 取消
```

不把 Pi 安装逻辑用纯 Rust 重写一遍。Sidecar 已用 `execFile` argv。
取消：sidecar abort；宿主 `kill_on_drop` sidecar 会带上整棵进程树。

## 并发锁

环境安装与 package / capability 变更互斥（`desktop.runMutation`）。

## 探测

`pi.detect` 走 sidecar（含 nvm/fnm/Volta 与 checks）。
Rust `environment_snapshot` 给宿主诊断用。
