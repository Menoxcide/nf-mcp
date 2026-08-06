/**
 * GET /api/well-known-glama (rewritten as /.well-known/glama.json)
 * Glama connector ownership claim — email must match Glama account.
 */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }
  res.status(200).json({
    $schema: 'https://glama.ai/mcp/schemas/connector.json',
    maintainers: [{ email: 'justin@justindkamen.com' }],
  });
};
