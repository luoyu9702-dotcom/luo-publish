# Task 5 report

**Status:** DONE_WITH_CONCERNS

## Commits

- `b74f95786be5d2adef2fa9bee3f336b02a896b3d` — `feat: localhost bridge for draft push`
- `422b5db58f7096ec59b73572170497c469895b56` — `docs: add task 5 report`

The report hash was recorded in the follow-up commit on `main`.

## What landed

- Node `http` server bound to `127.0.0.1` only (OS-chosen port). `require("http")` and `require("crypto")` stay external in `main.js`.
- `POST /pair` with `{ token }` returns `{ ok: true, port }` when the token matches. A missing token is rejected.
- `POST /push` requires `X-Luo-Token`. A missing token is rejected. An unknown platform is rejected and not queued. A valid body `{ platform, title, markdown, images? }` is enqueued and returns `{ ok: true }`.
- `GET /pending` with the same header returns the queue and clears it. A missing token does not clear the queue.
- The pairing token is stored as `bridgeToken` in the plugin `data.json`. Commands: **复制配对令牌** and **重新生成配对令牌**. On load, a notice shows `127.0.0.1:<port>` and the copy command. `onunload` stops the server.
- No browser extension.
- `artifacts/luo-publish-plugin/main.js` and `manifest.json` were refreshed after the production build.

## Test output

`pnpm test`:

```
✓ tests/ingest.test.ts (2 tests)
✓ tests/commands.test.ts (4 tests)
✓ tests/bridge-protocol.test.ts (4 tests)
✓ tests/vault-io.test.ts (9 tests)
✓ tests/outbox.test.ts (5 tests)

Test Files  5 passed (5)
Tests  24 passed (24)

plugin bundle ok: Ping, ingest, outbox, and bridge commands are present
```

Exit code 0. The bridge suite was run once before `src/bridge-server.ts` existed and failed with `Cannot find module '../src/bridge-server'`. The passing HTTP tests opened a real server on `127.0.0.1`.

## Concerns

- Obsidian is not installed here, so plugin load, the notice, clipboard copy, and unload were not clicked in the app. The protocol itself was exercised over HTTP.
- The in-memory queue is cleared when the plugin unloads. It is not written to the vault.
