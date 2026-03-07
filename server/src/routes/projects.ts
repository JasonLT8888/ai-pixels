import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

// GET /api/projects — list all projects
router.get('/', (_req, res) => {
  const projects = db.prepare(
    'SELECT id, name, canvas_w, canvas_h, thumbnail, created_at, updated_at FROM projects ORDER BY updated_at DESC'
  ).all();
  res.json(projects);
});

// POST /api/projects — create a new project
router.post('/', (req, res) => {
  const { name = 'Untitled', canvas_w = 32, canvas_h = 32 } = req.body;
  const result = db.prepare(
    'INSERT INTO projects (name, canvas_w, canvas_h) VALUES (?, ?, ?)'
  ).run(name, canvas_w, canvas_h);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(project);
});

// GET /api/projects/:id — get project detail
router.get('/:id', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

// PUT /api/projects/:id/instructions — save instructions
router.put('/:id/instructions', (req, res) => {
  const { instructions } = req.body;
  if (!Array.isArray(instructions)) {
    return res.status(400).json({ error: 'instructions must be an array' });
  }
  const result = db.prepare(
    'UPDATE projects SET instructions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(JSON.stringify(instructions), req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Project not found' });
  res.json({ ok: true });
});

export default router;
