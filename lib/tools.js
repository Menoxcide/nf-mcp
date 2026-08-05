/**
 * Northern Forge first-party tool implementations for MCP + REST.
 * Zero npm deps — pure Node on Vercel serverless.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const CATALOG = require('./catalog.json');

const HUB = 'https://northern-forge-labs.vercel.app';
const CONVERSION = 'https://nf-conversion.vercel.app';

// Local ADP checkout root (three levels up from lib/). Only present when this
// server runs on the operator's own host (local dev / mesh box) — on public
// Vercel prod the bundle doesn't include it, so reads/writes degrade to
// `{ ok:true, available:false }` instead of throwing.
const ADP_ROOT = path.join(__dirname, '..', '..', '..');
const ACTION_QUEUE_REL = path.join('data', 'action_queue.jsonl');
const ACTION_QUEUE_PRIMARY = path.join(ADP_ROOT, ACTION_QUEUE_REL);
const ACTION_QUEUE_FALLBACK = path.join('/tmp', 'nf_action_queue.jsonl');
const HOST_MEMORY_REL = path.join('data', 'host_memory.json');
const HOST_MEMORY_PRIMARY = path.join(ADP_ROOT, HOST_MEMORY_REL);
const HOST_MEMORY_FALLBACK = path.join('/tmp', 'nf_host_memory.json');

function readJsonSafe(relPath) {
  try {
    const raw = fs.readFileSync(path.join(ADP_ROOT, relPath), 'utf8');
    return { ok: true, data: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: String(e.code || e.message || e) };
  }
}

function readJsonlTail(relPath, n) {
  try {
    const raw = fs.readFileSync(path.join(ADP_ROOT, relPath), 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    return lines.slice(-n).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { raw: l.slice(0, 300) };
      }
    });
  } catch {
    return [];
  }
}

/** @type {Record<string, { description: string, inputSchema: object, free: boolean }>} */
const TOOL_META = {
  list_live_products: {
    description:
      'List Northern Forge live products (title, url, blurb, monetization). Free core tool for agents.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          description: 'Optional filter: web_tool | mcp_server | agent_skill',
        },
        limit: { type: 'number', description: 'Max products (default 50)' },
      },
    },
    free: true,
  },
  get_product: {
    description: 'Get one product by product_id or slug.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'product_id or slug' },
      },
      required: ['id'],
    },
    free: true,
  },
  popular_tools: {
    description:
      'Hot/popular product ranks from conversion analytics (when available). Falls back to catalog seeds.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Default 12' },
      },
    },
    free: true,
  },
  post_event: {
    description:
      'Record an analytics event (product_view, product_open, card_click, agent_tool_call).',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        product_id: { type: 'string' },
        source: { type: 'string' },
        meta: { type: 'object' },
      },
      required: ['type', 'product_id'],
    },
    free: true,
  },
  get_payment_link: {
    description:
      'Return known Stripe payment link URL for a product if configured (pro unlock).',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'string' },
      },
      required: ['product_id'],
    },
    free: true,
  },
  forge_status: {
    description:
      'Public forge status: hub URL, MCP endpoint, conversion API, product count, manifesto surfaces.',
    inputSchema: { type: 'object', properties: {} },
    free: true,
  },
  list_mcp_tools: {
    description: 'List this server tools with schemas (self-describe).',
    inputSchema: { type: 'object', properties: {} },
    free: true,
  },
  golden_hour_windows: {
    description:
      'Compute approximate sunrise/sunset/golden-hour windows for lat/lon/date (no API key). MVP solar math.',
    inputSchema: {
      type: 'object',
      properties: {
        lat: { type: 'number', description: 'Latitude' },
        lon: { type: 'number', description: 'Longitude' },
        date: {
          type: 'string',
          description: 'ISO date YYYY-MM-DD (default today UTC)',
        },
      },
      required: ['lat', 'lon'],
    },
    free: true,
  },
  pack_weight_sum: {
    description:
      'Sum gear pack items in grams. items: [{name, grams, qty?}]. Returns total g and lb.',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              grams: { type: 'number' },
              qty: { type: 'number' },
            },
            required: ['grams'],
          },
        },
      },
      required: ['items'],
    },
    free: true,
  },
  prompt_variants: {
    description:
      'Split a goal+notes blob into Claude / GPT / Grok oriented prompt variants (local, no LLM call).',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['goal'],
    },
    free: true,
  },
  diff_text: {
    description:
      'Line-by-line diff of two text blobs. Returns unified-style +/- lines and add/remove/unchanged counts.',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'string', description: 'Original text' },
        b: { type: 'string', description: 'Modified text' },
      },
      required: ['a', 'b'],
    },
    free: true,
  },
  cron_explain: {
    description:
      'Explain a 5-field cron expression (minute hour day-of-month month day-of-week) in plain English.',
    inputSchema: {
      type: 'object',
      properties: {
        expr: { type: 'string', description: 'Cron expression, e.g. "0 9 * * 1-5"' },
      },
      required: ['expr'],
    },
    free: true,
  },
  unit_convert: {
    description:
      'Convert a numeric value between units: length, mass, volume, time, data size, and temperature.',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'number', description: 'Numeric value to convert' },
        from: { type: 'string', description: 'Source unit, e.g. "km", "lb", "celsius"' },
        to: { type: 'string', description: 'Target unit, e.g. "mi", "kg", "fahrenheit"' },
      },
      required: ['value', 'from', 'to'],
    },
    free: true,
  },
  slug_case: {
    description:
      'Convert text into slug/kebab, snake_case, camelCase, PascalCase, CONSTANT_CASE, and Title Case variants.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to convert' },
      },
      required: ['text'],
    },
    free: true,
  },
  reading_time: {
    description:
      'Estimate reading time for a blob of text (word/char counts, minutes and mm:ss at a given or default WPM).',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to measure' },
        wpm: { type: 'number', description: 'Words per minute (default 200)' },
      },
      required: ['text'],
    },
    free: true,
  },
  json_to_ts: {
    description:
      'Infer TypeScript interfaces from a JSON string (or object). Local, no LLM. Caps depth/size for agent safety.',
    inputSchema: {
      type: 'object',
      properties: {
        json: {
          type: 'string',
          description: 'JSON text to convert (preferred)',
        },
        root_name: {
          type: 'string',
          description: 'Root interface name (default Root)',
        },
      },
      required: ['json'],
    },
    free: true,
  },
  base64_codec: {
    description: 'Encode text to base64 or decode base64 to UTF-8 text.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          description: 'encode | decode (default encode)',
        },
        text: { type: 'string', description: 'Plain text (encode mode)' },
        data: { type: 'string', description: 'Base64 string (decode mode)' },
      },
    },
    free: true,
  },
  uuid_batch: {
    description: 'Generate one or more UUID v4 strings (local crypto.randomUUID / fallback).',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'How many (default 1, max 50)' },
      },
    },
    free: true,
  },
  csv_to_markdown: {
    description:
      'Convert CSV text (comma-separated, optional quoted fields) into a GitHub-flavored markdown table.',
    inputSchema: {
      type: 'object',
      properties: {
        csv: { type: 'string', description: 'CSV text including header row' },
        delimiter: {
          type: 'string',
          description: 'Field delimiter (default ",")',
        },
      },
      required: ['csv'],
    },
    free: true,
  },
  extract_urls: {
    description: 'Extract unique http(s) URLs from free text.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
      },
      required: ['text'],
    },
    free: true,
  },
  wcag_contrast: {
    description:
      'WCAG relative luminance contrast ratio between two hex colors (#RGB or #RRGGBB). Reports AA/AAA pass for normal and large text.',
    inputSchema: {
      type: 'object',
      properties: {
        fg: { type: 'string', description: 'Foreground hex color' },
        bg: { type: 'string', description: 'Background hex color' },
      },
      required: ['fg', 'bg'],
    },
    free: true,
  },
  hash_text: {
    description:
      'Hash a string with sha256 / sha1 / md5 (hex). Local crypto — no network.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        algo: {
          type: 'string',
          description: 'sha256 | sha1 | md5 (default sha256)',
        },
      },
      required: ['text'],
    },
    free: true,
  },
  html_escape: {
    description: 'Escape or unescape HTML entities (& < > " \').',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        mode: {
          type: 'string',
          description: 'escape | unescape (default escape)',
        },
      },
      required: ['text'],
    },
    free: true,
  },
  percent_change: {
    description: 'Percent change from old → new value (and absolute delta).',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'number', description: 'Starting value' },
        to: { type: 'number', description: 'Ending value' },
      },
      required: ['from', 'to'],
    },
    free: true,
  },
  word_freq: {
    description:
      'Top word frequencies in text (case-insensitive, simple tokenizer).',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        limit: { type: 'number', description: 'Top N words (default 20)' },
      },
      required: ['text'],
    },
    free: true,
  },
  regex_test: {
    description:
      'Test a JS-style regex against text. Returns match count and up to 20 match slices.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern (no /slashes/)' },
        text: { type: 'string' },
        flags: {
          type: 'string',
          description: 'Flags e.g. gi (default g)',
        },
      },
      required: ['pattern', 'text'],
    },
    free: true,
  },
  jwt_decode: {
    description:
      'Decode JWT header + payload (no signature verify). For inspection only.',
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'JWT string' },
      },
      required: ['token'],
    },
    free: true,
  },
  now_iso: {
    description:
      'Current time as ISO-8601 UTC, unix seconds, and optional IANA timezone label (offset only — no full tz DB).',
    inputSchema: {
      type: 'object',
      properties: {
        offset_minutes: {
          type: 'number',
          description: 'Local offset from UTC in minutes (e.g. -240 for EDT)',
        },
      },
    },
    free: true,
  },
  lorem_ipsum: {
    description: 'Generate placeholder lorem paragraphs/sentences (offline).',
    inputSchema: {
      type: 'object',
      properties: {
        paragraphs: { type: 'number', description: '1–6 (default 1)' },
        sentences: {
          type: 'number',
          description: 'Sentences per paragraph 2–8 (default 4)',
        },
      },
    },
    free: true,
  },
  install_config: {
    description:
      'Return ready-to-paste MCP install snippets for Cursor, Claude Desktop, and generic HTTP clients.',
    inputSchema: {
      type: 'object',
      properties: {
        client: {
          type: 'string',
          description: 'cursor | claude | generic (default all)',
        },
      },
    },
    free: true,
  },
  forge_loop_status: {
    description:
      '[Local ops] Read-only always_on/loop_health snapshot for the operator’s ADP host (returns available:false on public Vercel). Not a portable product tool.',
    inputSchema: { type: 'object', properties: {} },
    free: true,
    localOnly: true,
  },
  list_mesh_snapshot: {
    description:
      '[Local ops] Read-only mesh snapshot from operator command-center cache (available:false off-host).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max nodes to return (default all)' },
      },
    },
    free: true,
    localOnly: true,
  },
  queue_action: {
    description:
      '[Local ops] Append a proposed action to a local review queue — does NOT execute. Operator host only.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Plain-English action to queue for review' },
        target: { type: 'string', description: 'Optional target host/node' },
        source: { type: 'string', description: 'Optional caller/agent id (default "agent")' },
        meta: { type: 'object', description: 'Optional small structured extra context' },
      },
      required: ['action'],
    },
    free: true,
    localOnly: true,
  },
  list_queued_actions: {
    description: '[Local ops] List actions previously appended by queue_action.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Optional filter, e.g. "queued"' },
        limit: { type: 'number', description: 'Max rows (default 20, max 200)' },
      },
    },
    free: true,
    localOnly: true,
  },
  host_memory_set: {
    description:
      '[Local ops] Save a small per-host note. Local file write only; available:false off operator host.',
    inputSchema: {
      type: 'object',
      properties: {
        host_id: { type: 'string' },
        key: { type: 'string' },
        value: { type: 'string', description: 'Note text (max 2000 chars)' },
      },
      required: ['host_id', 'key', 'value'],
    },
    free: true,
    localOnly: true,
  },
  host_memory_get: {
    description:
      '[Local ops] Read per-host notes from host_memory_set. Operator host only.',
    inputSchema: {
      type: 'object',
      properties: {
        host_id: { type: 'string' },
        key: { type: 'string' },
      },
      required: ['host_id'],
    },
    free: true,
    localOnly: true,
  },
  run_safe_cmd: {
    description:
      '[Local ops] Run one allowlisted read-only status command (uptime, disk, mem, loop board). No arbitrary shell. Public Vercel returns available:false.',
    inputSchema: {
      type: 'object',
      properties: {
        command_id: {
          type: 'string',
          description:
            'uptime | disk_usage | mem_usage | always_on_status | loop_board. Omit to list options.',
        },
      },
    },
    free: true,
    localOnly: true,
  },
  gbrain_search: {
    description:
      '[Local ops] Search ADP gbrain notes (Justin cache + local NF entities). No secrets. available:false off operator host.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords (e.g. frigate mcp cash)' },
        limit: { type: 'number', description: 'Max notes (default 6)' },
      },
    },
    free: true,
    localOnly: true,
  },
  gbrain_get: {
    description:
      '[Local ops] Get one gbrain note by name (e.g. northern-forge.md). Operator host only.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Note filename, e.g. nf-mcp-flagship.md' },
      },
      required: ['name'],
    },
    free: true,
    localOnly: true,
  },
  gbrain_list: {
    description:
      '[Local ops] List cached gbrain note names + utility metrics. Operator host only.',
    inputSchema: { type: 'object', properties: {} },
    free: true,
    localOnly: true,
  },
};

