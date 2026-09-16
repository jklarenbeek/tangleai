import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createOutcomeStore, openTangleDb } from '@tangleai/store';
import { runOutcomeExample } from '../../examples/outcomes.ts';
import { loadOutcomeFixtures } from '../../benchmark/lib/outcome-fixtures.ts';
import { measureOutcomeReplay } from '../../benchmark/lib/outcome-runtime.ts';
import { measureOutcomeTransports } from '../../benchmark/lib/outcome-transports.ts';

// A hang guard, not a performance bound. This raises six transports and
// replays one complete business trace: ~52s on an idle machine, and more
// when the suite runs four files wide, where a 60s guard cancelled it.
// Every collection added to the shared database model is paid again at
// every open here — the four evolve collections measured ~7s of it.
it('public direct, local and HTTP handlers yield identical complete business traces and zero-effect replay', { timeout: 180000 }, async () => {
  const f = await loadOutcomeFixtures(), expected = await measureOutcomeReplay(f, { mode: 'checked-scripted' });
  const { probes } = await measureOutcomeTransports(f, expected.trace); assert.equal(probes.length, 6);
  for (const p of probes) assert.ok(p.holds, JSON.stringify(p));
});
it('both-domain public example survives file reopen and a new process with zero new effects', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'outcome-example-')), path = join(dir, 'outcome.db');
  try {
    let db = await openTangleDb({ path });
    const first = await runOutcomeExample(createOutcomeStore(db)); await db.close();
    db = await openTangleDb({ path }); const second = await runOutcomeExample(createOutcomeStore(db)); await db.close();
    assert.ok(first.writes > 0 && first.sourceReads > 0);
    assert.equal(second.writes, 0); assert.equal(second.sourceReads, 0); assert.deepEqual(second.ids, first.ids); assert.equal(second.replayed, 28);
    const third = JSON.parse(execFileSync(process.execPath, ['examples/outcomes.ts', '--db', path], { encoding: 'utf8' }));
    assert.equal(third.writes, 0); assert.equal(third.sourceReads, 0); assert.deepEqual(third.ids, first.ids);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
