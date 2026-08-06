/**
 * Standalone HTTP server for Docker / Glama introspection.
 * MCP JSON-RPC: POST /mcp  |  REST: GET/POST /tools  |  health: GET /health
 */
const http = require('http');
const { toolDefs, callTool } = require('./lib/tools');

const PORT = Number(process.env.PORT || 8080);

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Mcp-Session-Id',
    ...headers,
  });
  res.end(data);
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}
function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

async function handleMcp(msg) {
  if (!msg || typeof msg !== 'object') return jsonRpcError(null, -32600, 'Invalid Request');
  const { id, method, params } = msg;
  if (!method) return jsonRpcError(id, -32600, 'Missing method');
  switch (method) {
    case 'initialize':
      return jsonRpcResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'northern-forge-mcp',
          version: '1.0.0',
          description: 'Northern Forge free-core agent tools',
        },
      });
    case 'notifications/initialized':
    case 'initialized':
      return null;
    case 'ping':
      return jsonRpcResult(id, {});
    case 'tools/list':
      return jsonRpcResult(id, { tools: toolDefs() });
    case 'tools/call': {
      const name = params?.name;
      const args = params?.arguments || params?.args || {};
      if (!name) return jsonRpcError(id, -32602, 'tools/call requires params.name');
      const result = await callTool(name, args);
      return jsonRpcResult(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
        isError: result && result.ok === false,
      });
    }
    case 'resources/list':
      return jsonRpcResult(id, { resources: [] });
    case 'prompts/list':
      return jsonRpcResult(id, { prompts: [] });
    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Mcp-Session-Id',
    });
    return res.end();
  }

  if (url.pathname === '/health' && req.method === 'GET') {
    return send(res, 200, {
      ok: true,
      service: 'northern-forge-mcp',
      status: 'live',
      public_tools: toolDefs().length,
    });
  }

  if ((url.pathname === '/tools' || url.pathname === '/api/tools') && req.method === 'GET') {
    return send(res, 200, { ok: true, tools: toolDefs() });
  }

  if ((url.pathname === '/mcp' || url.pathname === '/api/mcp' || url.pathname === '/') && req.method === 'GET') {
    return send(res, 200, {
      name: 'northern-forge-mcp',
      mcp: '/mcp',
      tools: '/tools',
      health: '/health',
    });
  }

  if (req.method === 'POST' && (url.pathname === '/mcp' || url.pathname === '/api/mcp' || url.pathname === '/tools' || url.pathname === '/api/tools')) {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return send(res, 400, jsonRpcError(null, -32700, 'Parse error'));
    }

    // REST tools call
    if (url.pathname.includes('tools') && body.name) {
      const result = await callTool(body.name, body.arguments || body.args || {});
      return send(res, 200, result);
    }

    const out = await handleMcp(body);
    if (out === null) return send(res, 204, '');
    return send(res, 200, out);
  }

  send(res, 404, { ok: false, error: 'not_found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`northern-forge-mcp listening on :${PORT}`);
});
