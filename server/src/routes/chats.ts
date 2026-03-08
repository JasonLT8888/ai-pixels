import { Router } from 'express';
import db from '../db/index.js';
import { resolveLLMConfig } from '../llm-config.js';

// Project-scoped routes: mounted at /api/projects
export const projectChatsRouter = Router();

// GET /api/projects/:id/chats — list all chats for a project
projectChatsRouter.get('/:id/chats', (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.title, c.canvas_w, c.canvas_h, c.created_at,
           c.compressed_summary, c.compress_before_id,
           (SELECT COUNT(*) FROM conversations WHERE chat_id = c.id) AS message_count,
           (SELECT content FROM conversations
            WHERE chat_id = c.id AND role = 'assistant'
            ORDER BY created_at DESC LIMIT 1) AS last_assistant_content
    FROM chats c
    WHERE c.project_id = ?
    ORDER BY c.created_at DESC
  `).all(req.params.id);
  res.json(rows);
});

// POST /api/projects/:id/chats — create a new chat
projectChatsRouter.post('/:id/chats', (req, res) => {
  const title = req.body.title || '新对话';
  const canvas_w = req.body.canvas_w || 32;
  const canvas_h = req.body.canvas_h || 32;
  const result = db.prepare(
    'INSERT INTO chats (project_id, title, canvas_w, canvas_h) VALUES (?, ?, ?, ?)'
  ).run(req.params.id, title, canvas_w, canvas_h);
  res.status(201).json({ id: result.lastInsertRowid, title, canvas_w, canvas_h });
});

// DELETE /api/projects/:id/chats — clear all chats and messages for a project
projectChatsRouter.delete('/:id/chats', (req, res) => {
  const chatRows = db.prepare('SELECT id FROM chats WHERE project_id = ?').all(req.params.id) as { id: number }[];
  const chatIds = chatRows.map((row) => row.id);

  if (chatIds.length > 0) {
    const placeholders = chatIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM conversations WHERE chat_id IN (${placeholders})`).run(...chatIds);
  }

  db.prepare('DELETE FROM chats WHERE project_id = ?').run(req.params.id);
  res.json({ ok: true, deleted: chatIds.length });
});

// Chat-scoped routes: mounted at /api/chats
export const chatsRouter = Router();

// DELETE /api/chats/:chatId — delete a chat and its messages
chatsRouter.delete('/:chatId', (req, res) => {
  db.prepare('DELETE FROM conversations WHERE chat_id = ?').run(req.params.chatId);
  db.prepare('DELETE FROM chats WHERE id = ?').run(req.params.chatId);
  res.json({ ok: true });
});

// DELETE /chats/:chatId/messages — clear messages but keep the chat
chatsRouter.delete('/:chatId/messages', (req, res) => {
  db.prepare('DELETE FROM conversations WHERE chat_id = ?').run(req.params.chatId);
  res.json({ ok: true });
});

// GET /api/chats/:chatId/messages — get messages for a chat
chatsRouter.get('/:chatId/messages', (req, res) => {
  const rows = db.prepare(
    'SELECT id, project_id, chat_id, role, content, images, model, created_at FROM conversations WHERE chat_id = ? ORDER BY created_at ASC'
  ).all(req.params.chatId);
  // Also return compression info
  const chat = db.prepare('SELECT compressed_summary, compress_before_id FROM chats WHERE id = ?').get(req.params.chatId) as any;
  res.json({
    messages: rows,
    compressed_summary: chat?.compressed_summary || null,
    compress_before_id: chat?.compress_before_id || null,
  });
});

// POST /api/chats/:chatId/compress — compress older messages using LLM
chatsRouter.post('/:chatId/compress', async (req, res) => {
  const chatId = Number(req.params.chatId);
  const keepPairs = 2; // keep last N user+assistant pairs (4 messages)

  // Load chat info
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId) as any;
  if (!chat) return res.status(404).json({ error: 'Chat not found' });

  // Load all messages
  const allMessages = db.prepare(
    'SELECT id, role, content, images FROM conversations WHERE chat_id = ? ORDER BY created_at ASC'
  ).all(chatId) as { id: number; role: string; content: string; images: string | null }[];

  // Find the cut point: keep last keepPairs*2 messages
  const keepCount = keepPairs * 2;
  if (allMessages.length <= keepCount) {
    return res.status(400).json({ error: '对话太短，无需压缩' });
  }

  const toCompress = allMessages.slice(0, allMessages.length - keepCount);
  const lastCompressedId = toCompress[toCompress.length - 1].id;

  // Load LLM config
  const configId = typeof req.body?.config_id === 'number' ? req.body.config_id : undefined;
  const config = resolveLLMConfig(configId);
  if (!config?.api_url || !config?.api_token || !config?.model) {
    return res.status(400).json({ error: 'LLM 未配置' });
  }

  // Build compression prompt
  const existingSummary = chat.compressed_summary || '';
  let conversationText = '';
  if (existingSummary) {
    conversationText += `[之前的压缩摘要]\n${existingSummary}\n\n[新增对话]\n`;
  }
  for (const msg of toCompress) {
    // Skip messages already covered by existing summary
    if (chat.compress_before_id && msg.id <= chat.compress_before_id) continue;
    const label = msg.role === 'user' ? '用户' : 'AI';
    // Strip image data from content for compression
    const content = msg.content.length > 2000 ? msg.content.slice(0, 2000) + '...(截断)' : msg.content;
    conversationText += `${label}: ${content}\n`;
  }

  if (!conversationText.trim()) {
    return res.status(400).json({ error: '没有新内容需要压缩' });
  }

  const compressPrompt = `请将以下对话内容压缩为简洁的摘要。保留关键信息、用户意图、AI的绘图结果描述等重要上下文，使AI能够理解之前的对话并继续协作。不要包含具体的绘图指令JSON，只保留语义描述。输出纯文本摘要即可，不要添加额外格式。\n\n${conversationText}`;

  const activeModel = req.body.model || config.model;

  try {
    const apiUrl = config.api_url.replace(/\/$/, '');
    const upstream = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.api_token}`,
      },
      body: JSON.stringify({
        model: activeModel,
        messages: [
          { role: 'system', content: '你是一个对话压缩助手。请将对话内容压缩为简洁的摘要。' },
          { role: 'user', content: compressPrompt },
        ],
        stream: false,
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      return res.status(500).json({ error: `LLM 压缩失败: ${errText}` });
    }

    const body = await upstream.json() as any;
    const summary = body.choices?.[0]?.message?.content || '';
    if (!summary) {
      return res.status(500).json({ error: '压缩结果为空' });
    }

    // Save compression result
    db.prepare(
      'UPDATE chats SET compressed_summary = ?, compress_before_id = ? WHERE id = ?'
    ).run(summary, lastCompressedId, chatId);

    res.json({
      compressed_summary: summary,
      compress_before_id: lastCompressedId,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || '压缩请求失败' });
  }
});
