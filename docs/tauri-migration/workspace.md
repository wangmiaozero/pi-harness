# Workspace（Tauri Desktop Host）

Rust 拥有工作区状态；Vue 只调 `piSwitch.workspace.*`。

## 数据

`PI_HARNESS_USER_DATA/workspace-state.json`：

```json
{
  "active": {
    "workspaceFile": null,
    "folders": [{ "path": "...", "resolvedPath": "...", "name": "...", "role": "main", "readonly": false }],
    "settings": {},
    "createdAt": 0,
    "updatedAt": 0
  },
  "recent": [],
  "sessionBindings": {}
}
```

字段与 Electron `WorkspaceService` 相同。Session binding：

```text
sessionId → { workspaceId, mainFolderId, folders[] }
```

## API

| `piSwitch.workspace.*` | Rust 命令 |
| --- | --- |
| `listProjects` | Bridge：`session.list` + `groupSessionsByProject` |
| `pickDirectory` | `workspace_pick_directory`（dialog + authorize） |
| `pickWorkspaceSources` | `workspace_pick_workspace_sources` |
| `pickWorkspaceFile` / `saveWorkspaceFile` | 原生文件对话框 |
| `allowRoot` | `workspace_allow_root`（restore 已授权根） |
| `getPathForFile` | 授权拖放路径（string / `{path}` / 原生 drop basename） |
| `getActive` / `sync` / `openWorkspaceFile` / `save` | WorkspaceService |
| `search` | SearchEngine |
| `openInTerminal` | argv 打开系统终端 |
| `relocateFolder` / `listRecent` | WorkspaceService |
| `bindSession` / `getSessionBinding` / `listSessionBindings` | sessionBindings |
| `projectContextMenu` / `sessionFolderContextMenu` | 原生菜单 |

`.code-workspace` 解析/保存与 Electron 同结构（`folders` + `settings`）。

## 文件夹拖放

WKWebView 的 HTML5 `File` 没有绝对路径。Rust `on_webview_event(DragDrop)`
对目录 `authorize_root`，发出 `pi-harness:event:native-folder-drop`。
Sidebar 订阅该事件（与 HTML5 `onDrop` 去重）。Bridge 同时缓存
`tauri://drag-drop` 路径，供 `getPathForFile({ name })` 匹配。

## Watcher

`WatcherHub`：每个活动 folder 一条 recursive watch；120ms trailing debounce；
只发 `pi-harness:event:workspace-changed`。
