import type { LLMConfigCollection, LLMConfigProfile } from 'shared/src/types';

const API = '/api/config';

export async function fetchLLMConfig(): Promise<LLMConfigCollection> {
  const res = await fetch(`${API}/llm`);
  return res.json();
}

export async function createLLMConfig(data: {
  name?: string;
  api_url?: string;
  model?: string;
  api_token?: string;
  context_window?: number;
  compress_threshold?: number;
  make_active?: boolean;
}): Promise<LLMConfigProfile> {
  const res = await fetch(`${API}/llm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function updateLLMConfig(configId: number, data: {
  name?: string;
  api_url?: string;
  model?: string;
  api_token?: string;
  context_window?: number;
  compress_threshold?: number;
}): Promise<LLMConfigProfile> {
  const res = await fetch(`${API}/llm/${configId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function deleteLLMConfig(configId: number): Promise<LLMConfigCollection> {
  const res = await fetch(`${API}/llm/${configId}`, {
    method: 'DELETE',
  });
  return res.json();
}

export async function setActiveLLMConfig(configId: number | null): Promise<LLMConfigCollection> {
  const res = await fetch(`${API}/llm/active`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config_id: configId }),
  });
  return res.json();
}

export async function fetchSystemPrompt() {
  const res = await fetch(`${API}/prompt`);
  return res.json();
}

export async function updateSystemPrompt(content: string) {
  const res = await fetch(`${API}/prompt`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  return res.json();
}

export interface ModelInfo {
  id: string;
  context_window?: number;
}

export async function fetchModels(options: {
  configId?: number;
  apiUrl?: string;
  apiToken?: string;
}): Promise<ModelInfo[]> {
  const res = await fetch(`${API}/models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config_id: options.configId,
      api_url: options.apiUrl,
      api_token: options.apiToken,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to fetch models' }));
    throw new Error(err.error || 'Failed to fetch models');
  }
  const data = await res.json();
  return data.models || [];
}
