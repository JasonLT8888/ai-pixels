import db from './db/index.js';

export interface StoredLLMConfig {
  id: number;
  name: string;
  api_url: string;
  api_token: string;
  model: string;
  context_window: number;
  compress_threshold: number;
  is_active: number;
  updated_at?: string;
}

export interface PublicLLMConfig {
  id: number;
  name: string;
  api_url: string;
  model: string;
  token_set: boolean;
  context_window: number;
  compress_threshold: number;
  updated_at?: string;
}

export function toPublicLLMConfig(config: StoredLLMConfig): PublicLLMConfig {
  return {
    id: config.id,
    name: config.name,
    api_url: config.api_url,
    model: config.model,
    token_set: !!config.api_token,
    context_window: config.context_window ?? 0,
    compress_threshold: config.compress_threshold ?? 1000,
    updated_at: config.updated_at,
  };
}

export function listLLMConfigs(): StoredLLMConfig[] {
  return db.prepare(
    `SELECT id, name, api_url, api_token, model, context_window, compress_threshold, is_active, updated_at
     FROM llm_config
     ORDER BY is_active DESC, updated_at DESC, id ASC`
  ).all() as StoredLLMConfig[];
}

export function getLLMConfigCollection() {
  const configs = listLLMConfigs();
  const active = configs.find((config) => config.is_active === 1) ?? null;
  return {
    active_config_id: active?.id ?? null,
    profiles: configs.map(toPublicLLMConfig),
  };
}

export function resolveLLMConfig(configId?: number | null): StoredLLMConfig | null {
  if (configId) {
    const byId = db.prepare(
      `SELECT id, name, api_url, api_token, model, context_window, compress_threshold, is_active, updated_at
       FROM llm_config WHERE id = ?`
    ).get(configId) as StoredLLMConfig | undefined;
    if (byId) return byId;
  }

  const active = db.prepare(
    `SELECT id, name, api_url, api_token, model, context_window, compress_threshold, is_active, updated_at
     FROM llm_config
     WHERE is_active = 1
     ORDER BY updated_at DESC, id ASC
     LIMIT 1`
  ).get() as StoredLLMConfig | undefined;
  if (active) return active;

  const fallback = db.prepare(
    `SELECT id, name, api_url, api_token, model, context_window, compress_threshold, is_active, updated_at
     FROM llm_config
     ORDER BY updated_at DESC, id ASC
     LIMIT 1`
  ).get() as StoredLLMConfig | undefined;
  return fallback ?? null;
}

export function createLLMConfig(data: {
  name?: string;
  api_url?: string;
  api_token?: string;
  model?: string;
  context_window?: number;
  compress_threshold?: number;
  make_active?: boolean;
}): StoredLLMConfig {
  const existingCount = db.prepare('SELECT COUNT(*) AS count FROM llm_config').get() as { count: number };
  const shouldActivate = data.make_active || existingCount.count === 0;
  const result = db.prepare(
    `INSERT INTO llm_config (name, api_url, api_token, model, context_window, compress_threshold, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 0)`
  ).run(
    data.name?.trim() || `配置 ${existingCount.count + 1}`,
    data.api_url ?? '',
    data.api_token ?? '',
    data.model ?? '',
    data.context_window ?? 0,
    data.compress_threshold ?? 1000,
  );

  const insertedId = Number(result.lastInsertRowid);
  if (shouldActivate) {
    setActiveLLMConfig(insertedId);
  }

  return resolveLLMConfig(insertedId)!;
}

export function updateLLMConfigById(id: number, data: {
  name?: string;
  api_url?: string;
  api_token?: string;
  model?: string;
  context_window?: number;
  compress_threshold?: number;
}): StoredLLMConfig | null {
  const existing = resolveLLMConfig(id);
  if (!existing || existing.id !== id) return null;

  const token = data.api_token ? data.api_token : existing.api_token;
  db.prepare(
    `UPDATE llm_config
     SET name = ?,
         api_url = ?,
         api_token = ?,
         model = ?,
         context_window = ?,
         compress_threshold = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(
    data.name?.trim() || existing.name,
    data.api_url ?? existing.api_url,
    token,
    data.model ?? existing.model,
    data.context_window ?? existing.context_window ?? 0,
    data.compress_threshold ?? existing.compress_threshold ?? 1000,
    id,
  );

  return resolveLLMConfig(id);
}

export function setActiveLLMConfig(id: number | null) {
  const tx = db.transaction((targetId: number | null) => {
    db.prepare('UPDATE llm_config SET is_active = 0').run();
    if (targetId) {
      db.prepare('UPDATE llm_config SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(targetId);
    }
  });

  tx(id);
}

export function deleteLLMConfigById(id: number): boolean {
  const existing = db.prepare('SELECT id, is_active FROM llm_config WHERE id = ?').get(id) as Pick<StoredLLMConfig, 'id' | 'is_active'> | undefined;
  if (!existing) return false;

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM llm_config WHERE id = ?').run(id);

    if (existing.is_active) {
      const next = db.prepare(
        'SELECT id FROM llm_config ORDER BY updated_at DESC, id ASC LIMIT 1'
      ).get() as { id: number } | undefined;
      if (next) {
        db.prepare('UPDATE llm_config SET is_active = CASE WHEN id = ? THEN 1 ELSE 0 END').run(next.id);
      }
    }
  });

  tx();
  return true;
}