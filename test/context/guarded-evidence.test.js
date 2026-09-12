//@ts-check
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createClaimRefiner, validateClaimEvidence } from '@tangleai/context/evidence';
import { createLedger } from '@tangleai/context/ledger';
const envelope = () => ({ version: 1, artifacts: [{ id: 'a', kind: 'file', locator: 'slot:source' }],
  evidence: [{ id: 'e', artifact: 'a', quote: '42' }], visibleEvidence: ['e'],
  claims: [{ id: 'c', text: 'result is 42', critical: true, status: 'supported', evidence: ['e'] }] });

it('validates distinct referential failures deterministically and preserves legacy memories', async () => {
  const value = envelope(), before = JSON.stringify(value);
  assert.equal(validateClaimEvidence(value).valid, true);
  assert.equal(JSON.stringify(value), before);
  const broken = envelope();
  broken.artifacts.push(broken.artifacts[0]);
  broken.evidence[0].artifact = 'missing';
  broken.claims[0].evidence.push('missing');
  broken.claims[0].status = 'unresolved';
  broken.visibleEvidence = [];
  const checked = validateClaimEvidence(broken);
  assert.deepEqual(checked, validateClaimEvidence(broken));
  assert.deepEqual(new Set(checked.errors.map((e) => e.code)), new Set([
    'EVIDENCE_DUPLICATE', 'EVIDENCE_ARTIFACT', 'EVIDENCE_REFERENCE', 'EVIDENCE_CRITICAL', 'EVIDENCE_HIDDEN',
  ]));
  assert.ok(checked.errors.every((e) => e.docPath.startsWith('/')));
  assert.equal(validateClaimEvidence(value, { artifacts: [] }).valid, false);
  const ledger = createLedger();
  assert.ok((await ledger.addMemory({ text: 'bad', evidence: broken })).error);
  const old = await ledger.addMemory({ text: 'old', evidence: 'legacy' });
  const fresh = await ledger.addMemory({ text: 'new', evidence: value });
  assert.equal((await ledger.getMemory(old.id)).evidence, 'legacy');
  assert.deepEqual((await ledger.getMemory(fresh.id)).evidence, value);
});



it('claim refinement rejects invented artifacts before commit and rolls back a failed edit', async () => {
  let value = envelope(), saved, writes = 0;
  const refiner = createClaimRefiner({ read: async () => value, artifacts: value.artifacts,
    validateProposal: () => true, apply: (_, proposed) => proposed,
    snapshot: async () => { saved = structuredClone(value); return 'checkpoint'; },
    restore: async () => { value = saved; },
    commit: async (next) => { writes++; value = next; if (next.claims[0].text === 'fail') throw new Error('disk'); return next; },
  });
  const bad = envelope(); bad.artifacts[0].locator = 'invented';
  assert.equal((await refiner.commit(bad)).ok, false);
  assert.equal(writes, 0);
  const good = envelope(); good.claims[0].text = 'updated';
  assert.equal((await refiner.commit(good)).ok, true);
  const failed = envelope(); failed.claims[0].text = 'fail';
  assert.equal((await refiner.commit(failed)).ok, false);
  assert.equal(value.claims[0].text, 'updated');
});


it('ledger refinement cannot invent or alter a host-admitted artifact', async () => {
  const { createRefiner } = await import('@tangleai/agents');
  const { applyJSONPatch } = await import('@jarenjs/json');
  const value = envelope(), artifacts = structuredClone(value.artifacts);
  const ledger = createLedger({ artifacts });
  artifacts[0].locator = 'mutated by host after construction';
  const refiner = createRefiner({ ledger, applyPatch: applyJSONPatch });
  assert.equal((await refiner.commit([{ op: 'add', path: '/memories/-', value: { text: 'known', evidence: value } }])).ok, true);
  const wrong = envelope(); wrong.artifacts[0].locator = 'invented';
  assert.ok((await refiner.commit([{ op: 'add', path: '/memories/-', value: { text: 'wrong', evidence: wrong } }])).error);
  assert.equal((await ledger.listMemories()).length, 1);
});


it('exact-evidence suppression also compares versioned envelopes by their JSON bytes', async () => {
  const { createRefiner } = await import('@tangleai/agents');
  const { applyJSONPatch } = await import('@jarenjs/json');
  const ledger = createLedger(), refiner = createRefiner({ ledger, applyPatch: applyJSONPatch, deduplicate: 'exact-evidence' });
  const patch = [{ op: 'add', path: '/memories/-', value: { text: 'claim', evidence: envelope() } }];
  await refiner.commit(patch);
  assert.equal((await refiner.commit(structuredClone(patch))).deduplicated.length, 1);
  assert.equal((await ledger.listMemories()).length, 1);
});
