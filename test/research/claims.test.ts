import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createClaimRefiner } from '@tangleai/context/evidence';
import { buildClaimLedger, type ResearchClaim } from '@tangleai/research';
import { writingFixture } from './writing-fixtures.ts';

it('the native validator refuses zero-evidence strict claims and every result stays critical even in discussion', async () => {
  const f = await writingFixture();
  const claim: ResearchClaim = { id: 'unsupported', section: 'abstract', kind: 'interpretation', text: 'A claim without admitted evidence.',
    literatureIds: [], evidenceIds: [], observationIds: [], strength: 'descriptive', metricBinding: null };
  const failed = await buildClaimLedger(f.input, [claim]);
  assert.equal(failed.valid, false); if (!failed.valid) assert.ok(failed.issues.some(issue => issue.cause?.code === 'EVIDENCE_CRITICAL'));
  const results = structuredClone(f.ledger.claims.filter(claim => claim.kind === 'metric'));
  results.forEach(claim => { claim.section = 'discussion'; });
  const ledger = await buildClaimLedger(f.input, results); assert.equal(ledger.valid, true);
  if (ledger.valid) assert.ok(ledger.value.envelope.claims.every(claim => claim.critical));
});
it('claim envelope edits use the native guarded refiner and cannot mint an admitted artifact', async () => {
  const f = await writingFixture(); let value = structuredClone(f.ledger.envelope), writes = 0;
  const refiner = createClaimRefiner({ read: async () => value, artifacts: value.artifacts,
    validateProposal: () => true, apply: (_before: unknown, proposal: unknown) => proposal,
    commit: async document => { writes++; value = document; return document; } });
  const changed = structuredClone(value); changed.artifacts[0].digest = 'invented';
  assert.equal((await refiner.commit(changed)).ok, false); assert.equal(writes, 0);
  const open = structuredClone(value); open.claims.push({ id: 'open', text: 'Unresolved opinion.', evidence: [], critical: false, status: 'unresolved' });
  assert.equal((await refiner.commit(open)).ok, true); assert.equal(writes, 1);
  assert.equal(value.claims.at(-1)!.status, 'unresolved');
});
it('the emitted envelope keeps the shared native schema as its single structural owner', async () => {
  const { CLAIM_EVIDENCE_SCHEMA } = await import('@tangleai/context/schemas/evidence');
  const { researchSchema } = await import('@tangleai/research');
  assert.deepEqual(researchSchema.$defs.ResearchClaimEnvelope, CLAIM_EVIDENCE_SCHEMA);
});
