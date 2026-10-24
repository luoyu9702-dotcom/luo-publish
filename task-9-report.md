# Task 9 report

**Status:** DONE_WITH_CONCERNS

## Commits

- `87f547dfa3ec3c27c3b88a8298e0f97ef4df37ec` — `feat: push queue + status updates`
- `eca0ced145bea4a03f31189b5873a01607ce1e36` — `docs: add task 9 report`

The report hash was recorded in the follow-up commit on `main`.

## What landed

- `packages/plugin/src/status.ts` reads `raw/outbox/<slug>/<platform>.md`, strips the YAML header, and builds `{ platform, title, markdown, images? }`.
- **推送到浏览器草稿** (`push-draft`) asks for an outbox slug, then a platform, and `POST`s that payload to `http://127.0.0.1:<port>/push` with `X-Luo-Token`. A successful enqueue sets that platform in `status.json` to `filled`. A rejected push leaves the file unchanged.
- **标记已发布** (`mark-published`) uses the same pickers and sets that platform to `published`. It does not call the bridge and does not click a platform publish control.
- The bridge comment states the locked path: the plugin enqueues with `POST /push`; the extension does not receive plugin HTTP; `GET /pending` returns the queue and clears it.
- The extension popup button is **拉取并填入**. While the popup is open and paired it still polls every 2 seconds, and the background fill path still runs after each pull. The extension does not click 发布.
- Refreshed `artifacts/luo-publish-plugin/main.js`. The popup label change is in `artifacts/luo-publish-bridge/` and `luo-publish-bridge.zip`.

## How to build and test

```bash
pnpm install
pnpm test
pnpm build:plugin
pnpm build:ext
```

In Obsidian, run **Luo Publish: 创建分发任务**, then **Luo Publish: 推送到浏览器草稿**. In the extension popup, press **拉取并填入**. After you publish by hand, run **Luo Publish: 标记已发布**.

Windows plugin folder:

```powershell
$dest = "C:\Users\10901\Documents\yu-luo-wiki\.obsidian\plugins\luo-publish"
Copy-Item -Force artifacts\luo-publish-plugin\main.js "$dest\main.js"
Copy-Item -Force artifacts\luo-publish-plugin\manifest.json "$dest\manifest.json"
```

## Test output

`pnpm --filter @luo/publish-plugin test` and `pnpm --filter @luo/bridge-ext test` (both exit code 0):

```
plugin:
✓ tests/status.test.ts (6 tests)
✓ tests/commands.test.ts (4 tests)
✓ tests/bridge-protocol.test.ts (4 tests)
✓ tests/outbox.test.ts (5 tests)
✓ tests/vault-io.test.ts (9 tests)
✓ tests/ingest.test.ts (2 tests)
Test Files  6 passed (6)
Tests  30 passed (30)
plugin bundle ok: Ping, ingest, outbox, and bridge commands are present

extension:
Test Files  7 passed (7)
Tests  26 passed (26)
extension dist ok: unpacked MV3 pairing popup
```

`tests/status.test.ts` was run once before `src/status.ts` existed and failed with `Cannot find module '../src/status'`. The passing enqueue test starts a real bridge on `127.0.0.1`, posts a CSDN draft, checks `GET /pending`, and checks that a wrong token does not change `status.json`.

## Concerns

- Obsidian is not installed here, so the slug and platform modals were not clicked in the desktop app. The command names are in the production bundle, and the status helpers were tested against a fake vault.
- `filled` means the local bridge accepted the draft. The plugin does not hear back when the extension fills or misses the editor DOM. **标记已发布** is the manual step after you publish.
- The bridge queue is in memory. Reloading the plugin drops items that the extension has not pulled, while `status.json` can already say `filled`. Run **推送到浏览器草稿** again to enqueue it.
- Task 10 (copy-and-open fallback and the install doc) was not started.
