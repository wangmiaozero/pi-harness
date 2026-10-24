# Agent settings / 智能体设置

Available in v2.2.10 and later. Older installers may not include every settings page.

以下功能从 v2.2.10 起提供，旧版安装包可能不包含全部设置页面。

[English README](../README.md#agent-settings) · [简体中文 README](../README.zh-CN.md#agent-settings) · [Screenshots / 截图](README.md)

## AI preferences / AI 偏好

Open **Settings → AI** to choose default thinking, automatic context compaction, retry behavior, and workspace defaults. Save changes; the page indicates when a setting applies to new sessions.

打开“**设置 → AI**”，调整默认思考级别、自动上下文压缩、错误重试与工作区默认选项，修改后保存。页面会提示哪些设置在新会话中生效。

## Realtime voice / 实时语音

### English

1. Open **Settings → Realtime voice**, enable voice, choose **OpenAI Realtime, Gemini Live, or Codex Live**, and save your settings.
2. Choose a supported service account or supply a separate API key. Codex Live uses your existing Codex sign-in in Pi. Availability and charges depend on your account.
3. Open a workspace conversation and click the waveform button beside the composer. Check the target conversation before starting.
4. Choose whether to share recent context. Sharing is off by default. When enabled, it includes only the last six plain-text messages, excluding attachments and tool results.
5. Start the call and allow microphone access. The floating controls let you mute, view transcripts, or end the call, including after navigating to another page.
6. Review any voice work request and choose **Send to conversation** or **Dismiss request**. Sending a work request starts work with the conversation's configured coding agent.

### 中文

1. 打开“**设置 → 实时语音**”，启用语音，选择 **OpenAI Realtime、Gemini Live 或 Codex Live** 并保存设置。
2. 选择支持的服务账号或填写独立 API 密钥。Codex Live 使用你在 Pi 中已有的 Codex 登录账号，服务可用性与费用取决于账号。
3. 打开工作区中的对话，点击输入框旁的波形按钮，开始前确认目标会话。
4. 按需开启近期上下文共享。该选项默认关闭；开启后只共享最近六条纯文本消息，不包含附件和工具结果。
5. 开始通话并允许使用麦克风。浮动控件可用于静音、查看转写或结束通话，切换页面后仍可使用。
6. 审阅语音提出的工作请求，选择“**发送到工作会话**”或“**忽略请求**”。发送后会由该会话配置的编码智能体执行工作。

The voice screenshots show setup and preparation before a call.

语音截图展示设置与通话前的准备状态。

## Keyboard shortcuts / 快捷键

In **Settings → Shortcuts**, click a shortcut and press the desired combination for the command palette, settings, a new session, or closing a tab. Escape cancels recording; Backspace clears the selected shortcut. Restore defaults when needed. Editor save and find shortcuts are listed separately.

在“**设置 → 快捷键**”中点击需要修改的项目，录制命令面板、打开设置、新建会话或关闭标签页的组合键。按 Escape 取消录制，按 Backspace 清除该快捷键，也可恢复默认设置。编辑器保存和查找快捷键单独列出。

## Instructions / 指令

Open **Settings → Instructions**, choose **Global** or a project folder, edit the instructions, and save. Check the selected scope before saving. If you leave with unsaved edits, the app asks whether to discard them.

打开“**设置 → 指令**”，选择“**全局**”或项目目录，编辑后保存。保存前确认作用范围；离开页面时若有未保存的修改，应用会询问是否放弃。

## MCP servers and marketplace / MCP 服务器与市场

Open **Settings → MCP**. Use **All / Global / Project** and the project selector to choose which servers to view. Servers with the same name in different scopes can be edited independently.

打开“**设置 → MCP**”，使用“**全部 / 全局 / 项目**”和项目选择器切换服务器列表。不同范围内的同名服务器可分别编辑。

- **Add a server:** choose the destination scope and enter a local command or HTTP endpoint. Review its configuration before saving and enabling it.
- **Marketplace:** browse 15 built-in templates or search the official MCP registry. Review the server configuration and destination before installing. Registry results support pagination.
- **Scan other tools:** review discovered configurations before importing. Imported and official-registry entries are saved disabled; complete the account or environment configuration before enabling them.

- **添加服务器：**选择目标范围，填写本地命令或 HTTP 地址，检查配置后再保存和启用。
- **市场：**浏览 15 个内置模板，或搜索官方 MCP 注册表；安装前检查配置与目标范围，注册表结果支持分页。
- **从其他工具扫描：**先审阅扫描到的配置再导入。扫描导入和官方注册表条目保存后默认关闭，补齐账号或环境配置后再启用。

The templates are available to install; they do not represent 15 running connections. Required tools and service credentials depend on the selected server.

内置模板供按需安装，不代表已经连接了 15 个服务。所需工具和服务凭证取决于所选服务器。

## Reusable subagents / 可复用子智能体

In **Settings → Subagents**, create or edit a template with a name, role, instructions, model, thinking level, and tools. Choose a shared workspace or an isolated worktree and optionally mark it as a reviewer. To start a task, choose the project and enter the task. Templates can also be reused in teams under **Workspace → Tools → Agents**.

在“**设置 → 子智能体**”中创建或编辑模板，填写名称、角色、指令、模型、思考级别与工具，选择共享工作区或独立 worktree，并可标记为审阅者。运行任务时选择项目并输入任务内容；模板也可在“**工作区 → 工具 → 智能体**”的团队中复用。

## Remote hosts / 远程主机

Start **pi-host** on the target host first. In **Settings → Remote hosts**, enter the address and pairing token supplied by that service. Once paired, connect to browse projects and sessions, view conversation history, send prompts, and respond to approval requests. Disconnect or remove a host when needed.

先在目标主机运行 **pi-host**，再在“**设置 → 远程主机**”中输入该服务提供的地址与配对令牌。配对连接后可浏览项目和会话、查看对话历史、发送提示词并处理审批请求，也可按需断开或移除主机。

## Common questions / 常见问题

| Symptom / 现象                                         | What to check / 检查项                                                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| A settings page is missing / 缺少设置页面              | Check whether your version includes it; v2.2.10 and later contain all seven pages. / 确认当前版本是否包含该功能；v2.2.10 起提供七个页面。  |
| Voice start is disabled / 语音开始按钮不可用           | Enable voice, choose a supported account or API key, and save. / 启用语音、配置支持的账号或 API 密钥并保存。                               |
| Microphone access fails / 无法使用麦克风               | Check the application's microphone permission and device availability. / 检查应用的麦克风权限及设备是否可用。                              |
| An imported MCP server is disabled / 导入的 MCP 未启用 | This is expected; review and complete its configuration before enabling. / 这是预期状态，审阅并补齐配置后再启用。                          |
| Project servers are missing / 未显示项目服务器         | Select the intended project and check the scope filter. / 选择目标项目并检查范围筛选。                                                     |
| A remote host cannot connect / 远程主机无法连接        | Check that pi-host is running and reachable, and that the address and token are correct. / 确认 pi-host 正在运行且可连接，地址与令牌正确。 |
