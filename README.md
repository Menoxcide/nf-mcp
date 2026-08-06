# Northern Forge MCP

**Hosted endpoint:** `https://nf-mcp.vercel.app/mcp`  
**Landing:** https://nf-mcp.vercel.app  
**Install docs:** https://northern-forge-labs.vercel.app/agents  
**Hub:** https://forge.justindkamen.com  
**Glama:** https://glama.ai/mcp/servers/Menoxcide/nf-mcp  
**Glama badge:** [![Menoxcide/nf-mcp MCP server](https://glama.ai/mcp/servers/Menoxcide/nf-mcp/badges/score.svg)](https://glama.ai/mcp/servers/Menoxcide/nf-mcp)


Free-core tools agents call today: `diff_text`, `cron_explain`, `unit_convert`, `json_to_ts`, `base64_codec`, `uuid_batch`, `csv_to_markdown`, `wcag_contrast`, `regex_test`, `jwt_decode`, `golden_hour_windows`, `pack_weight_sum`, `prompt_variants`, plus catalog/popular helpers.

Typed JSON schemas. No account required to list or call core tools. Works with Claude Desktop, Cursor, Grok, Gemini, and custom agents.

## Quick install

### HTTP (hosted)

```json
{
  "mcpServers": {
    "northern-forge": {
      "url": "https://nf-mcp.vercel.app/mcp"
    }
  }
}
```

### REST (any client)

```bash
curl -s https://nf-mcp.vercel.app/tools \
  -H 'content-type: application/json' \
  -d '{"name":"json_to_ts","arguments":{"json":"{\"id\":1}"}}'
```

## Endpoints

| URL | Role |
|-----|------|
| `POST https://nf-mcp.vercel.app/mcp` | MCP JSON-RPC |
| `GET/POST https://nf-mcp.vercel.app/tools` | REST list/call |
| `GET https://nf-mcp.vercel.app/health` | Health |


## Glama

- Server listing: https://glama.ai/mcp/servers/Menoxcide/nf-mcp
- Ownership claim: `GET https://nf-mcp.vercel.app/.well-known/glama.json`
- Hosted remote for connectors: `https://nf-mcp.vercel.app/mcp` (streamable-http / simple JSON-RPC)

To list as a **connector** on https://glama.ai/mcp/connectors: **Add MCP Server → Connector** with URL `https://nf-mcp.vercel.app/mcp` (no credentials required for free-core tools). Claim with the well-known file above (maintainer email on the Glama account).

## Brand

Northern Forge Labs — free cores, fair one-time unlocks, dual human + agent surfaces.

- X: [@NForge26](https://x.com/NForge26)
- Catalog: [Menoxcide/northern-forge-products](https://github.com/Menoxcide/northern-forge-products)

<!-- mcp-name: io.github.Menoxcide/nf-mcp -->
