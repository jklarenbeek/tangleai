/** The twin harness's registry and task contract: a safe read every second, and a single-send page task every second. */
import { desktopTaskContract } from '../../../packages/ops/src/browser.ts';
import type { JobRegistry } from '../../../packages/ops/src/registry.ts';

export const CHANNEL = 'ops-twin', LOCK = 'ops-twin-owner', DATABASE = 'ops-twin.db', POOL = 'ops-twin';
export const TASKS = desktopTaskContract({ 'ping.send': { doc: 'Send one ping (the harness counts it).' } });
export const registry = (): JobRegistry => {
  const midnight = new Date(); midnight.setUTCHours(0, 0, 0, 0);
  const utc = midnight.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return {
    $registry: '0.1', name: 'twin',
    jobs: [
      { kind: 'tick.read', title: { en: 'Read' }, handler: { code: 'read' }, safety: 'safe-read', limits: { leaseMs: 3000 }, schedule: { utc, rrule: 'FREQ=SECONDLY' } },
      { kind: 'ping.send', title: { en: 'Send a ping' }, handler: { contract: 'desktop', operation: 'ping.send' }, safety: 'single-send', limits: { leaseMs: 3000 }, schedule: { utc, rrule: 'FREQ=SECONDLY' } },
    ],
  };
};
