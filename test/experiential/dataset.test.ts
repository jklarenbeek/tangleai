import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { EXPERIENTIAL_EXAMPLE_TEMPLATE, planExperientialSelection, planExperientialDataset, renderExperientialExamples,
  checkExperientialDataset, experientialDatasetManifest, sealExperientialRecord, sealExperientialSelectionPolicy,
  type ExperientialSelectionInput } from '@tangleai/experiential';
import { accepted } from './identity-fixtures.ts';
import { selectionFixture, selectionText, SELECTION_TIME } from './selection-fixtures.ts';
import { datasetOptions } from './dataset-fixtures.ts';
import { generateCgtFixture } from '../../benchmark/lib/cgt-fixture.ts';
import { experiencesFromCgt } from '../../benchmark/lib/cgt-experiences.ts';

it('dataset identity and rendered examples reproduce; a template change cannot redraw splits', async () => {
  const input = await selectionFixture(12), selection = accepted(await planExperientialSelection(input));
  const options = datasetOptions(), first = accepted(await planExperientialDataset(selection, options));
  assert.deepEqual(first, accepted(await planExperientialDataset(selection, options)));
  assert.ok(Object.isFrozen(first.dataset.splits.train));
  assert.deepEqual(Object.fromEntries(Object.entries(first.dataset.splits).map(([name, ids]) => [name, ids.length])),
    { train: 8, validation: 2, compositionalHoldout: 0, replay: 2 });
  const needed = [...first.dataset.splits.train, ...first.dataset.splits.validation];
  const variables = input.experiences.flatMap((e, i) => needed.includes(e.id) ? [{ experienceId: e.id, ...selectionText(i) }] : []);
  const rendered = accepted(await renderExperientialExamples(first, options.template, variables));
  assert.deepEqual(rendered, accepted(await renderExperientialExamples(first, options.template, variables)));
  assert.ok(rendered.train.every(e => e.messages[0].content.includes('literal $.answer and {{instruction}}.')));
  const changed = structuredClone(EXPERIENTIAL_EXAMPLE_TEMPLATE); changed.rules[0].body.splice(0, 1, '{"messages":[{"role":"system","content":"Different pinned instruction."},{"role":"user","content":');
  const second = accepted(await planExperientialDataset(selection, { ...options, template: changed }));
  assert.notEqual(second.dataset.id, first.dataset.id); assert.notEqual(second.dataset.templateRevision, first.dataset.templateRevision);
  assert.deepEqual(second.dataset.splits, first.dataset.splits);
  assert.equal((await renderExperientialExamples(first, changed, variables)).ok, false);
  variables[0].answer = 'A forged answer';
  assert.equal((await renderExperientialExamples(first, options.template, variables)).ok, false);
});

it('holdout assignment and transitive family closure precede rendering', async () => {
  const input = await selectionFixture(6), selection = accepted(await planExperientialSelection(input));
  const family = await canonicalSha256('shared-family');
  const options = datasetOptions({ groupKeyOf: e => ({ sourceEpisodeId: e.sourceRefs[0].sourceId,
    duplicateFamilyId: ['episode-0', 'episode-1', 'episode-2'].includes(e.sourceRefs[0].sourceId) ? family : e.contentDigest }),
    holdoutPairsOf: e => e.sourceRefs[0].sourceId === 'episode-0' ? [['pair-a', 'pair-b']] : [],
    conceptsOf: () => ['pair-a', 'pair-b'], template: { deliberately: 'not a JTLT template' } });
  const planned = accepted(await planExperientialDataset(selection, options));
  assert.equal(planned.dataset.splits.train.length, 0); assert.equal(planned.dataset.splits.compositionalHoldout.length, 6);
  assert.equal((await renderExperientialExamples(planned, options.template, [])).ok, false);
  const ids = input.experiences.slice(0, 3).map(e => e.id);
  const grouped = accepted(await planExperientialDataset(selection, { ...options, conceptsOf: e => [e.sourceRefs[0].sourceId],
    holdoutPairsOf: e => e.sourceRefs[0].sourceId === 'episode-0' ? [['episode-0']] : [] }));
  assert.ok(ids.every(id => grouped.dataset.splits.compositionalHoldout.includes(id)));
});

it('paraphrase regrouping, rehashed split tampering and hidden example rendering are refused', async () => {
  const input = await selectionFixture(12), selection = accepted(await planExperientialSelection(input));
  const bad = await planExperientialDataset(selection, datasetOptions({ groupKeyOf: e => ({ sourceEpisodeId: 'invented-' + e.id, duplicateFamilyId: e.contentDigest }) }));
  assert.equal(bad.ok, false); if (!bad.ok) assert.equal(bad.issues[0].code, 'TEXP1011');
  const planned = accepted(await planExperientialDataset(selection, datasetOptions({ conceptsOf: () => ['a', 'b'], holdoutPairsOf: () => [['a', 'b']] })));
  const { id: _, ...body } = structuredClone(planned.dataset); body.splits.train.push(body.splits.compositionalHoldout.pop()!);
  body.manifestDigest = await canonicalSha256(experientialDatasetManifest(body));
  const forged = accepted(await sealExperientialRecord('dataset', body));
  const refused = await checkExperientialDataset(forged, planned.experiences, planned.assessments);
  assert.equal(refused.ok, false); if (!refused.ok) assert.equal(refused.issues[0].code, 'TEXP1011');
  assert.equal((await renderExperientialExamples(planned, EXPERIENTIAL_EXAMPLE_TEMPLATE,
    [{ experienceId: planned.experiences[0].id, ...selectionText(0) }])).ok, false);
});

