# luo-publish

Desktop-only Obsidian plugin that ingests notes into a local vault and fills platform draft editors. It never calls an LLM. Auto-publish is supported but **off by default** and must be turned on per platform in the plugin settings.

Commands: **Luo Publish: Ping**, **Luo Publish: 入库当前笔记**, **Luo Publish: 创建分发任务**, **Luo Publish: 推送到浏览器草稿**, **Luo Publish: 标记已发布**, **Luo Publish: 复制并打开创作页**, **Luo Publish: 复制配对令牌**, **Luo Publish: 重新生成配对令牌**, **Luo Publish: 一键分发**, **Luo Publish: 查看分发状态**, and **Luo Publish: 一键发布**. Ingest copies the active note into `raw/sources/<domain>/`. 创建分发任务 writes `raw/outbox/<slug>/` drafts. 推送到浏览器草稿 posts one platform draft to the local bridge and marks that platform `filled`. If that post fails, the plugin copies the draft and opens the platform editor. 复制并打开创作页 does the same copy-and-open on purpose. 标记已发布 sets it to `published`. 一键分发 pushes all four platforms at once. 一键发布 does the same, then has the extension click 发布 on the platforms you opted in (a confirm modal lists which platforms auto-publish and which only fill). 查看分发状态 shows the current per-platform state of one task. Windows install steps and the manual checklist are in [docs/install.md](docs/install.md). On load the plugin listens on `127.0.0.1` only and stores a pairing token in `data.json`. The Chrome/Edge extension pairs with that bridge, pulls `/pending`, fills X, 小红书, B站专栏, and CSDN editor drafts, uploads images on X and 小红书 (first 4, ≤5MB each), and reports the fill/publish outcome back to `POST /report`, which updates `status.json`. 公众号 is not queued or opened. The extension only clicks 发布 when the platform was pushed with auto-publish on.

## Requirements

- Node.js 20+
- pnpm 10

## Build

```bash
pnpm install
pnpm build:plugin
pnpm build:ext
```

esbuild writes `packages/plugin/main.js` next to `packages/plugin/manifest.json`. `pnpm build:ext` writes an unpacked MV3 extension to `packages/bridge-ext/dist`. `pnpm test` runs the plugin and extension tests. Copies of both builds are under `artifacts/`.

Load the extension in Chrome or Edge: Extensions → enable developer mode → Load unpacked → `packages/bridge-ext/dist` (or `artifacts/luo-publish-bridge/dist`). In the popup, enter `http://127.0.0.1:<port>` and the pairing token, then press **配对**. **拉取并填入** calls `GET /pending` and fills the matching editors. The popup also polls every 2 seconds while it is open and paired. Draft bodies drop YAML frontmatter and ingest properties before fill. An `x` item opens `https://x.com/compose/post`, a `bilibili` item opens `https://member.bilibili.com/york/read-editor`, a `xiaohongshu` item opens `https://creator.xiaohongshu.com/publish/publish?from=menu&target=image`, and a `csdn` item opens `https://mp.csdn.net/mp_blog/creation/editor`. A `wechat` item is not opened. Each fill writes the draft and stops there; a publish click happens only for items pushed with `autoPublish`. The popup lists the last result per platform (fill and publish stages). 小红书图文编辑区在选图之前通常不存在，这时返回未找到。

## Load in Obsidian

Copy `main.js` and `manifest.json` into the vault plugin folder, then reload plugins and run **Luo Publish: 入库当前笔记**. `packages/plugin/main.js` is a build output and is not committed.

Windows vault:

```powershell
pnpm install
pnpm build:plugin
$dest = "C:\Users\10901\Documents\yu-luo-wiki\.obsidian\plugins\luo-publish"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Force packages\plugin\main.js "$dest\main.js"
Copy-Item -Force packages\plugin\manifest.json "$dest\manifest.json"
# or, without rebuilding: artifacts\luo-publish-plugin\main.js and manifest.json
```

On this machine the vault mirror `/workspace/yu-luo-wiki` is not present, so the copy is left to the Windows machine that has the vault.
