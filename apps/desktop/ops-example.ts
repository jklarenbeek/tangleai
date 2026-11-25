/**
 * An example host module for the desktop's background runtime:
 *
 *   node apps/desktop/src/main.ts --ops apps/desktop/ops-example.ts
 *
 * A host module exports its job registry (a JSON document, `@tangleai/ops`'s
 * `checkRegistry` format) and the code handlers its `{ code }` jobs name, and
 * optionally contract clients for its `{ contract, operation }` jobs. This one
 * reads how much room the data folder's disk has left, every fifteen minutes;
 * it only reads, so it is safe to repeat.
 */
import { statfs } from 'node:fs/promises';
import { homedir } from 'node:os';

export const registry = {
  $registry: '0.1', name: 'desktop',
  jobs: [{
    kind: 'disk.space',
    title: { en: 'Read the free disk space', nl: 'Vrije schijfruimte lezen' },
    description: { en: 'How much room the disk of the data folder has left.', nl: 'Hoeveel ruimte de schijf van de gegevensmap nog heeft.' },
    handler: { code: 'diskSpace' }, safety: 'safe-read',
    schedule: { utc: '2026-01-01T00:00:00Z', rrule: 'FREQ=MINUTELY;INTERVAL=15' },
  }],
};

export const handlers = {
  async diskSpace() {
    const s = await statfs(homedir());
    return { freeBytes: Number(s.bavail) * Number(s.bsize) };
  },
};
