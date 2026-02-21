import Groq from 'groq-sdk';
import { getUndoneMem, updateUrgency, alreadySentToday } from './db.js';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── Urgency scoring ──────────────────────────────────────────────────────────

export async function scoreUrgency(memories) {
  if (!memories.length) return;

  const today = new Date().toISOString().slice(0, 10);
  const items = memories.map(m => ({
    id: m.id,
    type: m.type,
    title: m.title,
    detail: m.detail,
    dueDate: m.dueDate || null,
    done: m.done,
  }));

  const prompt = `Today is ${today}.
Score each memory's urgency from 0 to 10:
- 10 = due today or overdue
- 8-9 = due within 2 days
- 6-7 = due within a week
- 4-5 = due within 2 weeks, OR title has "urgent/pay/submit/call/deadline"
- 2-3 = vague notes, events far away
- 0-1 = person info, done items, non-actionable notes

Memories (JSON):
${JSON.stringify(items, null, 2)}

Respond ONLY with a JSON array: [{"id":"...","urgency":8.5}, ...]
No markdown, no explanation.`;

  try {
    const res = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = res.choices[0].message.content.replace(/```json|```/g, '').trim();
    const scores = JSON.parse(raw);
    for (const { id, urgency } of scores) {
      if (id && typeof urgency === 'number') {
        updateUrgency(id, Math.min(10, Math.max(0, urgency)));
      }
    }
  } catch (err) {
    console.error('[ai] scoreUrgency error:', err.message);
  }
}

// ── Reminder decision ────────────────────────────────────────────────────────

export async function decideReminders() {
  const undone = getUndoneMem();
  const candidates = undone.filter(m => m.urgency >= 4 && !alreadySentToday(m.id));

  if (!candidates.length) return [];

  const hour = new Date().getHours(); // local hour (set TZ env var)
  const today = new Date().toISOString().slice(0, 10);

  const prompt = `Current time: ${hour}:00, date: ${today}.
You are a smart reminder system. Select which tasks to send WhatsApp reminders for RIGHT NOW.

Rules:
- Max 3 reminders per run
- Prefer tasks due today or tomorrow
- Do NOT send reminders before 9am or after 10pm UNLESS urgency >= 9
- Silence is better than spam — only send if genuinely useful
- If no tasks are urgent enough, return empty array

Candidate tasks (JSON):
${JSON.stringify(candidates.map(m => ({
  id: m.id,
  title: m.title,
  detail: m.detail,
  dueDate: m.dueDate,
  urgency: m.urgency,
})), null, 2)}

Respond ONLY with a JSON array of IDs to remind about: ["id1","id2"]
No markdown, no explanation.`;

  try {
    const res = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = res.choices[0].message.content.replace(/```json|```/g, '').trim();
    const ids = JSON.parse(raw);
    if (!Array.isArray(ids)) return [];
    // Only return IDs that are actually in our candidates list (safety guard)
    const validIds = new Set(candidates.map(m => m.id));
    return ids.filter(id => validIds.has(id)).slice(0, 3);
  } catch (err) {
    console.error('[ai] decideReminders error:', err.message);
    return [];
  }
}

// ── Fuzzy match for "done <task>" replies ────────────────────────────────────

export function fuzzyMatch(query, memories) {
  const q = query.toLowerCase().trim();
  let best = null, bestScore = 0;

  for (const m of memories) {
    const title = m.title.toLowerCase();
    // Exact substring → score 100
    if (title.includes(q) || q.includes(title)) {
      const score = 100;
      if (score > bestScore) { bestScore = score; best = m; }
      continue;
    }
    // Word overlap score
    const qWords = new Set(q.split(/\s+/).filter(w => w.length > 2));
    const tWords = new Set(title.split(/\s+/).filter(w => w.length > 2));
    let overlap = 0;
    for (const w of qWords) { if (tWords.has(w)) overlap++; }
    const score = qWords.size ? Math.round((overlap / qWords.size) * 80) : 0;
    if (score > bestScore) { bestScore = score; best = m; }
  }

  return bestScore >= 30 ? best : null;
}
