/**
 * MCP JSON-RPC over HTTP (tools/list, tools/call, initialize, ping).
 * Endpoint: POST /api/mcp  (also rewritten as /mcp)
 *
 * Compatible with agents that speak simple MCP-over-HTTP without SSE.
 * Also accepts GET for a discovery document.
 */
const { toolDefs, callTool } = require('../lib/tools');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Accept, Mcp-Session-Id'
  );
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
  const { id, method, params } = msg;
  if (!method) return jsonRpcError(id, -32600, 'Missing method');

  try {
    switch (method) {
      case 'initialize':
        return jsonRpcResult(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: {
            name: 'northern-forge-mcp',
            version: '1.0.0',
            description:
              'Northern Forge agent tools: catalog, popular, events, golden hour, pack weight, prompts',
          },
        });
      case 'notifications/initialized':
      case 'initialized':
        // notification — no body required
        return null;
      case 'ping':
        return jsonRpcResult(id, {});
      case 'tools/list':
        return jsonRpcResult(id, { tools: toolDefs() });
      case 'tools/call': {
        const name = params?.name;
        const args = params?.arguments || params?.args || {};
        if (!name) {
          return jsonRpcError(id, -32602, 'tools/call requires params.name');
        }
        const result = await callTool(name, args);
        const text = JSON.stringify(result, null, 2);
        return jsonRpcResult(id, {
          content: [{ type: 'text', text }],
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
  } catch (e) {
    return jsonRpcError(id, -32000, String(e.message || e));
  }
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method === 'GET') {
    res.status(200).json({
      ok: true,
      name: 'northern-forge-mcp',
      version: '1.0.0',
      transport: 'http-jsonrpc',
      endpoints: {
        mcp: '/mcp',
        rest_tools: '/tools',
      },
      protocolVersion: '2024-11-05',
      tools: toolDefs().map((t) => t.name),
      usage: {
        initialize: {
          method: 'POST',
          body: {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {},
          },
        },
        list: {
          method: 'POST',
          body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
        },
        call: {
          method: 'POST',
          body: {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: {
              name: 'list_live_products',
              arguments: { limit: 5 },
            },
          },
        },
      },
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json(jsonRpcError(null, -32700, 'Parse error'));
      return;
    }
  }

  // batch
  if (Array.isArray(body)) {
    const out = [];
    for (const m of body) {
      const r = await handleMessage(m);
      if (r !== null) out.push(r);
    }
    res.status(200).json(out);
    return;
  }

  const result = await handleMessage(body);
  if (result === null) {
    res.status(204).end();
    return;
  }
  res.status(200).json(result);
};
