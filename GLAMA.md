# Glama build settings (Admin → Build Spec)

## Important: `baseImage` is locked

Glama’s builder **only allows** (or always generates):

```text
debian:trixie-slim
```

You **cannot** switch to `bookworm`, `node:*`, etc. in Admin — the UI/API
rejects or rewrites it. Leave `baseImage` as Glama sets it.

## Recommended Build Spec (editable fields only)

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

What you *can* change:

| Field | Value |
|--------|--------|
| `buildSteps` | `pnpm install` + `pnpm run build` (build is a no-op) |
| `cmdArguments` | `mcp-proxy -- node server.js` (**not** `tsx`) |
| `nodeVersion` | `24` (or `20` / `22` if preferred) |
| `pinnedCommit` | `null` |

What you *cannot* change:

| Field | Why |
|--------|-----|
| `baseImage` | Glama-controlled → always `debian:trixie-slim` |

## If build fails: Docker Hub timeout

```
debian:trixie-slim: failed to resolve source metadata for docker.io/library/...
no active session ... context deadline exceeded
```

That is **Glama’s builder ↔ Docker Hub**, not this repo. App code never runs.

**What to do:**

1. **Retry Rebuild** in Glama (often succeeds on 2nd–3rd try).
2. Wait a few minutes if Docker Hub is slow; try again.
3. Do **not** try to change baseImage — the platform won’t allow it.
4. Optional fallback while Docker is flaky: use the **hosted remote** already
   registered for this server (no image build required):

   ```text
   https://nf-mcp.vercel.app/mcp
   ```

   Glama lists the server as `hosting:remote-capable`. Point clients / Glama
   remote URL there until the container build succeeds.

## Code requirements (already on master)

- No-op `build` script (avoids `ERR_PNPM_NO_SCRIPT`)
- MIT `LICENSE`
- stdio **NDJSON** framing in `server.js` (commit `add5ee3+`)
- `cmdArguments` must use **`node`**, not `tsx`

## Verify after a good build

1. Base image pull succeeds (no `context deadline exceeded`)
2. Checkout is after `add5ee3`
3. Log: `nf-mcp: pure JS, no compile step`
4. Runtime: `northern-forge-mcp stdio ready` then initialize **response**
   (not a 60s `-32001` timeout)

## Connector (hosted remote)

Submit at https://glama.ai/mcp/connectors → **Add MCP Server → Connector**.

| Field | Value |
|--------|--------|
| Name | Northern Forge MCP |
| Description | Free-core agent tools with typed schemas (diff, cron, units, JSON→TS, golden hour, pack weight, prompts). No account required. |
| Server URL | `https://nf-mcp.vercel.app/mcp` |
| Private Notes | (leave empty — free-core, no auth) |

### Ownership claim

Live at:

```text
GET https://nf-mcp.vercel.app/.well-known/glama.json
```

```json
{
  "$schema": "https://glama.ai/mcp/schemas/connector.json",
  "maintainers": [{ "email": "justin@justindkamen.com" }]
}
```

Email must match the Glama account. After claim, listing is editable.

### Auth note

`POST /api/mcp/connectors/submit` requires a Glama session (redirects to sign-up when unauthenticated). Complete submit while signed in as the maintainer.

