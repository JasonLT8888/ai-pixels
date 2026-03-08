import { Router } from 'express';
import db from '../db/index.js';
import {
  createLLMConfig,
  deleteLLMConfigById,
  getLLMConfigCollection,
  resolveLLMConfig,
  setActiveLLMConfig,
  toPublicLLMConfig,
  updateLLMConfigById,
} from '../llm-config.js';

const router = Router();

// GET /api/config/llm — get all LLM configs (token masked)
router.get('/llm', (_req, res) => {
  res.json(getLLMConfigCollection());
});

// POST /api/config/llm — create LLM config
router.post('/llm', (req, res) => {
  const config = createLLMConfig(req.body ?? {});
  res.status(201).json(toPublicLLMConfig(config));
});

// PUT /api/config/llm/active — set active LLM config
router.put('/llm/active', (req, res) => {
  const configId = typeof req.body?.config_id === 'number' ? req.body.config_id : null;
  if (configId !== null && !resolveLLMConfig(configId)) {
    return res.status(404).json({ error: 'Config not found' });
  }

  setActiveLLMConfig(configId);
  res.json(getLLMConfigCollection());
});

// PUT /api/config/llm/:id — update one LLM config
router.put('/llm/:id', (req, res) => {
  const configId = Number(req.params.id);
  if (!Number.isFinite(configId)) {
    return res.status(400).json({ error: 'Invalid config id' });
  }

  const updated = updateLLMConfigById(configId, req.body ?? {});
  if (!updated) {
    return res.status(404).json({ error: 'Config not found' });
  }

  res.json(toPublicLLMConfig(updated));
});

// DELETE /api/config/llm/:id — delete one LLM config
router.delete('/llm/:id', (req, res) => {
  const configId = Number(req.params.id);
  if (!Number.isFinite(configId)) {
    return res.status(400).json({ error: 'Invalid config id' });
  }

  const deleted = deleteLLMConfigById(configId);
  if (!deleted) {
    return res.status(404).json({ error: 'Config not found' });
  }

  res.json(getLLMConfigCollection());
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
  const configId = typeof req.body?.config_id === 'number' ? req.body.config_id : undefined;
  const resolved = resolveLLMConfig(configId);
  const apiUrl = req.body?.api_url || resolved?.api_url || '';
  const token = req.body?.api_token || resolved?.api_token || '';

  if (!apiUrl) {
    return res.status(400).json({ code: 'LLM_CONFIG_INCOMPLETE', error: '当前配置缺少 API 地址' });
  }

  try {
    const baseUrl = apiUrl.replace(/\/$/, '');
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
    const models = (body.data || [])
      .filter((m: any) => m.id)
      .map((m: any) => ({
        id: m.id as string,
        context_window: m.context_length ?? m.context_window ?? undefined,
      }));
    res.json({ models });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch models' });
  }
});

export default router;
