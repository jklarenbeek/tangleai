import { it } from 'node:test';
import assert from 'node:assert/strict';
import { validateTradingRecord, createTradingRecord } from '@tangleai/trading';
import { tradingFixture } from './fixtures.ts';
const fixture = await tradingFixture();
it('trading schemas refuse unknown fields, missing availability, invalid times and unsupported leverage', async () => {
  const missing = { ...fixture.observations[0] } as Record<string, unknown>; delete missing.availableAt;
  for (const [input, path] of [[{ ...fixture.manifest, extra: true }, '/extra'], [{ ...fixture.manifest, shorting: true }, '/shorting'],
    [missing, '/availableAt'], [{ ...fixture.observations[0], availableAt: '2020-01-01T00:00:00Z' }, '/availableAt'],
    [{ ...fixture.initial, positions: [{ ...fixture.initial.positions[0], quantity: -1 }] }, '/positions/0/quantity']] as const) {
    const result = await validateTradingRecord(input); assert.equal(result.valid, false);
    if (!result.valid) { assert.equal(result.issues[0].code, 'TTRD1001'); assert.equal(result.issues[0].path, path); }
  }
  const { id: _id, revision: _revision, kind: _kind, ...body } = fixture.observations[0];
  const invalid = await createTradingRecord('bar', { ...body, availableAt: '2025-02-30T00:00:00Z' } as never);
  assert.equal(invalid.valid, false); if (!invalid.valid) assert.equal(invalid.issues[0].path, '/availableAt');
});