// Fixed allowlist for run_safe_cmd: exact binary + argv, no shell, no user-supplied
// arguments ever reach the child process. Read-only / status commands only.
const SAFE_COMMANDS = {
  uptime: { cmd: 'uptime', args: [], cwd: null, description: 'System uptime and load average' },
  disk_usage: { cmd: 'df', args: ['-h'], cwd: null, description: 'Disk usage by mount' },
  mem_usage: { cmd: 'free', args: ['-h'], cwd: null, description: 'Memory usage' },
  always_on_status: {
    cmd: 'python3',
    args: ['agentic_loop.py', 'status'],
    cwd: ADP_ROOT,
    description: 'Northern Forge always_on / loop health snapshot (agentic_loop.py status)',
  },
  loop_board: {
    cmd: 'python3',
    args: ['agentic_loop.py', 'board'],
    cwd: ADP_ROOT,
    description: 'Open + recent work packages (agentic_loop.py board)',
  },
};

// Known payment links (public buy.stripe.com)
const PAYMENT_LINKS = {
  'mi-golden-hour': 'https://buy.stripe.com/28E00leB3chI2J0gov4c800',
  'mi-golden-hour-planner': 'https://buy.stripe.com/28E00leB3chI2J0gov4c800',
  'mi-trailhead-snow': 'https://buy.stripe.com/9B6fZj0KdepQdnEa074c801',
  'mi-trailhead-snow-depth-visualizer':
    'https://buy.stripe.com/9B6fZj0KdepQdnEa074c801',
};

