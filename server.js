#!/usr/bin/env node
/**
 * Northern Forge MCP — stdio transport (Claude Desktop, Glama, mcp-proxy).
 *
 * Glama runs: mcp-proxy -- node|tsx server.js
 * Speaks MCP JSON-RPC over stdin/stdout with Content-Length framing.
 * Tool implementations live in lib/tools.js (same as hosted HTTP).
 */
'use strict';

const { toolDefs, callTool } = require('./lib/tools');

// Never write logs to stdout — that corrupts the MCP stream.
const log = (...args) => {
  try {
    process.stderr.write(args.map(String).join(' ') + '\n');
  } catch {
    /* ignore */
  }
};

function send(msg) {
  const body = JSON.stringify(msg);
  const frame = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
  process.stdout.write(frame);
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function jsonRpcError(id, code, message, data) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

async function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') {
    return jsonRpcError(null, -32600, 'Invalid Request');
  }

  // Notifications have no id — no response
  const isNotification = !Object.prototype.hasOwnProperty.call(msg, 'id');
  const { id, method, params } = msg;

  if (!method) {
    if (isNotification) return null;
    return jsonRpcError(id, -32600, 'Missing method');
  }

  try {
    switch (method) {
      case 'initialize':
        return jsonRpcResult(id, {
          protocolVersion:
            (params && params.protocolVersion) || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: {
            name: 'northern-forge-mcp',
            version: '1.0.0',
            description:
              'Northern Forge free-core agent tools: diff, cron, units, JSON→TS, golden hour, pack weight, prompts',
          },
        });

      case 'notifications/initialized':
      case 'initialized':
      case 'notifications/cancelled':
        return null;

      case 'ping':
        return jsonRpcResult(id, {});

      case 'tools/list': {
        // Public tools only for registry introspection (no local-only ops)
        const tools = toolDefs({ includeLocal: false }).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema || {
            type: 'object',
            properties: {},
          },
        }));
        return jsonRpcResult(id, { tools });
      }

      case 'tools/call': {
        const name = params && params.name;
        const args =
          (params && (params.arguments || params.args)) || {};
        if (!name) {
          return jsonRpcError(id, -32602, 'tools/call requires params.name');
        }
        const result = await callTool(name, args);
        const text = JSON.stringify(result, null, 2);
        return jsonRpcResult(id, {
          content: [{ type: 'text', text }],
          structuredContent: result,
          isError: !!(result && result.ok === false),
        });
      }

      case 'resources/list':
        return jsonRpcResult(id, { resources: [] });

      case 'prompts/list':
        return jsonRpcResult(id, { prompts: [] });

      default:
        if (isNotification) return null;
        return jsonRpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    log('handler error', e && e.stack ? e.stack : e);
    if (isNotification) return null;
    return jsonRpcError(id, -32603, String((e && e.message) || e));
  }
}

// --- Content-Length framed stdin reader (MCP / LSP style) ---
let buf = Buffer.alloc(0);

function tryConsume() {
  while (true) {
    const headerEnd = buf.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;

    const header = buf.slice(0, headerEnd).toString('utf8');
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      // Drop garbage line and keep scanning
      const nl = buf.indexOf('\n');
      buf = nl === -1 ? Buffer.alloc(0) : buf.slice(nl + 1);
      continue;
    }

    const len = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    if (buf.length < bodyStart + len) return;

    const body = buf.slice(bodyStart, bodyStart + len).toString('utf8');
    buf = buf.slice(bodyStart + len);

    let msg;
    try {
      msg = JSON.parse(body);
    } catch (e) {
      send(jsonRpcError(null, -32700, 'Parse error'));
      continue;
    }

    // Fire async; order is preserved per request by awaiting in sequence
    queue.push(msg);
    drain();
  }
}

const queue = [];
let draining = false;

async function drain() {
  if (draining) return;
  draining = true;
  while (queue.length) {
    const msg = queue.shift();
    try {
      const out = await handleMessage(msg);
      if (out != null) send(out);
    } catch (e) {
      log('drain error', e);
      if (msg && Object.prototype.hasOwnProperty.call(msg, 'id')) {
        send(jsonRpcError(msg.id, -32603, String((e && e.message) || e)));
      }
    }
  }
  draining = false;
}

process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  tryConsume();
});

process.stdin.on('end', () => {
  process.exit(0);
});

process.stdin.on('error', (e) => {
  log('stdin error', e);
  process.exit(1);
});

// Stay alive; mcp-proxy will talk over stdio
process.stdin.resume();
log('northern-forge-mcp stdio ready');
