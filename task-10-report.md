# Task 10 report

**Status:** DONE_WITH_CONCERNS

## Commits

- `d374552a8aad28433cfb379066893cb2be479b1c` — `docs: install and fallback`
- `95dd331fece7cf7244c241e27dd4adb9ccff8daa` — `docs: add task 10 report`

The report hash was recorded in the follow-up commit on `main`.

## What landed

- `packages/plugin/src/fallback.ts` copies the outbox draft and opens the same editor URL the extension filler uses for that platform. X, 小红书, 公众号, B站专栏, and CSDN are covered. A title that is not already in the body is placed above the markdown so one paste still has it.
- **复制并打开创作页** (`copy-open-compose`) asks for the outbox slug and platform, copies the draft, then calls `window.open`. If that returns nothing, the desktop app opens the URL with Electron.
- **推送到浏览器草稿** still posts to `http://127.0.0.1:<port>/push` and marks the platform `filled` when the bridge accepts it. If the bridge is down or the post is rejected, the same copy-and-open runs and the Notice says the draft was copied and the editor was opened. Status stays unchanged on that path. Nothing clicks 发布.
- `docs/install.md` is the Windows install guide: plugin folder `C:\Users\10901\Documents\yu-luo-wiki\.obsidian\plugins\luo-publish`, unpacked extension from the zip or `dist`, pairing, and the daily commands. The same text is mirrored at `docs/superpowers/install-luo-publish.md`.
- Section 5 of that doc is the manual checklist from spec §8: empty-vault ingest, five draft files, one paired fill without publishing, and readable errors when the bridge or login is missing. The boxes are unchecked.
- Refreshed `artifacts/luo-publish-plugin/main.js`. The extension popup did not change, so the extension zip was left as built in Task 9.

## How to build and test

```bash
pnpm install
pnpm test
```

Install steps for the Windows vault are in `docs/install.md`.

## Test output

`pnpm test` (exit code 0):

```
plugin:
✓ tests/fallback.test.ts (6 tests)
✓ tests/status.test.ts (6 tests)
✓ tests/commands.test.ts (4 tests)
✓ tests/bridge-protocol.test.ts (4 tests)
✓ tests/outbox.test.ts (5 tests)
✓ tests/vault-io.test.ts (9 tests)
✓ tests/ingest.test.ts (2 tests)
Test Files  7 passed (7)
Tests  36 passed (36)
plugin bundle ok: Ping, ingest, outbox, and bridge commands are present

extension:
Test Files  7 passed (7)
Tests  26 passed (26)
extension dist ok: unpacked MV3 pairing popup
```

`tests/fallback.test.ts` was run once before `src/fallback.ts` existed and failed with `Cannot find module '../src/fallback'`. The passing tests check that the compose URLs are the strings in the extension fillers, that a missing draft does not open a page, and that a failed push opens the editor while a successful push does not.

## Concerns

- Obsidian and Chrome are not installed here, so the checklist in `docs/install.md` was not executed. Those boxes stay open.
- `/workspace/yu-luo-wiki` is not on this machine, so the install doc was not copied into that vault. The repo copy is `docs/superpowers/install-luo-publish.md`.
- `window.open` is tried first. On desktop Obsidian it may be blocked; Electron `shell.openExternal` is the second step and was not exercised in a real Obsidian window.
- This is the last task in the plan. No further task was added.
