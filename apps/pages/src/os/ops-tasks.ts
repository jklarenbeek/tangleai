/**
 * The browser twin's desktop side: where the twin keeps its store and how
 * the tabs find it, and the tasks the page serves to the twin's worker ("tools
 * in reverse": a scheduled job calls an operation of the page that owns the
 * runtime, over the worker's own port).
 *
 * - `reminders.notify` files one inbox message per calendar event that starts
 *   within 15 minutes, keyed by the event occurrence (the calendar's uid and
 *   its recurrence), never two: the keys it sent are kept in this browser's
 *   storage, so a run in another tab after a takeover sends nothing twice.
 * - `tidy.count` counts the read inbox messages older than 30 days and deletes
 *   nothing.
 *
 * The messages land in the inbox of the tab whose worker owns the runtime.
 */
import type { Kernel } from '@tangleai/os';
import { addDays, isoDate, occurrences, type CalendarDocument } from './calendar-model.ts';
import { t, pagesLanguage } from './i18n.ts';
export { TWIN, DESKTOP_TASKS_CONTRACT } from './ops-twin.ts';

const CALENDAR = 'tangle-calendar';
const SENT = 'tangle-reminders-sent';
const KEEP = 500;
const WINDOW_MS = 15 * 60_000;

/** The calendar's occurrences that start in `[now, now + 15 min)`, each with its occurrence key. */
export function upcoming(doc: CalendarDocument, now: Date): { key: string, title: string, at: Date }[] {
  const today = isoDate(now);
  const out: { key: string, title: string, at: Date }[] = [];
  for (const o of occurrences(doc, today, addDays(today, 2))) {
    if (o.allDay) continue;
    const [h, m] = o.start.split(':').map(Number);
    const [y, mo, d] = o.date.split('-').map(Number);
    const at = new Date(y, mo - 1, d, h, m);
    const delta = at.getTime() - now.getTime();
    if (delta >= 0 && delta < WINDOW_MS) out.push({ key: `${o.uid}@${o.recurrenceId}`, title: o.title, at });
  }
  return out;
}

/** The page's handlers for {@link DESKTOP_TASKS_CONTRACT}. */
export function desktopTasks(host: { kernel: Kernel, storage?: Storage | null, now?: () => number }): Record<string, (input: any) => Promise<unknown>> {
  const now = host.now ?? Date.now;
  const read = <T>(key: string, fallback: T): T => { try { const v = JSON.parse(host.storage?.getItem(key) ?? 'null'); return v ?? fallback; } catch { return fallback; } };
  return {
    async 'reminders.notify'() {
      const doc = read<CalendarDocument | null>(CALENDAR, null);
      if (!doc || doc.$calendar !== '0.1') return { sent: 0, upcoming: 0 };
      const soon = upcoming(doc, new Date(now()));
      const sent: string[] = read<string[]>(SENT, []);
      let filed = 0;
      for (const event of soon) {
        if (sent.includes(event.key)) continue;
        // the key is written before the message, so a crash between the two loses a reminder rather than doubling it
        sent.push(event.key);
        try { host.storage?.setItem(SENT, JSON.stringify(sent.slice(-KEEP))); } catch { /* storage full: the inbox still gets it once in this tab */ }
        const time = new Intl.DateTimeFormat(pagesLanguage(), { hour: 'numeric', minute: '2-digit' }).format(event.at);
        host.kernel.sendMail('calendar', { subject: t('jobhost/reminder', { title: event.title, time }), body: t('jobhost/reminder-body'), data: { reminder: event.key } });
        filed++;
      }
      return { sent: filed, upcoming: soon.length };
    },
    async 'tidy.count'() {
      const before = now() - 30 * 86_400_000;
      return { old: host.kernel.mail().filter(m => m.read && m.at < before).length };
    },
  };
}
