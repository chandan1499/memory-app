import 'dotenv/config';
import express from 'express';
import twilio from 'twilio';
import {
  upsertMemory, deleteMemory, getAllMemories, getUndoneMem,
  markDone, recordSent, clearSentForMemory,
} from './db.js';
import { scoreUrgency, fuzzyMatch } from './ai.js';
import { startScheduler, runScheduler } from './scheduler.js';

const app  = express();
const PORT = process.env.PORT || 8080;

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Twilio sends URL-encoded

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = process.env.FRONTEND_ORIGIN || '';
  // Allow configured origin or any localhost for dev
  if (!origin || allowed === '*' || origin === allowed || origin?.includes('localhost')) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ── Memories API ──────────────────────────────────────────────────────────────

// GET all memories (for focus-poll reconciliation)
app.get('/api/memories', (_req, res) => {
  try {
    res.json(getAllMemories());
  } catch (err) {
    console.error('[GET /api/memories]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST upsert memory from frontend
app.post('/api/memories', async (req, res) => {
  try {
    const mem = req.body;
    if (!mem?.id || !mem?.title) return res.status(400).json({ error: 'id and title required' });
    upsertMemory(mem);

    // Fire-and-forget urgency scoring after upsert
    const undone = getUndoneMem();
    scoreUrgency(undone).catch(e => console.error('[urgency bg]', e.message));

    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/memories]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE memory
app.delete('/api/memories/:id', (req, res) => {
  try {
    deleteMemory(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/memories]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Manual scheduler trigger (dev / testing)
app.post('/api/trigger-reminders', async (_req, res) => {
  try {
    await runScheduler();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Twilio WhatsApp Webhook ───────────────────────────────────────────────────

const twiml = twilio.twiml;

function twimlReply(res, text) {
  const r = new twiml.MessagingResponse();
  r.message(text);
  res.type('text/xml').send(r.toString());
}

const SNOOZE_HOURS = parseInt(process.env.SNOOZE_HOURS || '4', 10);

app.post('/api/webhook/whatsapp', (req, res) => {
  const body = (req.body.Body || '').trim();
  const cmd  = body.toLowerCase();

  // ── help ────────────────────────────────────────────────────────────────────
  if (cmd === 'help') {
    return twimlReply(res,
      '🧠 *Memory Bot Commands*\n\n' +
      '• *done [task]* — mark a task as done\n' +
      '• *snooze [task]* — skip reminder for today, re-remind in ' + SNOOZE_HOURS + 'h\n' +
      '• *list* — show top 10 tasks by urgency\n' +
      '• *help* — show this menu'
    );
  }

  // ── list ─────────────────────────────────────────────────────────────────────
  if (cmd === 'list') {
    const items = getUndoneMem().slice(0, 10);
    if (!items.length) return twimlReply(res, '✅ No pending tasks!');
    const lines = items.map((m, i) => {
      const due = m.dueDate ? ` · Due ${m.dueDate}` : '';
      return `${i + 1}. ${m.title}${due} (${m.urgency}/10)`;
    });
    return twimlReply(res, '📋 *Your Tasks*\n\n' + lines.join('\n'));
  }

  // ── done [task] ──────────────────────────────────────────────────────────────
  if (cmd.startsWith('done ')) {
    const query   = body.slice(5).trim();
    const undone  = getUndoneMem();
    const matched = fuzzyMatch(query, undone);
    if (!matched) return twimlReply(res, `❓ Couldn't find a task matching "${query}". Try *list* to see tasks.`);
    markDone(matched.id);
    return twimlReply(res, `✅ Marked as done: *${matched.title}*`);
  }

  // ── snooze [task] ────────────────────────────────────────────────────────────
  if (cmd.startsWith('snooze ')) {
    const query   = body.slice(7).trim();
    const undone  = getUndoneMem();
    const matched = fuzzyMatch(query, undone);
    if (!matched) return twimlReply(res, `❓ Couldn't find a task matching "${query}". Try *list* to see tasks.`);

    // Record sent for today → prevents further reminder today
    // Then schedule un-suppress after SNOOZE_HOURS
    recordSent(matched.id);
    setTimeout(() => {
      clearSentForMemory(matched.id);
      console.log(`[snooze] Re-enabled reminders for: ${matched.title}`);
    }, SNOOZE_HOURS * 60 * 60 * 1000);

    return twimlReply(res, `⏰ Snoozed *${matched.title}* for ${SNOOZE_HOURS} hours.`);
  }

  // ── unknown ──────────────────────────────────────────────────────────────────
  return twimlReply(res,
    `🤔 I didn't understand that. Try:\n• *done [task]*\n• *snooze [task]*\n• *list*\n• *help*`
  );
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT}`);
  startScheduler();
});
