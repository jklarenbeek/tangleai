import { createMemoryResearchStore, planProjectCreate, planStateTransition, planStageCommit,
  inputManifestHashOf, stageAttemptIdOf, researchArtifactIdOf, validateResearchShape, createReplayTransport, discoverCrossref,
  researchArtifacts, createResearchPatternHost, prepareResearchPattern, researchRevisionOf, createResearchWorkspace,
  buildExecutionManifest, createFixtureExecutor, createEvaluationRegistry, researchObservationSignature, createResearchAnalysis, selectBranch, planResearchDecision,
  buildClaimLedger, writeResearchDraft, verifyResearchDraft, researchDisclosure, renderMarkdownBundle, rerunBundle, renderLatexBundle,
  researchMode, createStagedArtifactRefiner, researchInterventionReport, RESEARCH_RECORD_KINDS } from '@tangleai/research';
import { pairedBootstrap } from '@jarenjs/core/stats';
import { cloneJson } from '@jarenjs/core/object';
import { GMPL_LIMITS } from '@tangleai/gmpl';
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
export async function qualifyResearchReasoningBrowser() {
  const prepared = await prepareResearchPattern('hypothesis', await createResearchPatternHost('packed-reasoning', { ...GMPL_LIMITS }));
  const nodes = [prepared.validated.workflow, ...prepared.snapshot.subgraphs.values()].flatMap(workflow => workflow.nodes);
  const prompts = researchArtifacts.prompts.filter(pack => ['synthesis', 'innovator', 'pragmatist', 'contrarian', 'synthesizer', 'designer', 'screener']
    .some(name => pack.id === 'research-' + name));
  return { packs: prompts.length, participants: nodes.filter(node => /^position-\d+$/.test(node.id)).length,
    separateSynthesizer: nodes.some(node => node.id === 'synthesis' && node.kind === 'agent'),
    generatedPlanSchema: !!schema.$defs.ResearchDesignProposal };
}
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
export async function qualifyResearchExecutionBrowser(analyze = false) {
  const bytes = new TextEncoder().encode('{"features":[1,2]}'), artifactId = await researchArtifactIdOf(bytes);
  const contractBody = { id: 'packed-contract', projectId: 'packed-execution', hypothesisSpace: ['Retain every feature.'],
    successRule: { metric: 'count', baseline: 'baseline', condition: 'candidate', minImprovement: 0, confidenceLevel: 0.95 },
    failureRule: 'stop-on-invalid', metrics: [{ id: 'count', unit: 'items', direction: 'maximize' }],
    datasets: [{ id: 'features', sha256: artifactId.slice(4) }], splits: { train: [], test: ['a', 'b'] },
    requiredBaselines: [{ condition: 'baseline', programId: 'fixture', source: 'installed fixture',
      licence: { spdx: 'MIT', provenance: 'tangle-authored-synthetic', source: 'installed fixture' } }],
    replicatePolicy: { seeds: [1], minimum: 1, resamples: 10, bootstrapSeed: 1 }, attemptCap: 1, pivotCap: 1, reviewCap: 1,
    selectionRule: { kind: 'all', n: 1, metric: 'count' }, stopConditions: ['invalid'] };
  if (analyze) {
    contractBody.branchSelectionRule = { kind: 'single' };
    contractBody.analysisPolicy = { seedBatchSize: 1, recoverProgramFailure: false, confoundAction: 'Stop', seedVariationChecks: [] };
  }
  const contract = { ...contractBody, contractHash: await researchRevisionOf(contractBody) };
  const planBody = { id: 'packed-plan', projectId: contract.projectId, contractHash: contract.contractHash,
    hypothesisHash: await researchRevisionOf(contract.hypothesisSpace), inputPaths: ['features.json'], evaluator: { id: 'counter', version: '1' },
    conditions: ['baseline', 'candidate'].map(id => ({ id, programId: 'fixture', datasetId: 'features', params: {} })) };
  const plan = { ...planBody, planHash: await researchRevisionOf(planBody) };
  const workspace = value(await createResearchWorkspace({ projectId: contract.projectId, datasetIds: ['features'], splitIds: ['a', 'b'], files: [
    { path: 'features.json', bytes, mode: 'read-only', role: 'input' },
    { path: 'evaluation/identity.json', bytes: new TextEncoder().encode('{"counter":1}'), mode: 'read-only', role: 'evaluator' }] }));
  const input = { contract, plan, workspace, branchId: 'packed-branch', condition: 'candidate', seed: 1, imageDigest: 'sha256:' + 'd'.repeat(64),
    dependencyLockHash: 'e'.repeat(64), resources: { cpu: 1, memoryBytes: 67108864, pids: 16, wallMs: 1000, outputBytes: 65536 } };
  const manifest = value(await buildExecutionManifest(input));
  const executor = createFixtureExecutor({ fixture: async request => {
    if (JSON.parse(new TextDecoder().decode(request.bytes)).features.length !== 2) throw Error('Packed feature view differs');
    return { kind: 'clusters', assignments: [0, 0], centroids: [[1.5, 0]], iterations: 1 };
  } }, { now: () => 0 });
  const context = { contract, plan, signal: new AbortController().signal }, result = value(await executor.run(manifest, workspace, context));
  const registry = createEvaluationRegistry([{ id: 'counter', version: '1', evaluate: async request => {
    if (request.hiddenLabels.expected !== 2 || request.rawOutput.kind !== 'clusters') throw Error('Packed evaluator scope differs');
    return { valid: true, value: [{ metric: 'count', unit: 'items', value: request.rawOutput.assignments.length }] };
  } }]);
  const evidence = { ...context, manifest, workspace, result, hiddenLabels: { expected: 2 } };
  const observations = value(await registry.evaluate(evidence));
  const accepted = value(await registry.registerObservations(evidence, observations));
  const forged = { ...observations[0], value: 999 }; forged.registrySignature = await researchObservationSignature(forged);
  const refusal = await registry.registerObservations(evidence, [forged]);
  const network = await buildExecutionManifest({ ...input, network: { setup: 'off', measured: 'on' } });
  if (refusal.valid || network.valid) throw Error('Packed execution admitted a forgery or network escape');
  if (analyze) {
    const baselineManifest = value(await buildExecutionManifest({ ...input, condition: 'baseline' }));
    const baselineResult = value(await executor.run(baselineManifest, workspace, context));
    const baseline = value(await registry.evaluate({ ...evidence, manifest: baselineManifest, result: baselineResult }));
    const branch = { id: input.branchId, projectId: contract.projectId, contractHash: contract.contractHash, planHash: plan.planHash,
      hypothesisHash: plan.hypothesisHash, parentId: null, kind: 'initial', attemptOrdinal: 1, status: 'completed',
      runIds: [baselineResult.run.id, result.run.id], spend: { calls: 0, tokens: 0, ms: 0, physical: 2 } };
    const analysis = value(await createResearchAnalysis({ contract, plan, branch, ancestors: [], runs: [baselineResult.run, result.run],
      manifests: [baselineManifest, manifest], observations: [...baseline, ...observations], exploratoryObservationIds: [], analystIdentityId: 'packed-analyst' },
      (pairs, options) => pairedBootstrap(pairs, { ...options, quantile: 'nearest-rank' })));
    const selection = value(await selectBranch([{ analysis, branches: [branch] }], contract));
    const cost = { calls: 10, tokens: 100, ms: 10000, physical: 10 };
    const decision = value(await planResearchDecision(analysis, contract, { attempt: 1, pivot: 1, selection },
      { remaining: cost, nextAttempt: cost, nextPivot: cost }, { reviewerIdentityId: 'packed-reviewer', findings: [], artifactIds: ['component-review'] }));
    const review = await prepareResearchPattern('result-review', await createResearchPatternHost('packed-analysis', { ...GMPL_LIMITS }));
    const nodes = [review.validated.workflow, ...review.snapshot.subgraphs.values()].flatMap(workflow => workflow.nodes);
    return { support: analysis.support, underpowered: analysis.evidence.underpowered, decision: decision.kind,
      candidates: selection.candidates.length, reviewers: nodes.filter(node => node.kind === 'agent' && node.id.startsWith('reviewer-')).length };
  }
  return { status: result.run.status, value: accepted[0].value, signature: accepted[0].registrySignature === await researchObservationSignature(accepted[0]),
    physical: result.run.spend.physical, isolated: result.run.isolation.verified, forged: refusal.issues[0].code, network: network.issues[0].code };
}

