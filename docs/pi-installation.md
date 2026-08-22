# Pi 安装与 Node.js 前置条件

Pi-Harness 在概览页检测 Pi Coding Agent、系统 Node.js 和 npm。Electron 自带的 Node.js 运行时只服务于应用自身，不等同于用户终端可用的系统 Node.js，因此不会被当作 Pi 的安装环境。

## 已检测到 Node.js 和 npm

用户可以选择“一键安装”，Pi-Harness 使用参数数组直接执行以下命令，不经过 Shell 拼接：

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

相同命令会显示在概览页并支持一键复制，便于用户在自己的终端中执行。安装完成后会重新检测 Pi 路径与版本。

## 未检测到 Node.js 或 npm

一键安装保持禁用，避免产生难以理解的 npm 启动错误。界面会引导用户：

1. 点击“安装 Node.js”，直接前往官方地址 `https://nodejs.org/en/download`。
2. 安装当前 Node.js LTS；官方安装包会同时提供 npm。
3. 返回 Pi-Harness，点击“已安装 Node.js，刷新检测”。
4. 使用一键安装，或复制上述命令到终端执行。

Node.js 下载操作由主进程固定到官方 HTTPS 地址。渲染进程不能传入或替换 URL，应用仍会拦截其他站外导航。

## Node.js 路径检测

除系统 `PATH` 和 `/opt/homebrew/bin`、`/usr/local/bin` 等常见目录外，Pi-Harness 还检查 GUI 应用经常无法继承的 Node 版本管理器目录，包括 nvm、fnm、Volta、asdf、mise 和 npm 自定义全局目录。

一键安装时会把所选 npm 所在目录临时加入子进程 `PATH`，保证 npm 的 Node.js 启动器和安装后的 `pi` 命令可以被正确发现。
