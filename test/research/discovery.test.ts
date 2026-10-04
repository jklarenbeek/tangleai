import assert from 'node:assert/strict';
import { it } from 'node:test';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { openTangleDb, createMasStore } from '@tangleai/store';
import { createQueryPlan, createInclusionCriteria, screenLiterature, createDiscoveryStageTools, createResearchBinding,
  executeScholarlyDiscovery, researchArtifactIdOf, researchRevisionOf, researchValue, initialResearchFrame, inputManifestOf,
  planProjectCreate, type ResearchStageOperation, type ResearchStageAccess } from '@tangleai/research';
import { researchExampleIdentity, researchExampleTools, researchExampleData } from '../../examples/research.ts';
import { loadResearchFixture } from '../../benchmark/lib/research-fixture.ts';
import { createResearchDiscoveryFixture } from '../../benchmark/lib/research-discovery.ts';
import { runNativeResearchFixture } from '../../benchmark/lib/research-workflow.ts';

it('native discovery commits its frozen plan before every request and keeps missing gold in the denominator', async () => {
  const loaded = await loadResearchFixture(), result = await runNativeResearchFixture(loaded, loaded.topics[1], 'b'.repeat(64));
  const measured = result.discovery!;
  assert.equal(result.measurement.state.status, 'COMPLETE'); assert.equal(measured.absentRelevant, 2);
  assert.deepEqual(measured.literatureRecall, { passed: 6, total: 8, value: 0.75 });
  assert.deepEqual(measured.literaturePrecision, { passed: 6, total: 8, value: 0.75 });
  assert.equal(measured.receipt.dedupe.identityMerges, 24); assert.equal(measured.receipt.outcomes.length, 5);
  assert.equal(measured.receipt.candidateIds.length, 1); assert.equal(measured.cards.unresolvable, 0);
  assert.ok(measured.acquisitions.every(a => a.status === 'resolved' && !a.issues.length));
  const create = result.measurement.attempts.find(a => a.stage === 'CREATED')!;
  const discovery = result.measurement.manifests.find(m => m.stage === 'DISCOVERY')!;
  assert.ok(discovery.inputs.some(input => create.outputArtifactIds.includes(input.artifactId)));
});
it('changed criteria refuse composition against an already pinned workflow binding', async () => {
  const loaded = await loadResearchFixture(), topic = loaded.topics[0], db = await openTangleDb();
  const host = await createResearchDiscoveryFixture(loaded, topic, db);
  try {
    const binding = await createResearchBinding(topic.contract, { identity: await researchExampleIdentity(), promptRevision: 'b'.repeat(64),
      toolVersions: [{ name: 'scholarly-discovery', version: host.revision }], evaluator: topic.plan.evaluator,
      reservation: { calls: 0, tokens: 0, ms: 0, physical: 0 } });
    const tools = researchExampleTools({ binding, contract: topic.contract, plan: topic.plan, masStore: createMasStore(db) });
    const options = host.options;
    options.criteria = await createInclusionCriteria({ reviewer: 'changed', titleTerms: ['changed'], dateFrom: null, dateTo: null, requireSource: true });
    options.plan = await createQueryPlan({ ...options.plan, criteriaId: options.criteria.id });
    await assert.rejects(createDiscoveryStageTools(tools, options), /pinned/);
  } finally { await host.close(); await db.close(); }
});
it('screening distinguishes keep, exclude and unresolved without support inference', async () => {
  const loaded = await loadResearchFixture(), rows = loaded.literature.slice(0, 3).map(row => structuredClone(row));
  rows[1].title = 'Different subject'; rows[2].date = '2026';
  const criteria = await createInclusionCriteria({ reviewer: 'metadata-only', titleTerms: ['kmeans-seeding'], dateFrom: '2026-01-01', dateTo: '2026-12-31', requireSource: true });
  const decisions = await screenLiterature('fixture-project', criteria, rows);
  assert.deepEqual(decisions.map(d => d.decision), ['keep', 'exclude', 'unresolved']);
  assert.ok(decisions.every(d => d.criteriaId === criteria.id && d.reviewer === 'metadata-only'));
  rows[0].date = '2026-02-29';
  assert.equal((await screenLiterature('fixture-project', criteria, [rows[0]]))[0].decision, 'unresolved');
  await assert.rejects(createInclusionCriteria({ reviewer: 'rules', titleTerms: ['term'], dateFrom: '2026-02-29', dateTo: null, requireSource: true }), /date range/);
});
it('partial provider evidence is retained separately from admitted literature', async () => {
  const loaded = await loadResearchFixture(), db = await openTangleDb(), host = await createResearchDiscoveryFixture(loaded, loaded.topics[0], db);
  try {
    const { id: _id, ...body } = host.options.plan;
    const plan = await createQueryPlan({ ...body, queries: [body.queries[0]], maxRequests: 1 });
    const result = await executeScholarlyDiscovery(plan, host.options.provider, new AbortController().signal);
    assert.equal(result.literature.length, 0); assert.equal(result.receipt.outcomes[0].state, 'refused');
    assert.equal(result.receipt.outcomes[0].reason, 'attempt-budget');
    assert.ok(result.receipt.outcomes[0].rawHashes.length);
    assert.ok((await Promise.all(result.artifacts.map(a => researchArtifactIdOf(a.bytes)))).includes(result.receipt.outcomes[0].observationArtifactId));
  } finally { await host.close(); await db.close(); }
});
it('stage composition preserves the base verifier and independently refuses rehashed foreign evidence', async () => {
  const loaded = await loadResearchFixture(), topic = loaded.topics[0], db = await openTangleDb();
  const host = await createResearchDiscoveryFixture(loaded, topic, db);
  try {
    const binding = await createResearchBinding(topic.contract, { identity: await researchExampleIdentity(), promptRevision: 'b'.repeat(64),
      toolVersions: [{ name: 'scholarly-discovery', version: host.revision }], evaluator: topic.plan.evaluator,
      reservation: { calls: 0, tokens: 0, ms: 0, physical: 0 } });
    const tools = await createDiscoveryStageTools(researchExampleTools({ binding, contract: topic.contract, plan: topic.plan, masStore: createMasStore(db) }), host.options);
    const { project } = await researchExampleData(topic.contract.projectId), frame = await initialResearchFrame(project, topic.plan, binding);
    const manifest = await inputManifestOf(frame.status, frame, binding.promptRevision, binding.runIdentityId, binding.toolVersions, binding.evaluator, binding.reservation);
    const op: ResearchStageOperation = { stage: 'create', path: 'research/create', idempotencyKey: 'fixture-create', frame,
      manifest, attemptId: 'fixture-attempt', expectedState: researchValue(planProjectCreate(project)).state };
    const bytes = new Map<string, Uint8Array>(), access: ResearchStageAccess = { signal: new AbortController().signal,
      readArtifact: async ref => { const value = bytes.get(ref.artifactId); assert.ok(value); return value; },
      describeArtifact: async () => { throw Error('Unexpected descriptor read in fixture.'); } };
    const created = await tools.execute(op, access);
    assert.equal((await tools.verify(op, created, access)).valid, true, 'The base control verifier still sees its one original artifact.');
    const refs = await Promise.all(created.artifacts.map(async a => { const id = await researchArtifactIdOf(a.bytes); bytes.set(id, a.bytes);
      return { artifactId: id, admissionId: 'admission-' + id.slice(4) }; }));
    const nextFrame = { ...frame, status: 'DISCOVERY' as const, artifacts: refs };
    const discoveryOp: ResearchStageOperation = { ...op, stage: 'discovery', frame: nextFrame, path: 'research/discovery',
      manifest: await inputManifestOf(nextFrame.status, nextFrame, binding.promptRevision, binding.runIdentityId, binding.toolVersions, binding.evaluator, binding.reservation) };
    const requestsBefore = host.replay.stats().requests;
    await assert.rejects(tools.execute({ ...discoveryOp, frame: { ...nextFrame, artifacts: [] } }, access), /TRSH1005/);
    assert.equal(host.replay.stats().requests, requestsBefore);
    const result = await tools.execute(discoveryOp, access);
    assert.equal((await tools.verify(discoveryOp, result, access)).valid, true);
    const corrupted = structuredClone(result), card = corrupted.records.find(r => r.kind === 'EvidenceCard')!;
    assert.equal(card.kind, 'EvidenceCard'); if (card.kind !== 'EvidenceCard') throw Error('No evidence fixture.');
    card.value.literatureId = 'lit-foreign-source';
    const { id: _id, ...body } = card.value; card.value.id = 'card-' + await researchRevisionOf(body);
    corrupted.artifacts[corrupted.artifacts.length - 1] = { mediaType: 'application/json',
      bytes: new TextEncoder().encode(canonicalizeJson({ kind: 'discovery-records', value: corrupted.records })) };
    const verified = await tools.verify(discoveryOp, corrupted, access);
    assert.equal(verified.valid, false); if (!verified.valid) assert.equal(verified.issues[0].path, '/cards');
  } finally { await host.close(); await db.close(); }
});
