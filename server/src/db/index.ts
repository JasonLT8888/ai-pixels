import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_SYSTEM_PROMPT } from 'shared/src/default-prompt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', '..', 'data', 'ai-pixels.db');

// Ensure data directory exists
import fs from 'fs';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS llm_config (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL DEFAULT '默认配置',
    api_url    TEXT NOT NULL DEFAULT '',
    api_token  TEXT NOT NULL DEFAULT '',
    model      TEXT NOT NULL DEFAULT '',
    is_active  INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS system_prompt (
    id         INTEGER PRIMARY KEY DEFAULT 1,
    content    TEXT NOT NULL DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projects (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    canvas_w     INTEGER NOT NULL DEFAULT 32,
    canvas_h     INTEGER NOT NULL DEFAULT 32,
    instructions TEXT NOT NULL DEFAULT '[]',
    thumbnail    TEXT,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    images     TEXT,
    model      TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chats (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title      TEXT NOT NULL DEFAULT '新对话',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migration: add model column if missing (for existing DBs)
try {
  db.exec(`ALTER TABLE conversations ADD COLUMN model TEXT`);
} catch {
  // column already exists
}

// Migration: add chat_id to conversations
try {
  db.exec(`ALTER TABLE conversations ADD COLUMN chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE`);
} catch {
  // column already exists
}

// Migration: add canvas_w, canvas_h to chats
try {
  db.exec(`ALTER TABLE chats ADD COLUMN canvas_w INTEGER NOT NULL DEFAULT 32`);
} catch { /* already exists */ }
try {
  db.exec(`ALTER TABLE chats ADD COLUMN canvas_h INTEGER NOT NULL DEFAULT 32`);
} catch { /* already exists */ }

// Migration: add compression fields to chats
try {
  db.exec(`ALTER TABLE chats ADD COLUMN compressed_summary TEXT`);
} catch { /* already exists */ }
try {
  db.exec(`ALTER TABLE chats ADD COLUMN compress_before_id INTEGER`);
} catch { /* already exists */ }

// Migration: add context_window and compress_threshold to llm_config
try {
  db.exec(`ALTER TABLE llm_config ADD COLUMN context_window INTEGER NOT NULL DEFAULT 0`);
} catch { /* already exists */ }
try {
  db.exec(`ALTER TABLE llm_config ADD COLUMN compress_threshold INTEGER NOT NULL DEFAULT 1000`);
} catch { /* already exists */ }
try {
  db.exec(`ALTER TABLE llm_config ADD COLUMN name TEXT NOT NULL DEFAULT '默认配置'`);
} catch { /* already exists */ }
try {
  db.exec(`ALTER TABLE llm_config ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0`);
} catch { /* already exists */ }

db.prepare(
  `UPDATE llm_config
   SET name = CASE
     WHEN TRIM(COALESCE(name, '')) = '' THEN '默认配置'
     ELSE name
   END`
).run();

const activeConfigRow = db.prepare(
  'SELECT id FROM llm_config WHERE is_active = 1 ORDER BY updated_at DESC, id ASC LIMIT 1'
).get() as { id: number } | undefined;
if (!activeConfigRow) {
  const fallbackConfigRow = db.prepare(
    'SELECT id FROM llm_config ORDER BY updated_at DESC, id ASC LIMIT 1'
  ).get() as { id: number } | undefined;

  if (fallbackConfigRow) {
    db.prepare('UPDATE llm_config SET is_active = CASE WHEN id = ? THEN 1 ELSE 0 END').run(fallbackConfigRow.id);
  }
}

// Migration: assign orphan messages to a default chat per project
const orphanProjects = db.prepare(
  `SELECT DISTINCT project_id FROM conversations WHERE chat_id IS NULL`
).all() as { project_id: number }[];
for (const { project_id } of orphanProjects) {
  const chat = db.prepare(
    `INSERT INTO chats (project_id, title) VALUES (?, '默认对话')`
  ).run(project_id);
  db.prepare(
    `UPDATE conversations SET chat_id = ? WHERE project_id = ? AND chat_id IS NULL`
  ).run(chat.lastInsertRowid, project_id);
}

// Seed default system prompt if not present (empty — hardcoded default is always prepended)
db.prepare(
  'INSERT OR IGNORE INTO system_prompt (id, content) VALUES (1, ?)'
).run('');

export default db;
