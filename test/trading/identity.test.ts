import { it } from 'node:test';
import assert from 'node:assert/strict';
import { validateTradingRecord, tradingIdentityOf } from '@tangleai/trading';
import { tradingFixture, value } from './fixtures.ts';
const fixture = await tradingFixture();

it('record addresses, revisions and returned data are immutable and byte-deterministic', async () => {
  assert.ok((await validateTradingRecord(fixture.manifest)).valid);
  const changed = { ...fixture.manifest, initialCapital: 200000 };
  const rejected = await validateTradingRecord(changed); assert.equal(rejected.valid, false);
  if (!rejected.valid) assert.deepEqual([rejected.issues[0].code, rejected.issues[0].path], ['TTRD1002', '/id']);
  const reidentified = { ...changed, ...await tradingIdentityOf(changed) }; assert.ok((await validateTradingRecord(reidentified)).valid);
  const wrongRevision = await validateTradingRecord({ ...fixture.manifest, revision: 'f'.repeat(64) });
  assert.equal(wrongRevision.valid, false);
  if (!wrongRevision.valid) assert.deepEqual([wrongRevision.issues[0].code, wrongRevision.issues[0].path], ['TTRD1002', '/revision']);
  assert.deepEqual(await tradingIdentityOf(Object.fromEntries(Object.entries(fixture.manifest).reverse()) as typeof fixture.manifest),
    await tradingIdentityOf(fixture.manifest));
  assert.ok(Object.isFrozen(fixture.manifest)); assert.ok(Object.isFrozen(fixture.manifest.assets));
  const second = await tradingFixture(); assert.deepEqual(second, fixture);
  assert.throws(() => value({ valid: false, issues: [{ code: 'TTRD1001', path: '', detail: 'fixture failure' }] }));
});
