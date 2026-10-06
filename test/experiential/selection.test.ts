import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { planExperientialSelection, sealExperientialRecord, type ExperientialExclusionReason } from '@tangleai/experiential';
import { accepted } from './identity-fixtures.ts';
import { selectionFixture, selectionNegative } from './selection-fixtures.ts';

it('every exclusion fixture has one stable reason and the clean cohort selects twelve', async () => {
  const folder = new URL('../fixtures/experiential/selection/', import.meta.url);
  for (const file of (await readdir(folder)).sort()) {
    const fixture = JSON.parse(await readFile(new URL(file, folder), 'utf8'));
    if (!fixture.mutation) continue;
    const input = await selectionNegative(fixture.mutation as ExperientialExclusionReason);
    const plan = accepted(await planExperientialSelection(input));
    assert.deepEqual([...plan.excluded, ...plan.quarantined].map(row => row.reason), [fixture.expected], file);
    assert.equal(plan.counts.selected + plan.counts.excluded + plan.counts.quarantined, 1);
    assert.equal(Object.values(plan.counts.byReason).reduce((n, x) => n + x, 0), 1);
  }
  const input = await selectionFixture(12), plan = accepted(await planExperientialSelection(input));
  assert.equal(plan.counts.input, 12); assert.equal(plan.counts.selected, 12);
  assert.equal(plan.counts.excluded, 0); assert.equal(plan.counts.quarantined, 0);
  assert.deepEqual(await planExperientialSelection(input), await planExperientialSelection(input));
  assert.ok(Object.isFrozen(plan.evidence.trustView.sources));
});

it('a model assessment needs independent selection authority bound to its exact content', async () => {
  const input = await selectionNegative('model-approved');
  const ordinary = await selectionFixture();
  input.approvals = [{ ...ordinary.approvals[0], assessmentId: input.assessments[0].id }];
  assert.equal(accepted(await planExperientialSelection(input)).counts.selected, 1);
  input.approvals[0].principal.id = input.trustView.producers[0].producerId;
  assert.equal(accepted(await planExperientialSelection(input)).excluded[0].reason, 'model-approved');
  input.approvals = [{ ...ordinary.approvals[0], action: 'activate' } as never];
  assert.equal((await planExperientialSelection(input)).ok, false);
});

it('forged record addresses, altered policies and changing inputs cannot rewrite approval', async () => {
  const input = await selectionFixture();
  const first = planExperientialSelection(input);
  input.assessments[0].generalizable = false;
  assert.equal(accepted(await first).counts.selected, 1);
  assert.equal((await planExperientialSelection(input)).ok, false);
  const fresh = await selectionFixture(); fresh.policy.minimumSupport++;
  assert.equal((await planExperientialSelection(fresh)).ok, false);
  const revised = await selectionFixture(), { id: _, ...body } = revised.assessments[0];
  revised.assessments = [accepted(await sealExperientialRecord('assessment', { ...body, rationale: 'A different review.' }))];
  assert.equal(accepted(await planExperientialSelection(revised)).excluded[0].reason, 'no-approval');
  for (const bad of [null, 'legacy text', {}, { id: 'wrong-address' }]) {
    const malformed = await selectionFixture(); malformed.experiences = [bad as never];
    assert.equal((await planExperientialSelection(malformed)).ok, false);
  }
});
