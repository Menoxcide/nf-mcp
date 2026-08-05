/**
 * REST mirror for agents that prefer HTTP over JSON-RPC.
 * GET  /api/tools           → list tools
 * POST /api/tools           → { name, arguments }
 * GET  /api/tools?name=x    → describe one tool
 */
const { toolDefs, callTool, TOOL_META } = require('../lib/tools');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method === 'GET') {
    const name = req.query?.name;
    if (name) {
      const meta = TOOL_META[name];
      if (!meta) {
        res.status(404).json({ ok: false, error: 'unknown_tool', name });
        return;
      }
      res.status(200).json({
        ok: true,
        name,
        description: meta.description,
        inputSchema: meta.inputSchema,
        free: meta.free,
      });
      return;
    }
    res.status(200).json({
      ok: true,
      server: 'northern-forge-mcp',
      tools: toolDefs(),
      mcp: '/mcp',
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
      res.status(400).json({ ok: false, error: 'invalid_json' });
      return;
    }
  }
  const name = body?.name || body?.tool;
  const args = body?.arguments || body?.args || body?.input || {};
  if (!name) {
    res.status(400).json({ ok: false, error: 'name_required' });
    return;
  }
  const result = await callTool(name, args);
  res.status(result && result.ok === false ? 400 : 200).json(result);
};