export function qualifyResearchAnalysisBrowser() { return qualifyResearchExecutionBrowser(true); }

export async function qualifyResearchWritingBrowser() {
  const inputs = { projectId: 'packed-writing', scope: 'retrieval-control', contract: null, plan: null, analysis: null, decision: null,
    cards: [], literature: [], observations: [] };
  const ledger = value(await buildClaimLedger(inputs)), writer = { roleId: 'packed-template', promptRevision: 'a'.repeat(64), modelIdentity: 'no-model' };
  const draft = value(await writeResearchDraft(ledger, writer, { mode: 'template' })), verification = value(await verifyResearchDraft(inputs, ledger, draft));
  const body = { inputs, ledger, draft, verification, reviews: [], provenance: { runGraph: 'Empty retrieval rendering fixture.', attempts: [],
    selection: null, prompts: [writer], tools: [], code: [], data: [], seeds: [], environments: [], interventions: [], cost: { calls: 0, tokens: 0, ms: 0, physical: 0 } } };
  const bundle = value(await renderMarkdownBundle({ ...body, disclosure: researchDisclosure(body, null) }, null));
  const rerun = value(await rerunBundle(bundle.manifest)), tex = value(await renderLatexBundle(bundle.manifest));
  const bad = cloneJson(draft); bad.sections[0].text = 'An unsupported 99% result.';
  const refused = await verifyResearchDraft(inputs, ledger, bad);
  return { sections: draft.sections.length, files: Object.keys(bundle.files).length, rerun: JSON.stringify(bundle.files) === JSON.stringify(rerun.files),
    disclosure: bundle.manifest.source.disclosure.length, tex: Object.keys(tex.files).sort(), refused: refused.valid ? refused.value.state : refused.issues[0].code };
}

