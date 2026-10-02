import { it } from 'node:test';
import assert from 'node:assert/strict';
import { admit, sessionIndex, sessionAt, nextSession, cutoffFor, latestBarsAsOf, tradingIdentityOf } from '@tangleai/trading';
import type { BarObservation } from '@tangleai/trading';
import { tradingFixture, value } from './fixtures.ts';

const fixture = await tradingFixture();
it('all withheld observations refuse at every fixture cutoff and admit at their publication instant', async () => {
  for (const session of fixture.sessions) {
    const result = value(await admit(fixture.poison, session.closeAt));
    assert.equal(result.admitted.length, 0); assert.equal(result.refused.length, 3);
    assert.deepEqual(result.refused.map(r => [r.id, r.reason, r.issue.code]), fixture.poison.map(o => [o.id, 'TTRD1003', 'TTRD1003']));
  }
  for (const observation of fixture.poison) {
    assert.deepEqual(value(await admit([observation], observation.availableAt)).admitted, [observation]);
    assert.equal(value(await admit([observation], '2025-07-02T00:00:00Z')).refused.length, 0);
  }
});
it('native backward joins preserve missing assets and publication boundaries, including UTC offsets', async () => {
  const bars = fixture.observations.filter(o => o.kind === 'bar');
  const before = value(await latestBarsAsOf(bars, fixture.sessions[0].closeAt, [...fixture.manifest.assets, 'MISSING']));
  assert.equal(before.missing, 3); assert.ok(before.rows.every(r => r.bar === null));
  const after = value(await latestBarsAsOf(bars, '2025-01-02T22:15:00+01:00', [...fixture.manifest.assets, 'MISSING']));
  assert.equal(after.missing, 1); assert.equal(after.rows[0].bar?.id, bars[0].id); assert.equal(after.rows.at(-1)?.bar, null);
  assert.equal(value(await latestBarsAsOf(bars, '2025-01-02T21:14:59Z', ['SYN-A'])).missing, 1);
});
it('calendar intervals preserve explicit close cutoffs and refuse inverted, disconnected and foreign sessions', async () => {
  const index = value(await sessionIndex(fixture.sessions));
  assert.equal(value(sessionAt(index, fixture.sessions[0].openAt)).id, fixture.sessions[0].id);
  assert.equal(sessionAt(index, fixture.sessions[0].closeAt).valid, false);
  assert.equal(value(cutoffFor(fixture.sessions[0], fixture.manifest)), fixture.sessions[0].closeAt);
  assert.equal(value(nextSession(index, fixture.sessions[0].key))?.id, fixture.sessions[1].id);
  assert.equal(value(nextSession(index, fixture.sessions.at(-1)!.key)), null);
  assert.equal(nextSession(index, 'missing').valid, false);
  for (const delta of [{ closeAt: fixture.sessions[0].openAt }, { closeAt: '2025-01-01T00:00:00Z' }, { next: null }, { manifestId: 'foreign-run' }]) {
    const changed = { ...fixture.sessions[0], ...delta };
    const rejected = await sessionIndex([{ ...changed, ...await tradingIdentityOf(changed) }, ...fixture.sessions.slice(1)]);
    assert.equal(rejected.valid, false); if (!rejected.valid) assert.equal(rejected.issues[0].code, 'TTRD1001');
  }
});
it('admission takes one detached input snapshot before asynchronous identity checks', async () => {
  const input = structuredClone(fixture.observations.slice(0, 2));
  const pending = admit(input, '2025-01-04T00:00:00Z');
  input[1].availableAt = '2099-01-01T00:00:00Z';
  const admitted = value(await pending);
  assert.deepEqual(admitted.admitted, fixture.observations.slice(0, 2));
});
it('bar selection refuses a release masquerading as a bar as a content error', async () => {
  const result = await latestBarsAsOf(fixture.poison.filter(o => o.kind !== 'bar') as unknown as BarObservation[], '2025-07-02T00:00:00Z', ['SYN-A']);
  assert.equal(result.valid, false); if (!result.valid) assert.equal(result.issues[0].code, 'TTRD1001');
});
