# Glama build settings (Admin → Build Spec)

Glama may infer `mcp-proxy -- tsx server.js` and/or add `pnpm run build`.
This repo is **plain Node JS** (no TypeScript compile). `server.js` is the
stdio entry; `package.json` includes a no-op `build` so a forced build step
still succeeds.

## Recommended Build Spec

Prefer **`debian:bookworm-slim`** (stable, widely cached). Avoid
`debian:trixie-slim` when Docker Hub metadata pulls time out.

```json
{
  "baseImage": "debian:bookworm-slim",
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

1. **`tsx` → `node`** in `cmdArguments` (stdio server is plain JS; NDJSON framing)
2. **`pinnedCommit`: null** — never pin old commits
3. **`pnpm run build` is safe** — no-op script; pure JS, no dist/
4. After save, **rebuild** so checkout is latest `master` (need `add5ee3+` for stdio)
5. **LICENSE** is MIT at repo root

### If build fails on base image metadata

Error looks like:

```
debian:trixie-slim: failed to resolve source metadata for docker.io/library/...
context deadline exceeded
```

That is **Glama → Docker Hub**, not app code. Fix:

1. **Retry** the build (transient session/timeout)
2. Switch `baseImage` to **`debian:bookworm-slim`** (or omit and let Glama default)
3. Keep `nodeVersion: "24"` so Node is installed on top of the base

## Minimal alternative

```json
{
  "baseImage": "debian:bookworm-slim",
  "buildSteps": ["pnpm install", "pnpm run build"],
  "cmdArguments": ["mcp-proxy", "--", "node", "server.js"],
  "nodeVersion": "24",
  "pinnedCommit": null
}
```

## Verify

Docker log should:

1. Pull base image successfully (not deadline exceeded)
2. Checkout a commit **after** `add5ee3` (stdio NDJSON fix)
3. Show `nf-mcp: pure JS, no compile step`
4. At runtime: `northern-forge-mcp stdio ready` then an initialize **response**, not a 60s timeout

Must **not**:

```
ERR_PNPM_NO_SCRIPT  Missing script: build
MCP error -32001: Request timed out
failed to resolve source metadata ... context deadline exceeded
```
