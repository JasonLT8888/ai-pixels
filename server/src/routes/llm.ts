import { Router, type Request, type Response } from 'express';
import db from '../db/index.js';
import { DEFAULT_SYSTEM_PROMPT } from 'shared/src/default-prompt.js';

const router = Router();

// POST /api/llm/chat — SSE streaming proxy to upstream LLM
router.post('/chat', async (req: Request, res: Response) => {
  const { project_id, chat_id, message, model: requestModel, images } = req.body;
  if (!chat_id || !message) {
    return res.status(400).json({ error: 'chat_id and message are required' });
  }

  // Resolve project_id and canvas size from chat
  let projectId = project_id;
  const chatRow = db.prepare('SELECT project_id, canvas_w, canvas_h FROM chats WHERE id = ?').get(chat_id) as any;
  if (!chatRow) return res.status(404).json({ error: 'Chat not found' });
  if (!projectId) projectId = chatRow.project_id;
  const canvasW: number = chatRow.canvas_w || 32;
  const canvasH: number = chatRow.canvas_h || 32;

  // 1. Load LLM config
  const config = db.prepare('SELECT * FROM llm_config WHERE id = 1').get() as any;
  if (!config?.api_url || !config?.api_token || !config?.model) {
    return res.status(400).json({ error: 'LLM not configured. Please set API URL, token, and model in settings.' });
  }

  // Use request model if provided, otherwise fall back to config
  const activeModel = requestModel || config.model;

  // 2. Load user's extra prompt (appended to hardcoded default)
  const promptRow = db.prepare('SELECT content FROM system_prompt WHERE id = 1').get() as any;
  const extraPrompt = promptRow?.content || '';
  const systemPrompt = extraPrompt
    ? DEFAULT_SYSTEM_PROMPT + '\n\n' + extraPrompt
    : DEFAULT_SYSTEM_PROMPT;

  // 3. Load conversation history by chat_id
  const history = db.prepare(
    'SELECT role, content, images FROM conversations WHERE chat_id = ? ORDER BY created_at ASC'
  ).all(chat_id) as { role: string; content: string; images: string | null }[];

  // 4. Save user message (store images JSON if present)
  const imagesJson = Array.isArray(images) && images.length > 0 ? JSON.stringify(images) : null;
  db.prepare(
    'INSERT INTO conversations (project_id, chat_id, role, content, images) VALUES (?, ?, ?, ?, ?)'
  ).run(projectId, chat_id, 'user', message, imagesJson);

  // Helper: build OpenAI message content (text-only or multimodal)
  function buildContent(text: string, imgJson: string | null): string | any[] {
    if (!imgJson) return text;
    try {
      const urls: string[] = JSON.parse(imgJson);
      if (!urls.length) return text;
      const parts: any[] = [{ type: 'text', text }];
      for (const url of urls) {
        parts.push({ type: 'image_url', image_url: { url } });
      }
      return parts;
    } catch {
      return text;
    }
  }

  // 5. Build messages array — inject canvas size context into system prompt
  const canvasContext = `\n\n## 当前画布\n画布尺寸已由用户设定为 ${canvasW}×${canvasH}，你不需要也不允许输出 canvas/C 指令。系统会自动在渲染时添加画布初始化，你只需输出绘图指令（pal、c、p、P、r、e、l、f、# 等）。`;
  const messages: { role: string; content: string | any[] }[] = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt + canvasContext });
  }
  for (const h of history) {
    messages.push({ role: h.role, content: buildContent(h.content, h.images) });
  }
  messages.push({ role: 'user', content: buildContent(message, imagesJson) });

  // 6. Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send debug frame with request info
  res.write(`data: ${JSON.stringify({ debug: { model: activeModel, messages } })}\n\n`);

  let fullText = '';

  try {
    // 7. Call upstream LLM API (OpenAI-compatible)
    const apiUrl = config.api_url.replace(/\/$/, '');
    const upstream = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.api_token}`,
      },
      body: JSON.stringify({
        model: activeModel,
        messages,
        stream: true,
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      res.write(`data: ${JSON.stringify({ error: `Upstream ${upstream.status}: ${errText}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // 8. Stream chunks to client
    const reader = upstream.body?.getReader();
    if (!reader) {
      res.write(`data: ${JSON.stringify({ error: 'No response body from upstream' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);

        if (data === '[DONE]') {
          continue;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            res.write(`data: ${JSON.stringify({ delta })}\n\n`);
          }
        } catch {
          // skip unparseable chunks
        }
      }
    }

    // 9. Save assistant response with model
    if (fullText) {
      db.prepare(
        'INSERT INTO conversations (project_id, chat_id, role, content, model) VALUES (?, ?, ?, ?, ?)'
      ).run(projectId, chat_id, 'assistant', fullText, activeModel);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ error: err.message || 'Unknown error' })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

export default router;
