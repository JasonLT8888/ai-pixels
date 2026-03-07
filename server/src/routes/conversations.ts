import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

// GET /api/projects/:id/conversations — get conversation history
router.get('/:id/conversations', (req, res) => {
  const rows = db.prepare(
    'SELECT id, project_id, role, content, images, created_at FROM conversations WHERE project_id = ? ORDER BY created_at ASC'
  ).all(req.params.id);
  res.json(rows);
});

// POST /api/projects/:id/conversations — append a message
router.post('/:id/conversations', (req, res) => {
  const { role, content, images } = req.body;
  if (!role || !content) {
    return res.status(400).json({ error: 'role and content are required' });
  }
  const result = db.prepare(
    'INSERT INTO conversations (project_id, role, content, images) VALUES (?, ?, ?, ?)'
  ).run(req.params.id, role, content, images ?? null);
  res.status(201).json({ id: result.lastInsertRowid });
});

export default router;
