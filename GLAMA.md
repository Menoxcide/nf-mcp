# Glama build settings (paste into Admin → Build Spec)

Glama currently infers `mcp-proxy -- tsx server.js`. The sandbox image does **not** put `node_modules/.bin` on `PATH`, so `tsx` fails with ENOENT even when installed.

## Required Build Spec

```json
{
  "baseImage": "debian:trixie-slim",
  "buildSteps": [
    "pnpm install"
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

Critical changes vs inferred:
1. **`tsx` → `node`** (stdio server is plain JS; no TypeScript)
2. **`pinnedCommit`: null** — do **not** pin `b59bc2b` (that commit is pre-fix)
3. After save, rebuild so checkout is latest `master`

## Verify

Docker log must show a commit **after** `b57a448`, e.g.:

```
HEAD is now at b57a448 ...
```

NOT:

```
HEAD is now at b59bc2b Add Dockerfile and standalone HTTP server
```
