/**
 * The browser twin's names and the contract the page serves to its worker —
 * kept apart from the task handlers so the worker's own script carries
 * nothing of the page (no calendar, no messages).
 */
import type { JobRegistry } from '@tangleai/ops';

/** The twin's names in this browser: its channel, its owner lock and its store. */
export const TWIN = { channel: 'tangle-ops-twin', lock: 'tangle-ops-owner', database: 'tangle-ops.db', pool: 'tangle-ops' } as const;

/** The contract the page serves to its twin's worker. */
export const DESKTOP_TASKS_CONTRACT = {
  $contract: '0.1',
  id: 'desktop',
  operations: {
    'reminders.notify': {
      kind: 'command', doc: 'File one inbox message per calendar event starting within 15 minutes, never two for one occurrence.',
      input: { type: 'object' },
      output: { type: 'object', additionalProperties: false, required: ['sent', 'upcoming'], properties: { sent: { type: 'integer', minimum: 0 }, upcoming: { type: 'integer', minimum: 0 } } },
    },
    'tidy.count': {
      kind: 'read', doc: 'Count the read inbox messages older than 30 days; delete nothing.',
      input: { type: 'object' },
      output: { type: 'object', additionalProperties: false, required: ['old'], properties: { old: { type: 'integer', minimum: 0 } } },
    },
  },
} as const;

/** The registry in this browser's time zone (a static document cannot know it). */
export function localRegistry(doc: JobRegistry, zone: string | undefined): JobRegistry {
  return zone ? { ...doc, zone } : doc;
}