/** Ready-to-run example arguments for each tool (agents + Forge Bridge). */
const TOOL_EXAMPLES = {
  list_live_products: { limit: 5, kind: 'web_tool' },
  get_product: { id: 'mi-golden-hour' },
  popular_tools: { limit: 8 },
  post_event: {
    type: 'product_view',
    product_id: 'northern-forge-mcp',
    source: 'example',
  },
  get_payment_link: { product_id: 'mi-golden-hour' },
  forge_status: {},
  list_mcp_tools: { public_only: true },
  golden_hour_windows: { lat: 46.545, lon: -87.395, date: '2026-07-29' },
  pack_weight_sum: {
    items: [
      { name: 'tent', grams: 1200, qty: 1 },
      { name: 'stove', grams: 340, qty: 1 },
      { name: 'water', grams: 1000, qty: 2 },
    ],
  },
  prompt_variants: {
    goal: 'Write a launch note for a free JSON→TS tool',
    notes: 'Indie makers · local-first · no account required',
  },
  diff_text: { a: 'hello\nworld\nline three', b: 'hello\nforge\nline three' },
  cron_explain: { expr: '0 9 * * 1-5' },
  unit_convert: { value: 5, from: 'km', to: 'mi' },
  slug_case: { text: 'Northern Forge MCP Server' },
  reading_time: {
    text: 'Agents call tools over HTTP. Free cores, clear schemas, no fluff. Ship the smallest working version first and measure what people open.',
    wpm: 200,
  },
  json_to_ts: {
    json: '{"id":1,"name":"forge","tags":["mcp","tools"],"meta":{"free":true}}',
    root_name: 'Product',
  },
  base64_codec: { mode: 'encode', text: 'northern forge' },
  uuid_batch: { count: 3 },
  csv_to_markdown: { csv: 'name,qty,notes\nanvil,2,steel\nhammer,1,claw' },
  extract_urls: {
    text: 'See https://nf-mcp.vercel.app and https://northern-forge-labs.vercel.app/agents for install docs.',
  },
  wcag_contrast: { fg: '#e8f1ff', bg: '#070b14' },
  hash_text: { text: 'northern forge', algo: 'sha256' },
  html_escape: { text: '<b>Forge</b> & co', mode: 'escape' },
  percent_change: { from: 100, to: 125 },
  word_freq: {
    text: 'Ship free cores. Measure opens. Ship free cores again.',
    limit: 10,
  },
  regex_test: { pattern: '\\b[A-Z][a-z]+\\b', text: 'Hello Northern Forge', flags: 'g' },
  jwt_decode: {
    token:
      'eyJhbGciOiJub25lIn0.eyJzdWIiOiJtYWtlciIsInJvbGUiOiJmcmVlIiwiaWF0IjoxNzAwMDAwMDAwfQ.',
  },
  now_iso: { offset_minutes: -240 },
  lorem_ipsum: { paragraphs: 1, sentences: 3 },
  install_config: { client: 'cursor' },
  forge_loop_status: {},
  list_mesh_snapshot: { limit: 10 },
  queue_action: {
    action: 'review popular tools strip on hub',
    target: 'local',
    source: 'example',
  },
  list_queued_actions: { limit: 10, status: 'queued' },
  host_memory_set: {
    host_id: 'LOCAL',
    key: 'deploy_note',
    value: 'vercel --prod from artifacts/nf-mcp',
  },
  host_memory_get: { host_id: 'LOCAL' },
  run_safe_cmd: { command_id: 'uptime' },
  gbrain_search: { query: 'mcp frigate', limit: 4 },
  gbrain_get: { name: 'northern-forge.md' },
  gbrain_list: {},
};

/** Alternate examples so ✨ / Example can rotate. */
const TOOL_EXAMPLE_VARIANTS = {
  unit_convert: [
    { value: 5, from: 'km', to: 'mi' },
    { value: 72, from: 'f', to: 'c' },
    { value: 1.5, from: 'lb', to: 'kg' },
    { value: 2048, from: 'mb', to: 'gb' },
  ],
  cron_explain: [
    { expr: '0 9 * * 1-5' },
    { expr: '*/15 * * * *' },
    { expr: '0 0 1 * *' },
    { expr: '30 18 * * 0' },
  ],
  json_to_ts: [
    {
      json: '{"id":1,"name":"forge","tags":["mcp"]}',
      root_name: 'Product',
    },
    {
      json: '[{"sku":"A1","price":9.99},{"sku":"B2","price":4.5}]',
      root_name: 'LineItem',
    },
  ],
  diff_text: [
    { a: 'hello\nworld', b: 'hello\nforge' },
    { a: 'const x = 1;', b: 'const x = 2;\nconst y = 3;' },
  ],
  golden_hour_windows: [
    { lat: 46.545, lon: -87.395, date: '2026-07-29' },
    { lat: 42.33, lon: -83.05, date: '2026-12-21' },
  ],
  prompt_variants: [
    {
      goal: 'Write a launch note for a free JSON→TS tool',
      notes: 'Indie makers · local-first',
    },
    {
      goal: 'Plan a UP day hike with golden hour photos',
      notes: 'Porcupine Mountains · late July',
    },
  ],
  base64_codec: [
    { mode: 'encode', text: 'northern forge' },
    { mode: 'decode', data: 'bm9ydGhlcm4gZm9yZ2U=' },
  ],
  wcag_contrast: [
    { fg: '#e8f1ff', bg: '#070b14' },
    { fg: '#f6b73c', bg: '#121a2e' },
    { fg: '#5ef0c0', bg: '#0a1220' },
  ],
  slug_case: [
    { text: 'Northern Forge MCP Server' },
    { text: 'JSON to TypeScript interfaces' },
  ],
  csv_to_markdown: [
    { csv: 'name,qty\nanvil,2\nhammer,1' },
    { csv: 'tool,kind\ndiff_text,builder\ngolden_hour,outdoor' },
  ],
};

function pickExample(name, rotate) {
  const variants = TOOL_EXAMPLE_VARIANTS[name];
  if (variants && variants.length) {
    const i =
      rotate != null
        ? Math.abs(Number(rotate)) % variants.length
        : Math.floor(Math.random() * variants.length);
    return JSON.parse(JSON.stringify(variants[i]));
  }
  if (TOOL_EXAMPLES[name] != null) {
    return JSON.parse(JSON.stringify(TOOL_EXAMPLES[name]));
  }
  return {};
}

function exampleFromSchema(meta) {
  const props = (meta && meta.inputSchema && meta.inputSchema.properties) || {};
  const sample = {};
  for (const [k, def] of Object.entries(props)) {
    if (!def || typeof def !== 'object') continue;
    if (def.default !== undefined) {
      sample[k] = def.default;
      continue;
    }
    if (Array.isArray(def.examples) && def.examples.length) {
      sample[k] = def.examples[0];
      continue;
    }
    if (def.example !== undefined) {
      sample[k] = def.example;
      continue;
    }
    const t = def.type || 'string';
    if (t === 'number' || t === 'integer') sample[k] = 1;
    else if (t === 'boolean') sample[k] = true;
    else if (t === 'array') sample[k] = [];
    else if (t === 'object') sample[k] = {};
    else sample[k] = def.description ? String(def.description).slice(0, 48) : 'example';
  }
  return sample;
}

function toolDefs(opts = {}) {
  const includeLocal = opts.includeLocal !== false; // default list all; set false for public-only
  return Object.entries(TOOL_META)
    .filter(([, meta]) => includeLocal || !meta.localOnly)
    .map(([name, meta]) => {
      const example =
        TOOL_EXAMPLES[name] != null
          ? JSON.parse(JSON.stringify(TOOL_EXAMPLES[name]))
          : exampleFromSchema(meta);
      return {
        name,
        description: meta.description,
        inputSchema: meta.inputSchema,
        free: meta.free !== false,
        localOnly: !!meta.localOnly,
        example,
        examples: TOOL_EXAMPLE_VARIANTS[name]
          ? TOOL_EXAMPLE_VARIANTS[name]
          : [example],
      };
    });
}

async function fetchJson(url, opts = {}) {
  try {
    const r = await fetch(url, {
      ...opts,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'nf-mcp/1.0',
        ...(opts.headers || {}),
      },
    });
    const text = await r.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 500) };
    }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: String(e.message || e) };
  }
}

