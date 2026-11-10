# Plugin manifest

Place `plugin.json` in the local plugin directory. Unknown fields are rejected. Installations copy only this manifest and the optional declared entry; extra files, install scripts, URLs and dependencies are not processed.

```json
{
  "id": "org.example.run-metrics",
  "name": "Run Metrics",
  "version": "1.0.0",
  "apiVersion": "^1.0.0",
  "description": "Measure recorded runs without changing execution.",
  "author": "Example author",
  "entry": "main.mjs",
  "permissions": ["events:read"],
  "contributions": {
    "events": ["run.started", "tool.completed", "run.completed", "run.failed"],
    "evaluators": [],
    "exporters": [],
    "teams": []
  }
}
```

| Field                           | Contract                                                                                                                                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                            | Unique installed ID; 3–100 characters, lowercase alphanumeric segments separated by `.` or `-`, beginning with a letter. Duplicate IDs are rejected rather than replaced.                |
| `name`, `description`, `author` | Required, nonempty bounded strings.                                                                                                                                                      |
| `version`                       | Exact SemVer, including an optional SemVer prerelease.                                                                                                                                   |
| `apiVersion`                    | Valid SemVer range that includes the host SDK version, currently `1.0.0`. Incompatible plugins can be listed but cannot activate.                                                        |
| `entry`                         | `null` (default) for data-only plugins, or one top-level filename such as `main.mjs`. No separators, URL, traversal, absolute path, shell command, native binary or arbitrary installer. |
| `permissions`                   | Unique subset of the four capabilities below; defaults to `[]`. A declaration is a request, never a grant.                                                                               |
| `contributions`                 | Declared events, evaluator/exporter `{id, version}` pairs and team templates. Lists default to empty and are bounded. Code registrations must match declarations.                        |

Permissions are `events:read`, `evaluation:read`, `trace:read`, and `teams:contribute`. Each nonempty contribution requires its matching permission. Filesystem, shell, network, secrets and policy-mutation APIs are not exposed by this SDK. Executable Node code nevertheless has OS access after full trust approval; these capability grants are not an OS access-control mechanism.

## Team templates

See the complete [Team Template manifest](../../examples/harness-plugins/team-template/plugin.json). Each template has its own ID, exact version, name and permission requirements. Agent definitions use unique `key`, name, role, optional description, `shared`/`worktree` mode, and `isReviewer`. Tasks have unique keys, title, description, agent key, dependency keys and `reviewRequired`.

Validation rejects duplicate keys, missing agents/dependencies, self-dependency, cycles and review requirements without a reviewer. Template permissions must be a subset of manifest permissions and of approved grants when applied. The MVP accepts at most 16 agents and 64 tasks per template. It cannot inject model credentials, executable hooks or scheduler replacements through a manifest.

A task description is still an instruction to a future agent. Review the template before starting its pending orchestration. Worktree creation and review dispatch use the existing orchestrator's behavior.

## 赞助商

<table>
  <tr>
    <td width="580" align="center" valign="middle">
      <a href="https://infistar.cc/register?aff=S26RFM4B&ref_source=link">
        <img src="../assets/infistar-banner.png" width="560" alt="Pi-Harness × Infistar.cc 无限星河" />
      </a>
    </td>
    <td valign="middle">
      Pi-Harness × Infistar.cc 无限星河｜Claude、GPT、Gemini、Grok、DeepSeek 等，一个 Key，只花官方价的零头，省 99%；低至官方 0.1 折，100% 官方纯血，每个模型都能验真；上千线路安全冗余自动切换，200+ 模型、16 个品牌，一个 Key 搞定。<br>
      Pi-Harness 用户通过<a href="https://infistar.cc/register?aff=S26RFM4B&ref_source=link">专属链接</a>注册直接送人民币 5 元：<a href="https://infistar.cc/register?aff=S26RFM4B&ref_source=link">https://infistar.cc/register?aff=S26RFM4B&ref_source=link</a>
    </td>
  </tr>
  <tr>
    <td width="580" align="center" valign="middle">
      <a href="https://cloud.tencent.com/act/cps/redirect?redirect=6871&amp;cps_key=ece2099a1da90c2f7a4a4c437ad623f8&amp;from=console">
        <img src="../assets/workbuddy-banner.jpg" width="560" alt="腾讯云 WorkBuddy" />
      </a>
    </td>
    <td valign="middle">
      【腾讯云】WorkBuddy 全场景 AI 办公工作台，团队旗舰版低至198元/月<br>
      <a href="https://cloud.tencent.com/act/cps/redirect?redirect=6871&amp;cps_key=ece2099a1da90c2f7a4a4c437ad623f8&amp;from=console">https://cloud.tencent.com/act/cps/redirect?redirect=6871&amp;cps_key=ece2099a1da90c2f7a4a4c437ad623f8&amp;from=console</a>
    </td>
  </tr>
</table>

