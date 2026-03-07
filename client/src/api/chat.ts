export async function fetchChats(projectId: number) {
  const res = await fetch(`/api/projects/${projectId}/chats`);
  return res.json();
}

export async function createChat(projectId: number, title?: string, canvasW?: number, canvasH?: number) {
  const res = await fetch(`/api/projects/${projectId}/chats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, canvas_w: canvasW, canvas_h: canvasH }),
  });
  return res.json();
}

export async function deleteChat(chatId: number) {
  const res = await fetch(`/api/chats/${chatId}`, { method: 'DELETE' });
  return res.json();
}

export async function clearChatMessages(chatId: number) {
  const res = await fetch(`/api/chats/${chatId}/messages`, { method: 'DELETE' });
  return res.json();
}

export async function fetchChatMessages(chatId: number) {
  const res = await fetch(`/api/chats/${chatId}/messages`);
  return res.json();
}

export async function compressChat(chatId: number, model?: string) {
  const res = await fetch(`/api/chats/${chatId}/compress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model || undefined }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '压缩请求失败' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchConversations(projectId: number) {
  const res = await fetch(`/api/projects/${projectId}/conversations`);
  return res.json();
}

export async function sendChatMessage(
  projectId: number,
  message: string,
  model?: string,
  chatId?: number,
  images?: string[],
): Promise<Response> {
  return fetch('/api/llm/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id: projectId,
      chat_id: chatId,
      message,
      model: model || undefined,
      images: images?.length ? images : undefined,
    }),
  });
}
