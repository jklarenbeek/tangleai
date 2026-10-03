import { once } from 'node:events';
import { openTangleDb, createResearchStore } from '@tangleai/store';
import type { StateTransitionPlan } from '@tangleai/research';

const db = await openTangleDb({ path: process.argv[2] });
try {
  const plan = JSON.parse(process.argv[3]) as StateTransitionPlan;
  const released = once(process.stdin, 'data');
  process.stdout.write('ready\n'); await released; process.stdin.pause();
  process.stdout.write(JSON.stringify(await createResearchStore(db).transition(plan)) + '\n');
} finally { await db.close(); }
