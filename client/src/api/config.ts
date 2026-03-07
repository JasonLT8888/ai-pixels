const API = '/api/config';

export async function fetchLLMConfig() {
  const res = await fetch(`${API}/llm`);
  return res.json();
}

export async function updateLLMConfig(data: {
  api_url?: string;
  model?: string;
  api_token?: string;
  context_window?: number;
  compress_threshold?: number;
}) {
  const res = await fetch(`${API}/llm`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
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

export async function fetchModels(apiUrl: string, apiToken: string): Promise<ModelInfo[]> {
  const res = await fetch(`${API}/models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_url: apiUrl, api_token: apiToken }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to fetch models' }));
    throw new Error(err.error || 'Failed to fetch models');
  }
  const data = await res.json();
  return data.models || [];
}