it('removing a duplicate cannot sever the episode bridge between selected family members', async () => {
  const input = await selectionFixture(3), originals = [...input.experiences];
  const ref = originals[1].sourceRefs[0];
  const { id: _, ...third } = originals[2];
  input.experiences = [originals[0], originals[1], accepted(await sealExperientialRecord('experience', {
    ...third, sourceRefs: [ref], taskRef: ref, inputRef: ref, outputRef: ref }))];
  const assessments = [], approvals = [];
  for (let i = 0; i < 3; i++) {
    const { id: __, ...body } = input.assessments[i];
    const a = accepted(await sealExperientialRecord('assessment', { ...body, experienceId: input.experiences[i].id,
      duplicateOf: i === 1 ? originals[0].id : null }));
    assessments.push(a); approvals.push({ ...input.approvals[i], experienceId: a.experienceId, assessmentId: a.id });
  }
  input.assessments = assessments; input.approvals = approvals;
  const selected = accepted(await planExperientialSelection(input));
  assert.equal(selected.counts.selected, 2); assert.equal(selected.counts.byReason.duplicate, 1);
  const plan = accepted(await planExperientialDataset(selected, datasetOptions({
    holdoutPairsOf: e => e.id === originals[0].id ? [['held-pair']] : [],
    conceptsOf: e => [e.id === originals[0].id ? 'held-pair' : 'different-pair'],
  })));
  assert.equal(plan.dataset.splits.compositionalHoldout.length, 2);
  assert.equal(plan.dataset.splits.train.length, 0);
  const { id: ___, ...body } = structuredClone(plan.dataset);
  body.splits.train.push(body.splits.compositionalHoldout.splice(body.splits.compositionalHoldout.indexOf(input.experiences[2].id), 1)[0]);
  body.manifestDigest = await canonicalSha256(experientialDatasetManifest(body));
  const forged = accepted(await sealExperientialRecord('dataset', body));
  assert.equal((await checkExperientialDataset(forged, plan.experiences, plan.assessments, plan.grouping)).ok, false);
});

it('CGT observations exclude withheld truth and retain exact novel and retention references', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../benchmark/fixtures/cgt/manifest.json', import.meta.url), 'utf8'));
  const fixture = await generateCgtFixture(manifest), observations = await experiencesFromCgt(fixture, fixture.sessions.length);
  assert.equal(observations.experiences.length, 272);
  const input: ExperientialSelectionInput = { ...observations, assessments: [], approvals: [], policy: accepted(await sealExperientialSelectionPolicy({
    scope: manifest.scope, minimumSupport: 1, requireIndependentOutcome: true, allowedTrust: ['verified', 'operator'],
    allowedPrivacy: ['public', 'internal'], requireGeneralizable: true, requireApproval: true, principalKinds: ['operator', 'policy'] })) };
  const assessments = [], approvals = [];
  for (const e of observations.experiences) {
    const a = accepted(await sealExperientialRecord('assessment', { document: 'experiential-assessment', schemaVersion: 1, scope: e.scope,
      recordedAt: SELECTION_TIME, experienceId: e.id, author: { kind: 'operator', principalId: 'fixture-reviewer' }, policyRevision: input.policy.revision,
      generalizable: true, rationale: 'Authored observed example with independent fixture truth.', duplicateOf: null, contradiction: 'none',
      trustDecision: 'verified', inclusion: 'include', reason: 'fixture-independent', supportingIds: [e.observedOutcome!.digest] }));
    assessments.push(a); approvals.push({ action: 'select' as const, scope: e.scope, experienceId: e.id, assessmentId: a.id,
      policyRevision: input.policy.revision, principal: { id: 'fixture-reviewer', kind: 'operator' as const, authorityId: await canonicalSha256('fixture-reviewer') }, reason: 'Synthetic selection conformance.' });
  }
  input.assessments = assessments; input.approvals = approvals;
  const plan = accepted(await planExperientialDataset(accepted(await planExperientialSelection(input)), datasetOptions({
    conceptsOf: e => observations.concepts[e.id], evaluationReferences: observations.evaluationReferences })));
  assert.deepEqual(plan.dataset.evaluationReferences!.compositionalHoldout.map(r => r.id), fixture.questions.filter(i => i.partition === 'novel').map(i => i.id));
  assert.deepEqual(plan.dataset.evaluationReferences!.replay.map(r => r.id), fixture.questions.filter(i => i.partition === 'retention').map(i => i.id));
  assert.equal(plan.dataset.heldoutPairs!.length, 14);
  assert.equal(plan.dataset.splits.compositionalHoldout.length, 0, 'Novel questions are independent evaluation references, never fabricated observations.');
  const held = new Set([...observations.evaluationReferences.compositionalHoldout, ...observations.evaluationReferences.replay].map(r => r.id));
  assert.ok(plan.dataset.selectedIds.every(id => !held.has(id)));
  assert.ok(observations.examples.every(row => !held.has(observations.itemIds[row.experienceId])));
  const needed = [...plan.dataset.splits.train, ...plan.dataset.splits.validation];
  const examples = accepted(await renderExperientialExamples(plan, EXPERIENTIAL_EXAMPLE_TEMPLATE, observations.examples.filter(e => needed.includes(e.experienceId))));
  assert.equal(examples.train.length, plan.dataset.splits.train.length);
  assert.equal((await experiencesFromCgt(fixture, 1)).experiences.length, fixture.sessions[0].experiences.length);
});
