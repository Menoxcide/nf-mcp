# Glama build settings (Admin → Build Spec)

Glama may infer `mcp-proxy -- tsx server.js` and/or add `pnpm run build`.
This repo is **plain Node JS** (no TypeScript compile). `server.js` is the
stdio entry; `package.json` includes a no-op `build` so a forced build step
still succeeds.

## Recommended Build Spec

```json
{
  "baseImage": "debian:trixie-slim",
  "buildSteps": [
    "pnpm install",
    "pnpm run build"
  ],
  "cmdArguments": [
    "mcp-proxy",
    "--",
    "node",
    "server.js"
  ],
  "nodeVersion": "24",
  "pinnedCommit": null,
  "placeholderArguments": {},
  "pythonVersion": null
}
```

### Critical

1. **`tsx` → `node`** in `cmdArguments` (stdio server is plain JS)
2. **`pinnedCommit`: null** — never pin old commits (`b59bc2b` is pre-fix)
3. **`pnpm run build` is safe** — no-op script; pure JS, no dist/
4. After save, **rebuild** so checkout is latest `master`
5. **LICENSE** is MIT at repo root (fixes Glama “license — not found”)

## Minimal alternative (no build step)

```json
{
  "buildSteps": ["pnpm install"],
  "cmdArguments": ["mcp-proxy", "--", "node", "server.js"],
  "nodeVersion": "24",
  "pinnedCommit": null
}
```

## Verify

Docker log must show a commit **after** the license/build fix, e.g. HEAD
message containing `build` + `LICENSE`, and:

```
HEAD is now at <sha> ...
Done in ... using pnpm ...
nf-mcp: pure JS, no compile step
```

Must **not** fail with:

```
ERR_PNPM_NO_SCRIPT  Missing script: build
```

Must **not** run `tsx server.js` (ENOENT on PATH without node_modules/.bin).