/** Approximate solar times (NOAA-style simplified). */
function solarWindows(lat, lon, dateStr) {
  const d = dateStr ? new Date(dateStr + 'T12:00:00Z') : new Date();
  const day =
    Math.floor(
      (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
        Date.UTC(d.getUTCFullYear(), 0, 0)) /
        86400000
    ) || 1;
  const rad = Math.PI / 180;
  const decl =
    23.44 * Math.sin(rad * ((360 / 365) * (day - 81)));
  const latR = lat * rad;
  const declR = decl * rad;
  const cosH =
    (Math.sin(-0.83 * rad) - Math.sin(latR) * Math.sin(declR)) /
    (Math.cos(latR) * Math.cos(declR));
  if (cosH < -1 || cosH > 1) {
    return {
      ok: true,
      note: 'polar day/night — no standard sunrise',
      lat,
      lon,
      date: d.toISOString().slice(0, 10),
    };
  }
  const H = (Math.acos(cosH) * 180) / Math.PI; // hour angle degrees
  const solarNoonUtcMin = 720 - 4 * lon; // rough, ignore EoT
  const riseMin = solarNoonUtcMin - 4 * H;
  const setMin = solarNoonUtcMin + 4 * H;
  const fmt = (m) => {
    let x = ((m % 1440) + 1440) % 1440;
    const hh = Math.floor(x / 60);
    const mm = Math.floor(x % 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}Z`;
  };
  const goldenStart = fmt(riseMin);
  const goldenEnd = fmt(riseMin + 60);
  const eveningStart = fmt(setMin - 60);
  const eveningEnd = fmt(setMin);
  return {
    ok: true,
    lat,
    lon,
    date: d.toISOString().slice(0, 10),
    approx: true,
    sunrise_utc: fmt(riseMin),
    sunset_utc: fmt(setMin),
    morning_golden_hour_utc: `${goldenStart}–${goldenEnd}`,
    evening_golden_hour_utc: `${eveningStart}–${eveningEnd}`,
    note: 'Approximate; for production photography use the web Golden Hour Planner.',
    web: 'https://mi-golden-hour-planner.vercel.app',
  };
}

function round(n, d) {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

/** Line-based LCS diff. Caps input size to keep the O(n*m) table bounded. */
function diffText(a, b) {
  const aLines = String(a ?? '').split('\n');
  const bLines = String(b ?? '').split('\n');
  const MAX = 1000;
  if (aLines.length > MAX || bLines.length > MAX) {
    return { ok: false, error: 'input_too_large', max_lines: MAX };
  }
  const n = aLines.length;
  const m = bLines.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        aLines[i] === bLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const outLines = [];
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      outLines.push('  ' + aLines[i]);
      unchanged++;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      outLines.push('- ' + aLines[i]);
      removed++;
      i++;
    } else {
      outLines.push('+ ' + bLines[j]);
      added++;
      j++;
    }
  }
  while (i < n) {
    outLines.push('- ' + aLines[i]);
    removed++;
    i++;
  }
  while (j < m) {
    outLines.push('+ ' + bLines[j]);
    added++;
    j++;
  }
  return {
    ok: true,
    stats: { added, removed, unchanged },
    identical: added === 0 && removed === 0,
    diff: outLines.join('\n'),
  };
}

const CRON_MONTHS = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const CRON_DOWS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

function cronExplain(expr) {
  if (typeof expr !== 'string' || !expr.trim()) {
    return { ok: false, error: 'expr_required' };
  }
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return {
      ok: false,
      error: 'invalid_cron',
      detail: 'expected 5 fields: minute hour day-of-month month day-of-week',
      got_fields: fields.length,
    };
  }
  const [min, hour, dom, month, dow] = fields;
  const isNum = (s) => /^\d+$/.test(s);

  const describe = (field, names) => {
    const part = (p) => {
      let step = null;
      let base = p;
      if (p.includes('/')) [base, step] = p.split('/');
      let text;
      if (base === '*') {
        text = 'every value';
      } else if (base.includes('-')) {
        const [a, b] = base.split('-');
        const av = names ? names[Number(a)] || a : a;
        const bv = names ? names[Number(b)] || b : b;
        text = `${av}–${bv}`;
      } else {
        text = names ? names[Number(base)] || base : base;
      }
      if (step) text += ` (every ${step})`;
      return text;
    };
    return field.split(',').map(part).join(', ');
  };

  const minEveryN = min.match(/^\*\/(\d+)$/);
  const hourEveryN = hour.match(/^\*\/(\d+)$/);

  let timeClause;
  if (isNum(min) && isNum(hour)) {
    timeClause = `at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  } else if (minEveryN && hour === '*') {
    timeClause = `every ${minEveryN[1]} minutes`;
  } else if (min === '0' && hourEveryN) {
    timeClause = `every ${hourEveryN[1]} hours, on the hour`;
  } else if (min === '*' && hour === '*') {
    timeClause = 'every minute';
  } else {
    timeClause = `at minute ${describe(min)}, hour ${describe(hour)}`;
  }

  const clauses = [timeClause];
  if (dom !== '*') clauses.push(`on day-of-month ${describe(dom)}`);
  if (month !== '*') clauses.push(`in ${describe(month, CRON_MONTHS)}`);
  if (dow !== '*' && dow !== '?') clauses.push(`on ${describe(dow, CRON_DOWS)}`);

  const summary = clauses.join(', ');
  return {
    ok: true,
    expr,
    fields: { minute: min, hour, day_of_month: dom, month, day_of_week: dow },
    summary: summary.charAt(0).toUpperCase() + summary.slice(1),
  };
}

const UNIT_CATEGORY = {};
const UNIT_FACTOR = {};
function registerUnits(category, factors) {
  for (const [unit, factor] of Object.entries(factors)) {
    UNIT_CATEGORY[unit] = category;
    UNIT_FACTOR[unit] = factor;
  }
}
registerUnits('length', {
  m: 1,
  km: 1000,
  cm: 0.01,
  mm: 0.001,
  mi: 1609.344,
  yd: 0.9144,
  ft: 0.3048,
  in: 0.0254,
  nmi: 1852,
});
registerUnits('mass', {
  kg: 1,
  g: 0.001,
  mg: 0.000001,
  lb: 0.45359237,
  oz: 0.028349523125,
  tonne: 1000,
  ton: 907.18474,
});
registerUnits('volume', {
  l: 1,
  ml: 0.001,
  gal: 3.785411784,
  qt: 0.946352946,
  pt: 0.473176473,
  cup: 0.2365882365,
  floz: 0.0295735295625,
  tbsp: 0.0147867648,
  tsp: 0.00492892159,
});
registerUnits('time', {
  s: 1,
  min: 60,
  hr: 3600,
  day: 86400,
  week: 604800,
});
registerUnits('data', {
  b: 1,
  kb: 1000,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
});

const UNIT_ALIASES = {
  meter: 'm', meters: 'm', metre: 'm', metres: 'm',
  kilometer: 'km', kilometers: 'km', kilometre: 'km',
  centimeter: 'cm', centimeters: 'cm',
  millimeter: 'mm', millimeters: 'mm',
  mile: 'mi', miles: 'mi',
  yard: 'yd', yards: 'yd',
  foot: 'ft', feet: 'ft',
  inch: 'in', inches: 'in',
  'nautical mile': 'nmi', 'nautical miles': 'nmi',
  kilogram: 'kg', kilograms: 'kg', kilo: 'kg', kilos: 'kg',
  gram: 'g', grams: 'g',
  milligram: 'mg', milligrams: 'mg',
  pound: 'lb', pounds: 'lb', lbs: 'lb',
  ounce: 'oz', ounces: 'oz',
  tonnes: 'tonne', 'metric ton': 'tonne', 'metric tons': 'tonne',
  tons: 'ton', 'short ton': 'ton', 'short tons': 'ton',
  liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  milliliter: 'ml', milliliters: 'ml',
  gallon: 'gal', gallons: 'gal',
  quart: 'qt', quarts: 'qt',
  pint: 'pt', pints: 'pt',
  cups: 'cup',
  'fluid ounce': 'floz', 'fluid ounces': 'floz', 'fl oz': 'floz',
  tablespoon: 'tbsp', tablespoons: 'tbsp',
  teaspoon: 'tsp', teaspoons: 'tsp',
  second: 's', seconds: 's', sec: 's', secs: 's',
  minute: 'min', minutes: 'min', mins: 'min',
  hour: 'hr', hours: 'hr', hrs: 'hr', h: 'hr',
  days: 'day',
  weeks: 'week',
  byte: 'b', bytes: 'b',
  kilobyte: 'kb', kilobytes: 'kb',
  megabyte: 'mb', megabytes: 'mb',
  gigabyte: 'gb', gigabytes: 'gb',
  terabyte: 'tb', terabytes: 'tb',
  kibibyte: 'kib', kibibytes: 'kib',
  mebibyte: 'mib', mebibytes: 'mib',
  gibibyte: 'gib', gibibytes: 'gib',
  tebibyte: 'tib', tebibytes: 'tib',
  celsius: 'c', centigrade: 'c',
  fahrenheit: 'f',
  kelvin: 'k',
};

function normalizeUnit(u) {
  const key = String(u || '').trim().toLowerCase();
  return UNIT_ALIASES[key] || key;
}

function unitConvert(value, from, to) {
  const v = Number(value);
  if (Number.isNaN(v)) return { ok: false, error: 'value_must_be_number' };
  const f = normalizeUnit(from);
  const t = normalizeUnit(to);
  const TEMP = ['c', 'f', 'k'];
  if (TEMP.includes(f) || TEMP.includes(t)) {
    if (!TEMP.includes(f) || !TEMP.includes(t)) {
      return { ok: false, error: 'cannot_mix_temperature_with_other_units' };
    }
    const kelvin = f === 'c' ? v + 273.15 : f === 'f' ? ((v - 32) * 5) / 9 + 273.15 : v;
    const result =
      t === 'c' ? kelvin - 273.15 : t === 'f' ? ((kelvin - 273.15) * 9) / 5 + 32 : kelvin;
    return { ok: true, value: v, from: f, to: t, category: 'temperature', result: round(result, 6) };
  }
  const catF = UNIT_CATEGORY[f];
  const catT = UNIT_CATEGORY[t];
  if (!catF || !catT) return { ok: false, error: 'unknown_unit', from: f, to: t };
  if (catF !== catT) {
    return { ok: false, error: 'unit_category_mismatch', from_category: catF, to_category: catT };
  }
  const base = v * UNIT_FACTOR[f];
  const result = base / UNIT_FACTOR[t];
  return { ok: true, value: v, from: f, to: t, category: catF, result: round(result, 8) };
}

