# Path Authorization

`authorized-roots.json`：

```json
{ "roots": ["/Users/wangmiao/code/pi-harness"] }
```

写入使用 `persist::write_json`（tmp + rename）。

Orchestration sidecar 创建 worktree 后会 **merge append** 同一文件。
Rust `AccessService` 按文件 mtime 重新加载 persisted roots（缓存 1s），
因此 sidecar 授权对随后的 `files.*` / `git.*` 生效。

Dialog 选中的目录立即 `authorize_root`。
`workspace.allowRoot` 只 restore 已在集合中的根（与 Electron `restoreRoot` 一致）。

拖放：

- Electron：`webUtils.getPathForFile` → `workspaceAuthorizeDroppedRoot` → `authorize_root`
- Tauri：原生 `DragDrop` 对目录 `authorize_root`，再发 `pi-harness:event:native-folder-drop`。
  WKWebView `File` 无路径；Bridge `getPathForFile` 用 `File.path` 或最近一次原生 drop 的 basename 匹配。

`agent.start`：Bridge 先 `workspace_assert_cwd`，cwd 为空则跳过。
