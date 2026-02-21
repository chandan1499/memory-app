import cron from 'node-cron';
import twilio from 'twilio';
import { getUndoneMem, recordSent } from './db.js';
import { decideReminders } from './ai.js';

const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

function formatDate(dateStr) {
  if (!dateStr) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (dateStr === today) return 'Today';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function buildMessage(memories) {
  const lines = ['🧠 *Memory Reminder*\n'];
  for (const m of memories) {
    const cat = { task: '✅', note: '📝', event: '📅', person: '👤' }[m.type] || '📌';
    lines.push(`${cat} *${m.title}*`);
    if (m.dueDate) lines.push(`   Due: ${formatDate(m.dueDate)} · Urgency: ${m.urgency}/10`);
    else            lines.push(`   Urgency: ${m.urgency}/10`);
    if (m.detail)   lines.push(`   ${m.detail}`);
    lines.push('');
  }
  lines.push('Reply: *done [task]* · *snooze [task]* · *list* · *help*');
  return lines.join('\n');
}

async function runScheduler() {
  try {
    const idsToSend = await decideReminders();
    if (!idsToSend.length) {
      console.log('[scheduler] No reminders to send this run.');
      return;
    }

    const allUndone = getUndoneMem();
    const toSend = idsToSend
      .map(id => allUndone.find(m => m.id === id))
      .filter(Boolean);

    if (!toSend.length) return;

    const body = buildMessage(toSend);
    await client.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to:   `whatsapp:${process.env.MY_WHATSAPP_NUMBER}`,
      body,
    });

    for (const m of toSend) recordSent(m.id);
    console.log(`[scheduler] Sent ${toSend.length} reminder(s): ${toSend.map(m => m.title).join(', ')}`);
  } catch (err) {
    console.error('[scheduler] Error:', err.message);
  }
}

export function startScheduler() {
  // Run hourly (at minute 0 of every hour)
  cron.schedule('0 * * * *', runScheduler, {
    timezone: process.env.TZ || 'Asia/Kolkata',
  });
  console.log('[scheduler] Started — runs every hour.');
}

// Export for manual trigger from server (testing)
export { runScheduler };