function caseConvert(text) {
  const words = String(text || '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  if (!words.length) return null;
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  return {
    slug: words.join('-'),
    kebab_case: words.join('-'),
    snake_case: words.join('_'),
    camelCase: words.map((w, i) => (i === 0 ? w : cap(w))).join(''),
    PascalCase: words.map(cap).join(''),
    CONSTANT_CASE: words.join('_').toUpperCase(),
    title_case: words.map(cap).join(' '),
    words,
  };
}

function readingTime(text, wpm) {
  const t = String(text || '');
  const words = t.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const w = Number(wpm) > 0 ? Number(wpm) : 200;
  const minutes = wordCount / w;
  const totalSeconds = Math.round(minutes * 60);
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return {
    ok: true,
    word_count: wordCount,
    char_count: t.length,
    char_count_no_spaces: t.replace(/\s+/g, '').length,
    wpm: w,
    reading_time_minutes: round(minutes, 2),
    reading_time_display: `${mm}:${String(ss).padStart(2, '0')}`,
  };
}

function jsonToTs(jsonStr, rootName) {
  const raw = String(jsonStr || '').trim();
  if (!raw) return { ok: false, error: 'json_required' };
  if (raw.length > 120000) return { ok: false, error: 'json_too_large', max_chars: 120000 };
  let value;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: 'invalid_json', detail: String(e.message || e).slice(0, 200) };
  }
  const root = (String(rootName || 'Root').replace(/[^A-Za-z0-9_]/g, '') || 'Root');
  const interfaces = [];
  const seen = new Map();

  function typeOf(v, nameHint, depth) {
    if (depth > 12) return 'unknown';
    if (v === null) return 'null';
    if (Array.isArray(v)) {
      if (!v.length) return 'unknown[]';
      const types = [...new Set(v.slice(0, 40).map((x) => typeOf(x, nameHint + 'Item', depth + 1)))];
      if (types.length === 1) return `${types[0]}[]`;
      return `(${types.join(' | ')})[]`;
    }
    if (typeof v === 'object') {
      const key = nameHint;
      if (seen.has(key)) return key;
      seen.set(key, true);
      const fields = Object.keys(v)
        .slice(0, 80)
        .map((k) => {
          const safe = /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : JSON.stringify(k);
          const childName =
            nameHint +
            (k.charAt(0).toUpperCase() + k.slice(1)).replace(/[^A-Za-z0-9_]/g, '') ||
            'Field';
          return `  ${safe}: ${typeOf(v[k], childName, depth + 1)};`;
        });
      interfaces.push(`interface ${key} {\n${fields.join('\n')}\n}`);
      return key;
    }
    if (typeof v === 'string') return 'string';
    if (typeof v === 'number') return 'number';
    if (typeof v === 'boolean') return 'boolean';
    return 'unknown';
  }

  const rootType = typeOf(value, root, 0);
  // Ensure root appears even for primitives / arrays of primitives
  if (!interfaces.length) {
    interfaces.push(`type ${root} = ${rootType};`);
  }
  return {
    ok: true,
    root,
    typescript: interfaces.join('\n\n'),
    interface_count: interfaces.length,
    web: `${HUB}/tools/json-ts`,
  };
}

function base64Codec(args) {
  const mode = String(args.mode || 'encode').toLowerCase();
  if (mode === 'encode' || mode === 'enc') {
    const text = args.text != null ? String(args.text) : '';
    if (!text && args.data == null) return { ok: false, error: 'text_required' };
    const buf = Buffer.from(text, 'utf8');
    if (buf.length > 200000) return { ok: false, error: 'input_too_large' };
    return { ok: true, mode: 'encode', base64: buf.toString('base64'), bytes: buf.length };
  }
  if (mode === 'decode' || mode === 'dec') {
    const data = String(args.data != null ? args.data : args.text || '').replace(/\s+/g, '');
    if (!data) return { ok: false, error: 'data_required' };
    try {
      const buf = Buffer.from(data, 'base64');
      return {
        ok: true,
        mode: 'decode',
        text: buf.toString('utf8'),
        bytes: buf.length,
      };
    } catch (e) {
      return { ok: false, error: 'invalid_base64', detail: String(e.message || e).slice(0, 120) };
    }
  }
  return { ok: false, error: 'mode_must_be_encode_or_decode' };
}

