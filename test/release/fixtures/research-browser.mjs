import { createMemoryResearchStore, planProjectCreate, planStateTransition, planStageCommit,
  inputManifestHashOf, stageAttemptIdOf, researchArtifactIdOf, validateResearchShape, createReplayTransport, discoverCrossref } from '@tangleai/research';
import { createAttemptBudget, sleep } from '@jarenjs/core/retry';
import schema from '@tangleai/research/schemas/research' with { type: 'json' };

const value = result => {
  if (result.valid === true || result.ok === true) return result.value;
  throw new Error(JSON.stringify(result));
};
export async function exerciseResearchConsumer(store) {
  const project = { id: 'packed-research', topic: 'fixture', domainProfile: 'computational', question: 'Does storage replay?',
    owner: 'fixture', mode: 'gate-only', safetyClass: 'computational', status: 'CREATED', createdAt: '2026-10-03T00:00:00.000Z',
    budget: { calls: 1, tokens: 10, ms: 100, physical: 1 } };
  let state = value(await store.createProject(value(planProjectCreate(project))));
  state = value(await store.transition(value(planStateTransition(state, 'DISCOVERY'))));
  const manifest = { projectId: project.id, stage: 'DISCOVERY', inputs: [], promptRevision: 'a'.repeat(64), runIdentityId: 'b'.repeat(64),
    toolVersions: [{ name: 'fixture', version: '1' }], evaluator: { id: 'fixture', version: '1' }, reservation: project.budget };
  const key = { projectId: project.id, stage: 'DISCOVERY', attemptOrdinal: 1, inputManifestHash: await inputManifestHashOf(manifest) };
  const bytes = new TextEncoder().encode('abc');
  const admission = value(await store.stageArtifact(bytes, { projectId: project.id, attempt: key, mediaType: 'text/plain',
    verification: 'verified', parents: [{ artifactId: project.id, admissionId: null }] }));
  const attempt = { ...key, id: await stageAttemptIdOf(key), masPath: 'packed/discovery/1', promptRevision: manifest.promptRevision,
    runIdentityId: manifest.runIdentityId, toolVersions: manifest.toolVersions, spend: { calls: 0, tokens: 0, ms: 0, physical: 0 },
    stopReason: 'completed', interventions: [], outputArtifactIds: [admission.artifact.id], error: null, mode: 'scripted' };
  const plan = value(await planStageCommit({ state, attempt, manifest, nextStatus: 'LITERATURE_GATE', artifactAdmissionIds: [admission.id] }));
  const receipt = value(await store.commitStage(plan)), replay = await store.commitStage(plan); value(replay);
  const read = value(await store.readArtifact(project.id, admission.id)); read.bytes[0] = 0;
  const reread = value(await store.readArtifact(project.id, admission.id));
  const invalid = validateResearchShape('ResearchProject', { ...project, status: 'unknown' });
  if (!schema.$defs.ResearchProject || invalid.valid || invalid.issues[0].path !== '/status') throw new Error('Packed schema ownership differs');
  return { plan, summary: { state: receipt.nextState.status, attempts: value(await store.snapshot(project.id)).attempts.length,
    replayed: replay.replayed === true, bytes: [...reread.bytes], artifactId: await researchArtifactIdOf(bytes), refusal: invalid.issues[0].code } };
}
export async function qualifyResearchBrowser() { return (await exerciseResearchConsumer(createMemoryResearchStore())).summary; }
export async function qualifyResearchDiscoveryBrowser() {
  const body = JSON.stringify({ message: { items: [{ DOI: '10.5555/packed', title: ['Packed scholarly fixture'],
    author: [{ name: 'Fixture Author' }], published: { 'date-parts': [[2026, 1, 1]] }, URL: 'https://fixture.invalid/packed' }] } });
  const replay = await createReplayTransport([{ method: 'GET', url: 'https://api.crossref.org/works?query=packed&rows=5&cursor=*', body: null,
    response: { status: 200, headers: { 'content-type': 'application/json' }, body } }], { scope: 'packed-public-fixture' });
  const result = await discoverCrossref({ id: 'packed-query', provider: 'crossref', text: 'packed', pages: 2, rows: 10, bytes: 4096, pageSize: 5 },
    { transport: replay.transport, now: () => 0, sleep, random: () => 0.5, attempts: 1, overallMs: 10000, attemptMs: 5000, spacingMs: 0,
      licence: { spdx: 'MIT', provenance: 'tangle-authored-synthetic', source: 'installed fixture' } },
    { signal: new AbortController().signal, budget: createAttemptBudget(1), bytes: { remaining: 4096, consumed: 0 } });
  if (result.outcome.state !== 'complete' || result.records.length !== 1) throw new Error('Installed discovery refused: ' + JSON.stringify(result.outcome));
  return { doi: result.records[0].canonicalIds.doi, rawHash: result.records[0].rawHashes[0].sha256 === (await researchArtifactIdOf(new TextEncoder().encode(body))).slice(4),
    ...replay.stats() };
}
