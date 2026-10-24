# Task 1 report

**Status:** DONE_WITH_CONCERNS

## Commits

- `e389cbf1d2c377a97bb8d699452dd8798ec12dd3` — `chore: scaffold luo-publish plugin`
- `eed2bbc23df9c5ded503469115b2552496ae84ee` — `docs: add task 1 report`

Both are on `main`. The hash list above was filled in the follow-up commit after `eed2bbc`.

## What landed

- pnpm workspace `luo-publish` with `packages/*`.
- Plugin package `@luo/publish-plugin`.
- Obsidian plugin id `luo-publish`, `isDesktopOnly: true`.
- Command `luo-ping` / **Luo Publish: Ping** shows Notice `luo-publish ok`.
- esbuild (Obsidian sample layout) writes `packages/plugin/main.js` beside `packages/plugin/manifest.json`.
- No ingest, outbox, bridge, or extension code.

## How to build

```bash
pnpm install
pnpm build:plugin
pnpm test
```

`pnpm test` rebuilds and checks that `main.js` still contains `luo-ping`, `Luo Publish: Ping`, and `luo-publish ok`, and that `manifest.json` id is `luo-publish`.

Load in a vault:

```bash
mkdir -p "<vault>/.obsidian/plugins/luo-publish"
ln -sfn "$(pwd)/packages/plugin/main.js" "<vault>/.obsidian/plugins/luo-publish/main.js"
ln -sfn "$(pwd)/packages/plugin/manifest.json" "<vault>/.obsidian/plugins/luo-publish/manifest.json"
```

Reload Obsidian and run **Luo Publish: Ping**.

## Concerns

- Obsidian is not installed here, so the plugin was not reloaded in the app. The production bundle was inspected instead: it `require`s `obsidian` and registers the Ping command with Notice `luo-publish ok`. `pnpm test` passed.
- `/workspace/yu-luo-wiki` is not on this machine, so the vault symlink was not created.
- `pnpm-workspace.yaml` adds `onlyBuiltDependencies: [esbuild]` so pnpm 10 runs esbuild’s postinstall. The `packages` list matches the brief.
