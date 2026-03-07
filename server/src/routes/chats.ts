import { Router } from 'express';
import db from '../db/index.js';

// Project-scoped routes: mounted at /api/projects
export const projectChatsRouter = Router();

// GET /api/projects/:id/chats — list all chats for a project
projectChatsRouter.get('/:id/chats', (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.title, c.canvas_w, c.canvas_h, c.created_at,
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
  res.json(rows);
});
