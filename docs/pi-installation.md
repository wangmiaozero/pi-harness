# Node.js / npm / Pi 一键环境安装

Pi-Harness 的“一键安装环境”和“安装 Pi”使用同一套 Environment Bootstrap。用户无需预先配置开发环境：应用会依次检测、安装或修复 Node.js、npm、用户 PATH 和 Pi Coding Agent。

## 环境策略

- 最低 Node.js 版本为 `22.0.0`，版本判断使用 SemVer。
- 已生效的 Node.js 22、24、26 等受支持版本会直接复用，不降级、不覆盖。
- Node.js 缺失、低于 22 或 npm 缺失时，从 `https://nodejs.org/dist` 获取当前平台可用的较新 LTS 版本，校验官方 `SHASUMS256.txt` 后安装到用户级受管目录 `~/.pi-harness/node`。
- 安装不依赖 nvm、Homebrew、winget、apt 或管理员权限，也不会修改系统 Node.js。
- macOS / Linux 会读取用户 login shell；Windows 会使用 `where.exe` 和 PowerShell `Get-Command`。GUI 进程未继承终端 PATH 时仍可发现 nvm、fnm、Volta、asdf、mise 等环境中的命令。

Node 下载、校验、解压、PATH 配置及 `node --version` / `npm --version` 验证均通过统一安装任务上报进度和实时日志。下载和 npm 安装阶段可取消；任务失败后会释放安装锁并允许重试。

## npm 全局目录

安装前会读取 `npm config get prefix` 并检查 prefix、可执行文件目录和全局 modules 目录是否可写。

- 当前 prefix 可写：保持用户配置不变。
- 当前 prefix 不可写或无法解析：备份已有 `~/.npmrc`，切换到 `~/.npm-global`，把相应 bin 目录持久化到用户 PATH，再重新验证。
- 永不执行 `sudo npm install -g`，避免产生 root-owned 全局包和后续 EACCES。

## Pi 安装与验证

Pi-Harness 使用参数数组直接启动解析到的 npm，不经过 Shell 字符串拼接。实际命令为：

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

stdout / stderr 会实时进入安装详情。npm 退出码为 0 后，应用还会：

1. 合并受管 Node、npm prefix 和 login shell PATH；
2. 重新解析 `pi`，必要时从 npm prefix 推导启动器；
3. 实际执行 `pi --version`；
4. 重新扫描 Node、npm、Pi；
5. 通过环境事件刷新 Overview、Diagnostics、Skills、Packages、Extensions、Providers 和 Models。

只有可执行文件存在且版本命令成功，任务才进入 `success`。已健康安装的 Pi 默认跳过 npm 安装；“重新安装”和“更新”是独立操作。

## 安全与恢复

- Renderer 只能调用固定 IPC；下载源、安装路径和命令参数均由 Main 派生。
- Node 发布文件必须通过官方 SHA-256 校验。
- 受管 Node 安装使用 staging、原子替换和 rollback，且拒绝根目录、用户目录、工作区等不安全目标。
- PATH 配置写入带 Pi-Harness 标记的最小 profile 区块，覆盖前备份原文件。
- 错误区分 Node 缺失/过旧、下载或安装失败、npm 缺失/权限/安装失败、网络错误、PATH 刷新失败、安装后找不到 Pi 和取消。
