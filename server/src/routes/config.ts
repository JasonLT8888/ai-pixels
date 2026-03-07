import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

// GET /api/config/llm — get LLM config (token masked)
router.get('/llm', (_req, res) => {
  const row = db.prepare('SELECT * FROM llm_config WHERE id = 1').get() as any;
  if (!row) {
    return res.json({ api_url: '', model: '', token_set: false });
  }
  res.json({
    api_url: row.api_url,
    model: row.model,
    token_set: !!row.api_token,
  });
});

// PUT /api/config/llm — update LLM config
router.put('/llm', (req, res) => {
  const { api_url, model, api_token } = req.body;
  const existing = db.prepare('SELECT * FROM llm_config WHERE id = 1').get() as any;

  if (!existing) {
    db.prepare(
      'INSERT INTO llm_config (id, api_url, api_token, model) VALUES (1, ?, ?, ?)'
    ).run(api_url ?? '', api_token ?? '', model ?? '');
  } else {
    // If token is empty string or undefined, keep existing
    const token = api_token ? api_token : existing.api_token;
    db.prepare(
      'UPDATE llm_config SET api_url = ?, api_token = ?, model = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
    ).run(api_url ?? existing.api_url, token, model ?? existing.model);
  }
  res.json({ ok: true });
});

// GET /api/config/prompt — get system prompt
router.get('/prompt', (_req, res) => {
  const row = db.prepare('SELECT * FROM system_prompt WHERE id = 1').get() as any;
  res.json({ content: row?.content ?? '' });
});

// PUT /api/config/prompt — update system prompt
router.put('/prompt', (req, res) => {
  const { content } = req.body;
  const existing = db.prepare('SELECT * FROM system_prompt WHERE id = 1').get();
  if (!existing) {
    db.prepare('INSERT INTO system_prompt (id, content) VALUES (1, ?)').run(content ?? '');
  } else {
    db.prepare('UPDATE system_prompt SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1').run(content ?? '');
  }
  res.json({ ok: true });
});

// POST /api/config/models — fetch available models from upstream API
router.post('/models', async (req, res) => {
  const { api_url, api_token } = req.body;
  if (!api_url) {
    return res.status(400).json({ error: 'api_url is required' });
  }

  // Use provided token, or fall back to saved token
  let token = api_token;
  if (!token) {
    const row = db.prepare('SELECT api_token FROM llm_config WHERE id = 1').get() as any;
    token = row?.api_token || '';
  }

  try {
    const baseUrl = api_url.replace(/\/$/, '');
    const upstream = await fetch(`${baseUrl}/models`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      return res.status(upstream.status).json({ error: `Upstream ${upstream.status}: ${errText}` });
    }

    const body = await upstream.json() as any;
    // OpenAI-compatible: { data: [{ id: "model-name", ... }] }
    const models: string[] = (body.data || []).map((m: any) => m.id).filter(Boolean);
    res.json({ models });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch models' });
  }
});

export default router;