export async function qualifyResearchCommandsBrowser() {
  const project = { id: 'packed-edit', topic: 'reviewed control', question: 'Original question', domainProfile: 'computational',
    owner: 'fixture', mode: 'gate-only', safetyClass: 'computational', status: 'CREATED', createdAt: '2026-01-01T00:00:00Z',
    budget: { calls: 1, tokens: 1, ms: 1, physical: 1 } };
  const store = createMemoryResearchStore(); value(await store.createProject(value(planProjectCreate(project))));
  const attempt = { projectId: project.id, stage: 'CREATED', attemptOrdinal: 1, inputManifestHash: 'a'.repeat(64) };
  const original = value(await store.stageArtifact(new TextEncoder().encode(JSON.stringify(project)), { projectId: project.id,
    attempt, mediaType: 'application/json', verification: 'verified', parents: [{ artifactId: project.id, admissionId: null }] }));
  const editor = createStagedArtifactRefiner({ store, projectId: project.id, source: { artifactId: original.artifact.id, admissionId: original.id },
    attempt, schema: 'ResearchProject', allowedPaths: ['/question'] });
  const patch = [{ op: 'replace', path: '/question', value: 'Reviewed question' }];
  value(await editor.preview(patch)); const edited = value(await editor.commit(patch));
  const old = JSON.parse(new TextDecoder().decode(value(await store.readArtifact(project.id, original.id)).bytes));
  const refused = await editor.preview([{ op: 'replace', path: '/budget/calls', value: 100 }]);
  const actions = [['approve', 'human'], ['edit', 'human'], ['approve', 'full-auto']].map(([action, actor], index) => ({
    id: 'action-' + index, gate: 'design', action, actor, reviewedManifestHash: 'a'.repeat(64),
    approvedManifestHash: action === 'approve' ? 'a'.repeat(64) : null, substantive: action === 'edit', experimental: actor === 'full-auto' }));
  const report = researchInterventionReport(actions);
  if (!RESEARCH_RECORD_KINDS.includes('Intervention')) throw Error('The public record census omitted interventions.');
  return { mode: researchMode().mode, experimental: researchMode({ mode: 'full-auto', experimental: true }).experimental,
    pending: edited.artifact.verification === 'pending', parent: edited.artifact.parentIds[0] === original.artifact.id,
    immutable: old.question === project.question, refused: refused.valid ? null : refused.issues[0].code,
    total: report.total, substantive: report.substantive };
}
