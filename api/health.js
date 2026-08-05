/**
 * GET /api/health (rewritten as /health)
 * Lightweight liveness for uptime monitors and agents.
 */
const { toolDefs } = require('../lib/tools');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }
  const tools = toolDefs({ includeLocal: false });
  res.status(200).json({
    ok: true,
    service: 'northern-forge-mcp',
    status: 'live',
    public_tools: tools.length,
    mcp: 'https://nf-mcp.vercel.app/mcp',
    rest: 'https://nf-mcp.vercel.app/tools',
    console: 'https://northern-forge-labs.vercel.app/agents/console?id=northern-forge-mcp',
    at: new Date().toISOString(),
  });
};