function uuidBatch(count) {
  const n = Math.min(50, Math.max(1, Number(count) || 1));
  const nodeCrypto = require('crypto');
  const ids = [];
  for (let i = 0; i < n; i++) {
    if (typeof nodeCrypto.randomUUID === 'function') {
      ids.push(nodeCrypto.randomUUID());
    } else {
      const b = nodeCrypto.randomBytes(16);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = b.toString('hex');
      ids.push(
        `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
      );
    }
  }
  return { ok: true, count: ids.length, uuids: ids };
}

function parseCsvLine(line, delim) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === delim) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function csvToMarkdown(csv, delimiter) {
  const text = String(csv || '').replace(/^\uFEFF/, '');
  if (!text.trim()) return { ok: false, error: 'csv_required' };
  const delim = delimiter != null && String(delimiter).length ? String(delimiter)[0] : ',';
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return { ok: false, error: 'empty_csv' };
  if (lines.length > 500) return { ok: false, error: 'too_many_rows', max: 500 };
  const rows = lines.map((l) => parseCsvLine(l, delim));
  const width = Math.max(...rows.map((r) => r.length));
  const norm = rows.map((r) => {
    const x = r.slice();
    while (x.length < width) x.push('');
    return x.map((c) => String(c).replace(/\|/g, '\\|').replace(/\n/g, ' '));
  });
  const header = norm[0];
  const sep = header.map(() => '---');
  const body = norm.slice(1);
  const md = [
    `| ${header.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
  return {
    ok: true,
    rows: norm.length,
    columns: width,
    markdown: md,
  };
}

function extractUrls(text) {
  const t = String(text || '');
  if (!t.trim()) return { ok: false, error: 'text_required' };
  const re = /https?:\/\/[^\s<>"')\]]+/gi;
  const found = t.match(re) || [];
  const cleaned = found.map((u) => u.replace(/[.,;:!?)]+$/, ''));
  const urls = [...new Set(cleaned)];
  return { ok: true, count: urls.length, urls };
}

function parseHexColor(hex) {
  let h = String(hex || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function relativeLuminance({ r, g, b }) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function wcagContrast(fg, bg) {
  const a = parseHexColor(fg);
  const b = parseHexColor(bg);
  if (!a || !b) return { ok: false, error: 'invalid_hex', hint: 'use #RGB or #RRGGBB' };
  const L1 = relativeLuminance(a);
  const L2 = relativeLuminance(b);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  const ratio = (lighter + 0.05) / (darker + 0.05);
  const r = round(ratio, 3);
  return {
    ok: true,
    fg: `#${[a.r, a.g, a.b].map((x) => x.toString(16).padStart(2, '0')).join('')}`,
    bg: `#${[b.r, b.g, b.b].map((x) => x.toString(16).padStart(2, '0')).join('')}`,
    ratio: r,
    aa_normal: r >= 4.5,
    aa_large: r >= 3,
    aaa_normal: r >= 7,
    aaa_large: r >= 4.5,
    web: `${HUB}/tools/contrast-forge`,
  };
}

function hashText(text, algo) {
  const a = String(algo || 'sha256').toLowerCase().replace(/[^a-z0-9]/g, '');
  const allowed = { sha256: 'sha256', sha1: 'sha1', md5: 'md5' };
  const name = allowed[a];
  if (!name) return { ok: false, error: 'algo_must_be_sha256_sha1_or_md5' };
  const t = String(text ?? '');
  if (t.length > 200000) return { ok: false, error: 'input_too_large' };
  const crypto = require('crypto');
  const hex = crypto.createHash(name).update(t, 'utf8').digest('hex');
  return { ok: true, algo: name, hex, bytes: Buffer.byteLength(t, 'utf8') };
}

function htmlEscape(text, mode) {
  const t = String(text ?? '');
  const m = String(mode || 'escape').toLowerCase();
  if (m === 'escape' || m === 'enc') {
    return {
      ok: true,
      mode: 'escape',
      text: t
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'),
    };
  }
  if (m === 'unescape' || m === 'dec') {
    return {
      ok: true,
      mode: 'unescape',
      text: t
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&'),
    };
  }
  return { ok: false, error: 'mode_must_be_escape_or_unescape' };
}

function percentChange(from, to) {
  const a = Number(from);
  const b = Number(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return { ok: false, error: 'from_to_must_be_numbers' };
  const delta = b - a;
  const pct = a === 0 ? null : (delta / Math.abs(a)) * 100;
  return {
    ok: true,
    from: a,
    to: b,
    delta: round(delta, 8),
    percent: pct == null ? null : round(pct, 4),
    percent_display: pct == null ? 'n/a (from=0)' : `${round(pct, 2)}%`,
  };
}

function wordFreq(text, limit) {
  const t = String(text || '');
  if (!t.trim()) return { ok: false, error: 'text_required' };
  const words = t
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
  const map = new Map();
  for (const w of words) map.set(w, (map.get(w) || 0) + 1);
  const n = Math.min(50, Math.max(1, Number(limit) || 20));
  const top = [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([word, count]) => ({ word, count }));
  return { ok: true, total_words: words.length, unique: map.size, top };
}

function regexTest(pattern, text, flags) {
  const p = String(pattern || '');
  const t = String(text || '');
  if (!p) return { ok: false, error: 'pattern_required' };
  let f = String(flags || 'g');
  if (!f.includes('g')) f += 'g';
  if (f.length > 8 || /[^gimsuy]/.test(f)) {
    return { ok: false, error: 'invalid_flags' };
  }
  let re;
  try {
    re = new RegExp(p, f);
  } catch (e) {
    return { ok: false, error: 'invalid_regex', detail: String(e.message || e).slice(0, 120) };
  }
  const matches = [];
  let m;
  let guard = 0;
  while ((m = re.exec(t)) && guard < 20) {
    matches.push({ match: m[0], index: m.index, groups: m.slice(1) });
    guard++;
    if (!re.global) break;
  }
  return {
    ok: true,
    pattern: p,
    flags: f,
    match_count: matches.length,
    matches,
    truncated: guard >= 20,
    web: `${HUB}/tools/regex-forge`,
  };
}

function jwtDecode(token) {
  const raw = String(token || '').trim();
  if (!raw) return { ok: false, error: 'token_required' };
  const parts = raw.split('.');
  if (parts.length < 2) return { ok: false, error: 'invalid_jwt_shape' };
  const b64url = (s) => {
    const pad = s + '==='.slice((s.length + 3) % 4);
    const b64 = pad.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(b64, 'base64').toString('utf8');
  };
  try {
    const header = JSON.parse(b64url(parts[0]));
    const payload = JSON.parse(b64url(parts[1]));
    return {
      ok: true,
      header,
      payload,
      signature_present: parts.length >= 3 && !!parts[2],
      note: 'Signature not verified — inspection only',
      web: `${HUB}/tools/jwt-claim-lens`,
    };
  } catch (e) {
    return { ok: false, error: 'decode_failed', detail: String(e.message || e).slice(0, 120) };
  }
}

function nowIso(offsetMinutes) {
  const now = new Date();
  const off = Number(offsetMinutes);
  const hasOff = !Number.isNaN(off);
  let local = null;
  if (hasOff) {
    const ms = now.getTime() + off * 60 * 1000;
    const d = new Date(ms);
    local = d.toISOString().replace('Z', '') + (off >= 0 ? '+' : '-') +
      String(Math.floor(Math.abs(off) / 60)).padStart(2, '0') +
      ':' +
      String(Math.abs(off) % 60).padStart(2, '0');
  }
  return {
    ok: true,
    utc_iso: now.toISOString(),
    unix: Math.floor(now.getTime() / 1000),
    unix_ms: now.getTime(),
    offset_minutes: hasOff ? off : null,
    local_iso: local,
  };
}

const LOREM_WORDS = (
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ' +
  'ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat ' +
  'duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur'
).split(' ');

function loremIpsum(paragraphs, sentences) {
  const paras = Math.min(6, Math.max(1, Number(paragraphs) || 1));
  const sents = Math.min(8, Math.max(2, Number(sentences) || 4));
  const out = [];
  let i = 0;
  for (let p = 0; p < paras; p++) {
    const bits = [];
    for (let s = 0; s < sents; s++) {
      const n = 8 + ((i + s) % 7);
      const words = [];
      for (let w = 0; w < n; w++) {
        words.push(LOREM_WORDS[(i + w) % LOREM_WORDS.length]);
      }
      i += n;
      let sentence = words.join(' ');
      sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.';
      bits.push(sentence);
    }
    out.push(bits.join(' '));
  }
  return { ok: true, paragraphs: out, text: out.join('\n\n') };
}

function installConfig(client) {
  const c = String(client || 'all').toLowerCase();
  const mcpUrl = 'https://nf-mcp.vercel.app/mcp';
  const restUrl = 'https://nf-mcp.vercel.app/tools';
  const cursor = {
    mcpServers: {
      'northern-forge': {
        url: mcpUrl,
      },
    },
  };
  const claude = {
    mcpServers: {
      'northern-forge': {
        url: mcpUrl,
        transport: 'http',
      },
    },
  };
  const generic = {
    json_rpc: mcpUrl,
    rest_list: 'GET ' + restUrl,
    rest_call: {
      method: 'POST',
      url: restUrl,
      body: { name: 'forge_status', arguments: {} },
    },
    curl:
      "curl -s https://nf-mcp.vercel.app/tools -H 'content-type: application/json' -d '{\"name\":\"forge_status\",\"arguments\":{}}'",
  };
  if (c === 'cursor') return { ok: true, client: 'cursor', config: cursor };
  if (c === 'claude') return { ok: true, client: 'claude', config: claude };
  if (c === 'generic') return { ok: true, client: 'generic', config: generic };
  return {
    ok: true,
    client: 'all',
    hub_console: `${HUB}/agents/console?id=northern-forge-mcp`,
    docs: `${HUB}/agents`,
    cursor,
    claude,
    generic,
  };
}

function forgeLoopStatus() {
  const state = readJsonSafe(path.join('data', 'claude_memory', 'state.json'));
  if (!state.ok) {
    return {
      ok: true,
      available: false,
      note: 'ADP state not mounted on this deployment — run locally on the operator host for full status',
      mcp_http: 'https://nf-mcp.vercel.app/mcp',
    };
  }
  const s = state.data || {};
  const recent = readJsonlTail(path.join('data', 'agentic_board', 'loop_events.jsonl'), 5);
  return {
    ok: true,
    available: true,
    synced_at: s.synced_at || null,
    always_on: s.always_on || null,
    loop_health: typeof s.loop_health === 'number' ? s.loop_health : null,
    ready: typeof s.loop_health === 'number' ? s.loop_health >= 0.8 : null,
    open_packages: typeof s.packages === 'number' ? s.packages : null,
    inbox_flagged: !!s.inbox,
    recent_events: recent,
  };
}

function gbrainCli(argv) {
  // Prefer scripts/gbrain_search.py on ADP host
  try {
    if (!fs.existsSync(path.join(ADP_ROOT, 'scripts', 'gbrain_search.py'))) {
      return {
        ok: true,
        available: false,
        note: 'gbrain_search.py not on this deployment — operator host only',
      };
    }
    const out = execFileSync(
      'python3',
      ['scripts/gbrain_search.py', ...argv],
      {
        cwd: ADP_ROOT,
        encoding: 'utf8',
        timeout: 15000,
        maxBuffer: 512 * 1024,
      }
    );
    const text = String(out || '').trim();
    try {
      return { ok: true, available: true, ...JSON.parse(text) };
    } catch {
      return { ok: true, available: true, context: text };
    }
  } catch (e) {
    return {
      ok: false,
      available: true,
      error: String(e.message || e).slice(0, 300),
    };
  }
}

function gbrainSearch(args = {}) {
  const q = args.query != null ? String(args.query) : '';
  const limit = Math.min(20, Math.max(1, Number(args.limit) || 6));
  return gbrainCli(['search', q, '--limit', String(limit), '--json']);
}

function gbrainGet(args = {}) {
  const name = String(args.name || '').trim();
  if (!name) return { ok: false, error: 'name_required' };
  return gbrainCli(['get', name]);
}

function gbrainList() {
  return gbrainCli(['list']);
}

function listMeshSnapshot(args) {
  const snap = readJsonSafe(path.join('data', 'command_center', 'snapshot.json'));
  if (!snap.ok) {
    return {
      ok: true,
      available: false,
      note: 'Mesh snapshot not mounted on this deployment — run locally on the operator host for full status',
    };
  }
  const d = snap.data || {};
  const headline = d.headline || {};
  const nodesObj = (d.mesh && d.mesh.nodes) || {};
  let nodes = Object.values(nodesObj).map((n) => ({
    name: n.name,
    status: n.status,
    state: n.state,
    paused: !!n.paused,
    current_action: n.current_action ? String(n.current_action).slice(0, 160) : null,
    last_seen: n.last_seen ? new Date(n.last_seen * 1000).toISOString() : null,
  }));
  const limit = Number(args.limit) > 0 ? Number(args.limit) : nodes.length;
  nodes = nodes.slice(0, limit);
  return {
    ok: true,
    available: true,
    generated_at: d.generated_at || null,
    mesh_online: headline.mesh_online ?? null,
    mesh_total: headline.mesh_total ?? null,
    nodes,
  };
}

function queueAction(args) {
  const action = String(args.action || '').trim();
  if (!action) return { ok: false, error: 'action_required' };
  if (action.length > 2000) return { ok: false, error: 'action_too_long', max: 2000 };
  let meta;
  if (args.meta && typeof args.meta === 'object') {
    const s = JSON.stringify(args.meta);
    if (s.length > 4000) return { ok: false, error: 'meta_too_large', max_chars: 4000 };
    meta = args.meta;
  }
  const entry = {
    id: `qa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    action,
    target: args.target ? String(args.target).slice(0, 200) : null,
    source: args.source ? String(args.source).slice(0, 100) : 'agent',
    status: 'queued',
    ...(meta ? { meta } : {}),
  };
  const line = JSON.stringify(entry) + '\n';
  let queuedTo = ACTION_QUEUE_REL;
  let persisted = true;
  try {
    fs.mkdirSync(path.dirname(ACTION_QUEUE_PRIMARY), { recursive: true });
    fs.appendFileSync(ACTION_QUEUE_PRIMARY, line);
  } catch {
    try {
      fs.appendFileSync(ACTION_QUEUE_FALLBACK, line);
      queuedTo = '/tmp/nf_action_queue.jsonl';
      persisted = false;
    } catch (e2) {
      return { ok: false, error: 'queue_write_failed', detail: String(e2.message || e2) };
    }
  }
  return {
    ok: true,
    queued: entry,
    queued_to: queuedTo,
    persisted,
    note: persisted
      ? 'Appended to local review queue — a human must approve before anything runs.'
      : 'Serverless fallback (/tmp) is ephemeral — run this server locally on the operator host for durable queueing.',
  };
}

function readQueueLines() {
  for (const p of [ACTION_QUEUE_PRIMARY, ACTION_QUEUE_FALLBACK]) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      if (raw.trim()) return raw.split('\n').filter(Boolean);
    } catch {
      // try next
    }
  }
  return [];
}

function listQueuedActions(args) {
  const lines = readQueueLines();
  let rows = lines
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (args.status) rows = rows.filter((r) => r.status === args.status);
  rows.reverse();
  const limit = Math.min(200, Number(args.limit) > 0 ? Number(args.limit) : 20);
  return { ok: true, count: rows.length, actions: rows.slice(0, limit) };
}

function readHostMemory() {
  for (const p of [HOST_MEMORY_PRIMARY, HOST_MEMORY_FALLBACK]) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      return { data: JSON.parse(raw), path: p };
    } catch {
      // try next
    }
  }
  return { data: {}, path: null };
}

const HOST_MEMORY_MAX_KEYS_PER_HOST = 200;

function hostMemorySet(args) {
  const hostId = String(args.host_id || '').trim();
  const key = String(args.key || '').trim();
  const value = String(args.value ?? '').trim();
  if (!hostId) return { ok: false, error: 'host_id_required' };
  if (!key) return { ok: false, error: 'key_required' };
  if (!value) return { ok: false, error: 'value_required' };
  if (hostId.length > 100) return { ok: false, error: 'host_id_too_long', max: 100 };
  if (key.length > 100) return { ok: false, error: 'key_too_long', max: 100 };
  if (value.length > 2000) return { ok: false, error: 'value_too_long', max: 2000 };

  const { data: mem } = readHostMemory();
  const host = mem[hostId] || {};
  if (!(key in host) && Object.keys(host).length >= HOST_MEMORY_MAX_KEYS_PER_HOST) {
    return { ok: false, error: 'host_memory_full', max_keys: HOST_MEMORY_MAX_KEYS_PER_HOST };
  }
  host[key] = { value, at: new Date().toISOString() };
  mem[hostId] = host;
  const text = JSON.stringify(mem, null, 2) + '\n';

  let savedTo = HOST_MEMORY_REL;
  let persisted = true;
  try {
    fs.mkdirSync(path.dirname(HOST_MEMORY_PRIMARY), { recursive: true });
    fs.writeFileSync(HOST_MEMORY_PRIMARY, text);
  } catch {
    try {
      fs.writeFileSync(HOST_MEMORY_FALLBACK, text);
      savedTo = '/tmp/nf_host_memory.json';
      persisted = false;
    } catch (e2) {
      return { ok: false, error: 'write_failed', detail: String(e2.message || e2) };
    }
  }
  return {
    ok: true,
    host_id: hostId,
    key,
    saved_to: savedTo,
    persisted,
    note: persisted
      ? 'Saved to local per-host memory.'
      : 'Serverless fallback (/tmp) is ephemeral — run this server locally on the operator host for durable memory.',
  };
}

function hostMemoryGet(args) {
  const hostId = String(args.host_id || '').trim();
  if (!hostId) return { ok: false, error: 'host_id_required' };
  const { data: mem, path: from } = readHostMemory();
  if (!from) {
    return {
      ok: true,
      available: false,
      note: 'No host memory saved yet on this deployment.',
    };
  }
  const host = mem[hostId] || {};
  if (args.key) {
    const key = String(args.key).trim();
    const entry = host[key];
    return { ok: true, available: true, host_id: hostId, key, entry: entry || null };
  }
  return { ok: true, available: true, host_id: hostId, notes: host };
}

function runSafeCmd(args) {
  const id = String(args.command_id || '').trim();
  if (!id) {
    return {
      ok: true,
      commands: Object.entries(SAFE_COMMANDS).map(([cid, c]) => ({
        command_id: cid,
        description: c.description,
      })),
      note: 'Pass command_id to run one of these. No arbitrary commands accepted.',
    };
  }
  const entry = SAFE_COMMANDS[id];
  if (!entry) {
    return {
      ok: false,
      error: 'unknown_command_id',
      allowed: Object.keys(SAFE_COMMANDS),
    };
  }
  try {
    const out = execFileSync(entry.cmd, entry.args, {
      cwd: entry.cwd || undefined,
      timeout: 5000,
      maxBuffer: 64 * 1024,
      encoding: 'utf8',
    });
    return {
      ok: true,
      available: true,
      command_id: id,
      description: entry.description,
      stdout: out.slice(0, 4000),
      truncated: out.length > 4000,
    };
  } catch (e) {
    return {
      ok: true,
      available: false,
      command_id: id,
      error: String((e && e.message) || e).slice(0, 500),
      note: 'Command failed or unavailable on this deployment (likely off the operator host, or binary/checkout missing).',
    };
  }
}

async function callTool(name, args = {}) {
  switch (name) {
    case 'list_live_products': {
      let rows = CATALOG.slice();
      if (args.kind) {
        rows = rows.filter((r) => (r.kind || 'web_tool') === args.kind);
      }
      const limit = Math.min(100, Number(args.limit) || 50);
      return {
        ok: true,
        count: rows.length,
        products: rows.slice(0, limit),
        hub: HUB,
      };
    }
    case 'get_product': {
      const id = String(args.id || '').toLowerCase();
      const p = CATALOG.find(
        (r) =>
          String(r.product_id || '').toLowerCase() === id ||
          String(r.slug || '').toLowerCase() === id
      );
      if (!p) return { ok: false, error: 'not_found', id };
      return { ok: true, product: p };
    }
    case 'popular_tools': {
      const limit = Math.min(30, Number(args.limit) || 12);
      const remote = await fetchJson(
        `${CONVERSION}/api/analytics/popular?limit=${limit}`
      );
      if (remote.ok && remote.data) {
        return { ok: true, source: 'conversion', ...remote.data };
      }
      // local seed from catalog order
      return {
        ok: true,
        source: 'catalog_fallback',
        at: new Date().toISOString(),
        hot: CATALOG.slice(0, 3).map((p) => p.product_id),
        popular: CATALOG.slice(0, limit).map((p, i) => ({
          product_id: p.product_id,
          score: limit - i,
        })),
      };
    }
    case 'post_event': {
      const body = {
        type: args.type || 'agent_tool_call',
        product_id: args.product_id,
        source: args.source || 'nf-mcp',
        ...(args.meta && typeof args.meta === 'object' ? { meta: args.meta } : {}),
      };
      const remote = await fetchJson(`${CONVERSION}/api/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return {
        ok: !!remote.ok,
        forwarded: remote.ok,
        status: remote.status,
        event: body,
        response: remote.data || remote.error,
      };
    }
    case 'get_payment_link': {
      const id = String(args.product_id || '');
      const url =
        PAYMENT_LINKS[id] ||
        PAYMENT_LINKS[id.replace(/_/g, '-')] ||
        null;
      return {
        ok: true,
        product_id: id,
        payment_url: url,
        note: url
          ? 'Stripe Payment Link'
          : 'No public payment link configured for this product yet',
        unlock_hub: `${HUB}/revenue`,
      };
    }
    case 'forge_status': {
      const publicTools = Object.entries(TOOL_META)
        .filter(([, m]) => !m.localOnly)
        .map(([n]) => n);
      return {
        ok: true,
        brand: 'Northern Forge Labs',
        hub: HUB,
        skills_and_mcp_docs: `${HUB}/agents`,
        agents_docs: `${HUB}/agents`,
        console: `${HUB}/agents/console?id=northern-forge-mcp`,
        mcp_http: 'https://nf-mcp.vercel.app/mcp',
        mcp_rest: 'https://nf-mcp.vercel.app/tools',
        health: 'https://nf-mcp.vercel.app/health',
        conversion: CONVERSION,
        product_count: CATALOG.length,
        surfaces: ['web_tools', 'agent_skills', 'mcp'],
        note:
          'Free core job tools for any agent. Call install_config for Cursor/Claude snippets.',
        public_tool_count: publicTools.length,
        public_tools_sample: publicTools.slice(0, 16),
        install: installConfig('all'),
        x: 'https://x.com/NForge26',
        github: 'https://github.com/Menoxcide/northern-forge-products',
        at: new Date().toISOString(),
      };
    }
    case 'list_mcp_tools': {
      const publicOnly =
        args.public_only === true ||
        args.publicOnly === true ||
        String(args.scope || '') === 'public';
      return {
        ok: true,
        tools: toolDefs({ includeLocal: !publicOnly }),
        scope: publicOnly ? 'public' : 'all',
      };
    }
    case 'golden_hour_windows': {
      const lat = Number(args.lat);
      const lon = Number(args.lon);
      if (Number.isNaN(lat) || Number.isNaN(lon)) {
        return { ok: false, error: 'lat_lon_required' };
      }
      return solarWindows(lat, lon, args.date);
    }
    case 'pack_weight_sum': {
      const items = Array.isArray(args.items) ? args.items : [];
      let grams = 0;
      const lines = [];
      for (const it of items) {
        const q = Number(it.qty) > 0 ? Number(it.qty) : 1;
        const g = Number(it.grams) || 0;
        const sub = g * q;
        grams += sub;
        lines.push({
          name: it.name || 'item',
          grams: g,
          qty: q,
          subtotal_g: sub,
        });
      }
      return {
        ok: true,
        total_grams: Math.round(grams * 10) / 10,
        total_lb: Math.round((grams / 453.592) * 100) / 100,
        items: lines,
        web: `${HUB}/tools/gear-pack`,
      };
    }
    case 'prompt_variants': {
      const goal = String(args.goal || '').trim();
      const notes = String(args.notes || '').trim();
      if (!goal) return { ok: false, error: 'goal_required' };
      const base = notes ? `${goal}\n\nContext:\n${notes}` : goal;
      return {
        ok: true,
        variants: {
          claude: `You are a careful senior engineer.\n\nTask:\n${base}\n\nRespond with structure, tradeoffs, and a concrete next step.`,
          gpt: `System: practical product builder.\nUser: ${base}\n\nGive a concise plan + deliverable checklist.`,
          grok: `Be direct and useful.\n\n${base}\n\nSkip fluff. Ship the smallest working version first.`,
        },
        web: `${HUB}/tools/prompt-forge`,
      };
    }
    case 'diff_text': {
      if (typeof args.a !== 'string' || typeof args.b !== 'string') {
        return { ok: false, error: 'a_and_b_required_strings' };
      }
      return diffText(args.a, args.b);
    }
    case 'cron_explain': {
      return cronExplain(args.expr);
    }
    case 'unit_convert': {
      if (args.value === undefined || !args.from || !args.to) {
        return { ok: false, error: 'value_from_to_required' };
      }
      return unitConvert(args.value, args.from, args.to);
    }
    case 'slug_case': {
      const result = caseConvert(args.text);
      if (!result) return { ok: false, error: 'text_required' };
      return { ok: true, ...result };
    }
    case 'reading_time': {
      if (typeof args.text !== 'string' || !args.text.trim()) {
        return { ok: false, error: 'text_required' };
      }
      return readingTime(args.text, args.wpm);
    }
    case 'json_to_ts': {
      return jsonToTs(args.json, args.root_name);
    }
    case 'base64_codec': {
      return base64Codec(args);
    }
    case 'uuid_batch': {
      return uuidBatch(args.count);
    }
    case 'csv_to_markdown': {
      return csvToMarkdown(args.csv, args.delimiter);
    }
    case 'extract_urls': {
      return extractUrls(args.text);
    }
    case 'wcag_contrast': {
      return wcagContrast(args.fg, args.bg);
    }
    case 'hash_text': {
      return hashText(args.text, args.algo);
    }
    case 'html_escape': {
      return htmlEscape(args.text, args.mode);
    }
    case 'percent_change': {
      if (args.from === undefined || args.to === undefined) {
        return { ok: false, error: 'from_to_required' };
      }
      return percentChange(args.from, args.to);
    }
    case 'word_freq': {
      return wordFreq(args.text, args.limit);
    }
    case 'regex_test': {
      return regexTest(args.pattern, args.text, args.flags);
    }
    case 'jwt_decode': {
      return jwtDecode(args.token);
    }
    case 'now_iso': {
      return nowIso(args.offset_minutes);
    }
    case 'lorem_ipsum': {
      return loremIpsum(args.paragraphs, args.sentences);
    }
    case 'install_config': {
      return installConfig(args.client);
    }
    case 'forge_loop_status': {
      return forgeLoopStatus();
    }
    case 'list_mesh_snapshot': {
      return listMeshSnapshot(args);
    }
    case 'queue_action': {
      return queueAction(args);
    }
    case 'list_queued_actions': {
      return listQueuedActions(args);
    }
    case 'host_memory_set': {
      return hostMemorySet(args);
    }
    case 'host_memory_get': {
      return hostMemoryGet(args);
    }
    case 'run_safe_cmd': {
      return runSafeCmd(args);
    }
    case 'gbrain_search': {
      return gbrainSearch(args);
    }
    case 'gbrain_get': {
      return gbrainGet(args);
    }
    case 'gbrain_list': {
      return gbrainList();
    }
    default:
      return { ok: false, error: 'unknown_tool', name };
  }
}

module.exports = {
  TOOL_META,
  TOOL_EXAMPLES,
  TOOL_EXAMPLE_VARIANTS,
  pickExample,
  toolDefs,
  callTool,
  CATALOG,
};
