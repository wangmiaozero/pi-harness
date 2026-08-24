# Pi Package 与 Skill 生命周期管理

Pi-Harness 将 Skill 与 Package 分开管理，但不建立第二份安装数据库：

- Pi 全局 `settings.json.packages` 与项目 `.pi/settings.json.packages` 是唯一注册事实来源。
- npm、git、local 安装路径和 `package.json` 只用于派生安装实体、版本、资源、依赖与权限状态。
- Skill 可以是独立目录，也可以是 Package 提供的只读子资源。扩展、Prompt、Theme 和静态可识别的 Tool 使用同一 Package 归属模型。

## 派生状态

| 状态               | 含义                                       | 可用操作               |
| ------------------ | ------------------------------------------ | ---------------------- |
| `healthy`          | 注册项、安装实体、Manifest、依赖和权限一致 | 重新安装、彻底卸载     |
| `missing`          | 已注册，但安装实体缺失                     | 修复、彻底卸载残留注册 |
| `orphaned`         | Pi 托管目录存在，但没有注册项              | 重新注册、删除孤立文件 |
| `permission-error` | 当前用户无法安全读写，或 owner 不一致      | 系统授权修复、彻底卸载 |
| `corrupted`        | Manifest、依赖或注册表重复项异常           | 修复、彻底卸载         |
| `unknown`          | 来源无法可靠解析                           | 查看诊断并人工处理     |

Package id 由 `scope + source identity` 组成。npm 以包名、git 以去除 ref 的仓库 URL、local 以路径为身份；全局与项目同名包不会混为一项。

## 事务边界

安装、修复、注册和卸载均由 Main 进程调用 Pi CLI，参数使用数组传递：

1. 校验来源、作用域和项目根目录；
2. 对对应 `settings.json` 创建事务快照与本地备份；
3. 执行 Pi 原生命令；
4. 重新读取注册表并扫描安装实体；
5. 只有注册、文件和健康状态验证通过才返回成功；
6. 失败时恢复注册表快照，遗留文件会在下一次对账中显示为可修复的孤立或损坏状态。

Renderer 只能提交结构化的 `{ source, scope, projectRoot }`。项目根目录必须已由 FileAccess 授权；Renderer 不能提交命令、安装路径或待删除文件路径。删除孤立包只允许对实时扫描得到、位于 Pi `npm/node_modules` 或 `git` 托管根目录内的真实路径执行。

## Skill 卸载规则

每个 Skill 都提供卸载入口：

- 用户编写或单独安装的独立 Skill：先复制到 Pi-Harness capability backup，再删除 Skill 根目录下的直接子目录；
- Package 提供的 Skill：卸载所属 Package，不能只删除子 Skill 目录，以免制造残缺扩展包；
- Featured Skill：继续通过可信 Capability catalog 生命周期卸载。

“清理第三方能力”会在 Main 进程重新生成计划，覆盖已注册第三方 Package、Pi 托管孤立 Package 和独立 Skill。Provider、Model、API Key、凭证、Session、历史记录、Pi-Harness 设置及与 Package 无关的 Pi 设置不会被删除。

## 权限与启动保护

诊断会检查全局及当前项目的 `.pi`、`npm`、`node_modules`、`git` 和首个深层异常节点，并报告 uid、读写执行权限及 owner 是否匹配。普通 owner 权限直接修复；macOS owner 不一致时走系统管理员授权，只处理 Pi Package 目录。

启动 Pi Session 前会重新执行 Package 对账。已注册 Package 处于 `missing`、`permission-error` 或 `corrupted` 时，Pi-Harness 会阻止启动并要求先在“技能 → 扩展包”中修复或彻底卸载，避免 Pi 自动恢复掩盖问题。

## 验证覆盖

单元测试覆盖健康安装、注册缺文件、孤立目录、损坏 Manifest、依赖缺失、权限异常、重复注册、本地路径稳定身份、全局/项目同名隔离、缺文件卸载与验证失败回滚、孤立文件安全删除、项目级安装验证、输入注入拒绝和 EACCES 分类。完整回归命令：

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm compile
pnpm test:e2e:only
```
