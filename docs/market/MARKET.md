<p align="center">
  <a href="https://infistar.cc/register?aff=S26RFM4B&ref_source=link">
    <img src="../assets/infistar-banner.png" width="100%" alt="Pi-Harness × Infistar.cc 无限星河" />
  </a>
</p>

## 赞助商

<table>
  <tr>
    <td>
      Pi-Harness × Infistar.cc 无限星河｜Claude、GPT、Gemini、Grok、DeepSeek 等，一个 Key，只花官方价的零头，省 99%；低至官方 0.1 折，100% 官方纯血，每个模型都能验真；上千线路安全冗余自动切换，200+ 模型、16 个品牌，一个 Key 搞定。<br>
      Pi-Harness 用户通过<a href="https://infistar.cc/register?aff=S26RFM4B&ref_source=link">专属链接</a>注册直接送人民币 5 元：<a href="https://infistar.cc/register?aff=S26RFM4B&ref_source=link">https://infistar.cc/register?aff=S26RFM4B&ref_source=link</a>
    </td>
  </tr>
</table>

# Resource Market

Pi-Harness keeps classic color themes in the application. Character themes and desktop pets are optional packs.

Open **Settings → Resource Market**. The market searches only `https://registry.npmjs.org` for packages whose names match:

```text
^@piharness/(theme|pet)-[a-z0-9][a-z0-9-]*$
```

Each package is installed, updated, and removed on its own. The installer downloads the registry tarball, checks its `sha512` integrity, rejects scripts, symlinks, and path traversal, then commits the files atomically.

Theme packs are stored in `<userData>/market/themes/<id>/`. Pet packs use the existing pet installer and are stored in `<userData>/petpacks/<id>/`. The local index is `<userData>/market/registry.json`.

The application starts without waiting for the registry. A saved theme or pet id is not cleared when its files are absent. The workspace uses the base appearance, and Settings says the pack still needs to be installed. Installing that pack restores it. Changing the selection yourself is kept.

Nothing is downloaded automatically.
