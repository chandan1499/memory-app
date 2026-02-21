import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'memories.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    done INTEGER DEFAULT 0,
    due_date TEXT,
    urgency REAL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reminders_sent (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    day_key TEXT NOT NULL,
    UNIQUE(memory_id, day_key)
  );
`);

// ── Memories ────────────────────────────────────────────────────────────────

export function upsertMemory(mem) {
  const stmt = db.prepare(`
    INSERT INTO memories (id, type, title, detail, tags, done, due_date, urgency, created_at, updated_at)
    VALUES (@id, @type, @title, @detail, @tags, @done, @due_date, @urgency, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      type       = excluded.type,
      title      = excluded.title,
      detail     = excluded.detail,
      tags       = excluded.tags,
      done       = excluded.done,
      due_date   = excluded.due_date,
      urgency    = excluded.urgency,
      updated_at = excluded.updated_at
  `);
  stmt.run({
    id:         mem.id,
    type:       mem.type || 'note',
    title:      mem.title || '',
    detail:     mem.detail || '',
    tags:       JSON.stringify(mem.tags || []),
    done:       mem.done ? 1 : 0,
    due_date:   mem.dueDate || mem.due_date || null,
    urgency:    mem.urgency || 0,
    created_at: mem.createdAt || mem.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

export function deleteMemory(id) {
  db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  db.prepare('DELETE FROM reminders_sent WHERE memory_id = ?').run(id);
}

export function getAllMemories() {
  return db.prepare('SELECT * FROM memories ORDER BY created_at DESC').all().map(toFrontend);
}

export function getUndoneMem() {
  return db.prepare("SELECT * FROM memories WHERE done = 0 ORDER BY urgency DESC").all().map(toFrontend);
}

export function markDone(id) {
  db.prepare("UPDATE memories SET done = 1, updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
}

export function updateUrgency(id, urgency) {
  db.prepare("UPDATE memories SET urgency = ?, updated_at = ? WHERE id = ?")
    .run(urgency, new Date().toISOString(), id);
}

// ── Reminders sent ───────────────────────────────────────────────────────────

export function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

export function alreadySentToday(memoryId) {
  const row = db.prepare(
    'SELECT 1 FROM reminders_sent WHERE memory_id = ? AND day_key = ?'
  ).get(memoryId, todayKey());
  return !!row;
}

export function recordSent(memoryId) {
  db.prepare(
    'INSERT OR IGNORE INTO reminders_sent (memory_id, sent_at, day_key) VALUES (?, ?, ?)'
  ).run(memoryId, new Date().toISOString(), todayKey());
}

export function clearSentForMemory(memoryId) {
  db.prepare(
    'DELETE FROM reminders_sent WHERE memory_id = ? AND day_key = ?'
  ).run(memoryId, todayKey());
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toFrontend(row) {
  return {
    id:        row.id,
    type:      row.type,
    title:     row.title,
    detail:    row.detail,
    tags:      JSON.parse(row.tags || '[]'),
    done:      row.done === 1,
    dueDate:   row.due_date || null,
    urgency:   row.urgency || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default db;
