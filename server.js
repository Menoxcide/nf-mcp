#!/usr/bin/env node
/**
 * Northern Forge MCP — stdio transport (Claude Desktop, Glama, mcp-proxy).
 *
 * Framing: MCP stdio is **newline-delimited JSON-RPC** (one message per line).
 * Content-Length (LSP-style) is also accepted for older clients.
 * Never write logs to stdout — that corrupts the MCP stream.
 *
 * Glama runs: mcp-proxy -- node server.js
 * Tool implementations: lib/tools.js (same as hosted HTTP).
 */
'use strict';

const { toolDefs, callTool } = require('./lib/tools');

const log = (...args) => {
  try {
    process.stderr.write(args.map(String).join(' ') + '\n');
  } catch {
    /* ignore */
  }
};

function send(msg) {
  // NDJSON: one JSON-RPC message per line (MCP stdio transport)
  process.stdout.write(JSON.stringify(msg) + '\n');
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
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: {
            name: 'northern-forge-mcp',
            version: '1.0.1',
          },
        });

      case 'notifications/initialized':
      case 'initialized':
      case 'notifications/cancelled':
      case 'notifications/roots/list_changed':
        return null;

      case 'ping':
        return jsonRpcResult(id, {});

      case 'tools/list': {
        const tools = toolDefs({ includeLocal: false }).map((t) => ({
          name: t.name,
          description: t.description || t.name,
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
          isError: !!(result && result.ok === false),
        });
      }

      case 'resources/list':
        return jsonRpcResult(id, { resources: [] });

      case 'resources/templates/list':
        return jsonRpcResult(id, { resourceTemplates: [] });

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

// --- stdin: NDJSON primary, Content-Length fallback ---
let buf = Buffer.alloc(0);
const queue = [];
let draining = false;

function enqueue(msg) {
  queue.push(msg);
  drain();
}

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

function parseJsonBody(body) {
  try {
    return JSON.parse(body);
  } catch {
    send(jsonRpcError(null, -32700, 'Parse error'));
    return null;
  }
}

function tryConsume() {
  while (buf.length) {
    // Prefer Content-Length if present at start of buffer
    const asText = buf.toString('utf8');
    if (/^Content-Length:\s*\d+/i.test(asText)) {
      const headerEnd = buf.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        // Incomplete headers; wait for more data
        if (buf.indexOf('\n\n') === -1) return;
        // Tolerate LF-only headers
        const altEnd = buf.indexOf('\n\n');
        if (altEnd === -1) return;
        const header = buf.slice(0, altEnd).toString('utf8');
        const match = /Content-Length:\s*(\d+)/i.exec(header);
        if (!match) {
          buf = buf.slice(altEnd + 2);
          continue;
        }
        const len = parseInt(match[1], 10);
        const bodyStart = altEnd + 2;
        if (buf.length < bodyStart + len) return;
        const body = buf.slice(bodyStart, bodyStart + len).toString('utf8');
        buf = buf.slice(bodyStart + len);
        const msg = parseJsonBody(body);
        if (msg) enqueue(msg);
        continue;
      }
      const header = buf.slice(0, headerEnd).toString('utf8');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        buf = buf.slice(headerEnd + 4);
        continue;
      }
      const len = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (buf.length < bodyStart + len) return;
      const body = buf.slice(bodyStart, bodyStart + len).toString('utf8');
      buf = buf.slice(bodyStart + len);
      const msg = parseJsonBody(body);
      if (msg) enqueue(msg);
      continue;
    }

    // NDJSON: one complete line = one message
    const nl = buf.indexOf('\n');
    if (nl === -1) return;

    let line = buf.slice(0, nl).toString('utf8');
    buf = buf.slice(nl + 1);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    line = line.trim();
    if (!line) continue;

    const msg = parseJsonBody(line);
    if (msg) enqueue(msg);
  }
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

// Keep process alive for long-lived stdio sessions
process.stdin.resume();
if (typeof process.stdin.unref !== 'function') {
  /* ignore */
}

log('northern-forge-mcp stdio ready');
