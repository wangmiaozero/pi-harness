# Filesystem Security

所有 renderer 文件操作经过 `AccessService`（`src-tauri/src/security.rs`）。

## Authorized Root

来源：

1. `authorized-roots.json`（持久化；dialog / worktree / sidecar 追加）
2. 当前 workspace folders（存在的才进入 additional）
3. `allowRoot` / `authorize_root` 的内存集合

`PI_HARNESS_USER_DATA` 由 Tauri `app_data_dir` 写入环境变量，sidecar 与 Rust 共用。

## Canonical path

存在的路径：`fs::canonicalize`，去掉 Windows `\\?\` 前缀，统一 `/`。
不存在的路径：lexical normalize（`..` 组件可被 `has_parent_escape` 识别）。

## Containment

比较前对 root 补 `/`，因此：

```text
/Users/wangmiao/code/pi-harness/src/App.vue   允许
/Users/wangmiao/code/pi-harness-other/src     拒绝
/etc/passwd                                   拒绝
```

`must_exist=true` 时用 canonicalize 后的真实路径，symlink 逃出 root 会被拒绝。

## File write

- `assert_writable`：当前 session folders 非空时，只允许可写 folder
- Git 操作走 `assert_writable_for_git`（任意已授权项目根）
- 文本保存：`expectedRevision` 不匹配 → `FILE_CONFLICT`
- 原子写：同目录 `.name.pid.uuid.tmp` + `rename`
- 大小上限：preview 256KiB 文本 / 编辑 2MiB / 上传 25MiB

## Renderer 禁止

Vue 不得直接读任意绝对路径。未授权 → `PATH_DENIED`。
