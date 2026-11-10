# Harness Plugin security boundary

## Trust model

**Do not enable executable plugin code unless you trust it with your computer.** The MVP does not claim to safely run arbitrary untrusted third-party JavaScript.

A declarative plugin executes no plugin code and can only contribute validated team templates. A code plugin needs native, explicit code-trust approval before activation. The dialog names the plugin/version, requests its host capabilities, displays the installed content digest and explains unrestricted Node access. Renderer input cannot supply a boolean that bypasses this decision.

Executable code runs in an Electron utility process to contain normal exceptions, synchronous hangs and exits. That process has Node.js and OS privileges: malicious approved code could access files, network, processes or local secrets outside the SDK. Capability grants **do not restrict arbitrary Node imports**. The host does not expose filesystem, shell, network or secret APIs and does not forward ambient credential environment variables, but neither measure creates an OS sandbox. Do not interpret them as protection against malicious trusted code. See Electron's [utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process) documentation for the process primitive.

## Host protections

- Local folder selection only; no network installer, package scripts, remote store, automatic download or silent code execution during discovery/validation/install.
- Strict manifest schemas, bounded files, safe filename/ID rules, no entry paths/URLs, duplicate detection and API version checks.
- Symlink/non-regular-file rejection for source roots, manifest/entry, managed root and metadata. Leaf files use no-follow handles and identity checks. Hard-linked source files are rejected. Uninstall never recursively follows plugin-controlled links.
- Installation is staged and renamed into a Main-owned directory. Approved digest is verified after confirmation and before activation; changed code must be reinstalled. These are integrity checks, not publisher authentication.
- Permissions are persisted per installed plugin. They default empty; grants come only from the Main-owned approval dialog. Uninstall clears grants and digest trust.
- Existing trusted-main-frame IPC checks and runtime argument schemas cover management. Installation/destination/project paths come from Main-owned native pickers; renderer-provided path strings are rejected.
- Code executes in neither Renderer nor a WebView. Electron context isolation, node-integration settings and the Pi runtime path remain unchanged.
- Only the five documented Harness event types are projected. Prompts, messages, command arguments, tool output, raw errors, cwd, trace metadata and credentials are excluded from SDK inputs.
- Evaluators cannot receive core objects by reference, mutate built-in results or approve review gates. Team templates use existing orchestration services and create pending work only.
- Plugin JSON output is size/depth validated and redacted. The host owns destination selection and writes. Existing core exports remain unchanged.

## Availability controls

Default operation deadline is two seconds; disposal has at most 500 ms. A failed protocol, event callback, timeout or process exit detaches contributions and disables that plugin; no automatic restart loop. A rejected manual evaluator/exporter callback fails that operation; the plugin can remain active unless its process or protocol fails. Termination has a bounded forced-kill fallback. Event dispatch is scheduled off the synchronous Harness execution path, with 64 queued events per plugin, at most eight active and 64 installed plugins. Overflow drops telemetry and records a counter/warning. It must not be used as an authoritative audit stream.

Manifest reads are limited to 64 KiB and executable entries to 512 KiB. Process replies are bounded to 256 KiB, depth 12 and 16,000 visited values. Registrations, spans, logs and persisted supplementary results also have limits. Trusted code could still consume OS resources or attempt oversized native IPC messages; these bounds are defensive protocol limits, not a hostile-code resource sandbox.

## Known limitations

- No OS-level filesystem/network/secret isolation; no safe arbitrary-code execution. Use declarative plugins for untrusted third-party content.
- Same-user processes with filesystem access are outside this trust boundary. No portable user-space check can eliminate every rename race by an attacker already controlling the profile directories; use trusted local storage and reviewed code. Symlink checks cover normal install/uninstall flows, not a compromised OS account.
- No signatures, publisher verification, dependency fetching, hot update, remote store or native-library API. Reinstall is explicit and resets approval.
- Evaluations are advisory and manually invoked. No plugin API changes live policy, vetoes a Pi tool call, starts agent sessions, dispatches tasks, or rewrites a review verdict.
- Event delivery is bounded/best effort; logs are session-local. Supplementary evaluator results persist with bounded retention, independently of core runs.
- Team templates contain instructions; inspect them before starting. A plugin-created workflow is still subject to configured providers, budgets, workspace permissions, scheduling and review gates when the user starts it.

Future untrusted-code execution needs a separately evaluated OS sandbox and a narrower protocol. Adding permission labels to ordinary Node processes or workers is insufficient.

## 赞助商

<table>
  <tr>
    <td width="420" align="center" valign="middle">
      <a href="https://infistar.cc/register?aff=S26RFM4B&ref_source=link">
        <img src="../assets/infistar-banner.png" width="400" alt="Pi-Harness × Infistar.cc 无限星河" />
      </a>
    </td>
    <td valign="middle">
      Pi-Harness × Infistar.cc 无限星河｜Claude、GPT、Gemini、Grok、DeepSeek 等，一个 Key，只花官方价的零头，省 99%；低至官方 0.1 折，100% 官方纯血，每个模型都能验真；上千线路安全冗余自动切换，200+ 模型、16 个品牌，一个 Key 搞定。<br>
      Pi-Harness 用户通过<a href="https://infistar.cc/register?aff=S26RFM4B&ref_source=link">专属链接</a>注册直接送人民币 5 元：<a href="https://infistar.cc/register?aff=S26RFM4B&ref_source=link">https://infistar.cc/register?aff=S26RFM4B&ref_source=link</a>
    </td>
  </tr>
  <tr>
    <td width="420" align="center" valign="middle">
      <a href="https://cloud.tencent.com/act/cps/redirect?redirect=6871&amp;cps_key=ece2099a1da90c2f7a4a4c437ad623f8&amp;from=console">
        <img src="../assets/workbuddy-banner.jpg" width="400" alt="腾讯云 WorkBuddy" />
      </a>
    </td>
    <td valign="middle">
      【腾讯云】WorkBuddy 全场景 AI 办公工作台，团队旗舰版低至198元/月<br>
      <a href="https://cloud.tencent.com/act/cps/redirect?redirect=6871&amp;cps_key=ece2099a1da90c2f7a4a4c437ad623f8&amp;from=console">https://cloud.tencent.com/act/cps/redirect?redirect=6871&amp;cps_key=ece2099a1da90c2f7a4a4c437ad623f8&amp;from=console</a>
    </td>
  </tr>
</table>

