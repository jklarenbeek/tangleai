/** Measured scripted model paths stop at their actual preregistration gate. */
import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { resolveProfile, type ProfileRegistry, type HostManifest, type RunIdentity } from '@tangleai/config';
import { compileMasRuntime, type MasHostBindings, type MasStore, type WorkflowLimits } from '@tangleai/mas';
import { openTangleDb, createMasStore, createResearchStore, createMasSegmentDriver, ensurePendingMasSegments } from '@tangleai/store';
import { createResearchBinding, researchArtifacts, researchReasoningRevisionOf, createDiscoveryStageTools, createResearchReasoningTools,
  prepareResearchWorkflow, initialResearchFrame, planProjectCreate, researchValue, createResearchTaskHandlers, createResearchHostBindings,
  createReplayTransport, createResearchDesign, validateResearchShape, researchExecutionRevisionOf, type ResearchReasoningPolicy, type ResearchProject,
  type ResearchWorkflowFrame, type EvidenceCard, type Synthesis, type ResearchHypothesis, type ResearchContract,
  type ExperimentPlan, type HypothesisSet, type NoveltyReport, type ResearchExecutionPolicy, type ResearchTaskTools, type ResearchStore,
  researchAnalysisRevisionOf, type ResearchAnalysisRuntimePolicy, createResearchWritingTools, researchWritingRevisionOf,
  type ResearchWritingPolicy, type ResearchCost } from '@tangleai/research';
import { researchExampleTools, type ResearchExampleDecisions } from '../../examples/research.ts';
import { createResearchDiscoveryFixture, researchDiscoveryConfiguration } from './research-discovery.ts';
import { requireResearchShape } from './research-validation.ts';
import { researchScore } from './research-oracle.ts';
import type { LoadedResearchFixture } from './research-fixture.ts';
import type { ResearchReasoningScript, ResearchReasoningTopic, ResearchModelUsage, ResearchFixtureTopic, ResearchExecutionTopic } from './research.types.ts';

export interface ResearchReasoningExecution<T = ResearchExecutionTopic> {
  policy: ResearchExecutionPolicy;
  script: ResearchReasoningScript;
  decisions: ResearchExampleDecisions;
  revision: string;
  signal?: AbortSignal;
  analysis?: ResearchAnalysisRuntimePolicy;
  reviewResponse?: (node: Parameters<NonNullable<MasHostBindings['clientFor']>>[0], request: unknown) => unknown;
  writing?: { policy: Omit<ResearchWritingPolicy, 'modelIdentity'>; limits: WorkflowLimits; reservation: ResearchCost;
    response: NonNullable<ResearchReasoningExecution['reviewResponse']> };
  tools(base: ResearchTaskTools, store: ResearchStore): Promise<ResearchTaskTools>;
  collect(store: ResearchStore, masStore: MasStore, reasoning: Pick<ResearchReasoningTopic, 'runIdentityId' | 'workflowVersionId' | 'executableRevision' | 'cost' | 'usage'>,
    native: { runGraph: string; requests: ResearchReasoningTopic['requests'] }): Promise<T>;
}

async function identityFor(caps: Pick<WorkflowLimits, 'calls' | 'tokens' | 'ms' | 'concurrency'>) {
  const registry: ProfileRegistry = { version: 1, credentialSlots: [], candidates: [
    { id: 'scripted-chat', kind: 'chat', provider: 'ollama', model: 'scripted-v1', baseUrl: null, credentialSlot: null, features: [], rateCard: null },
    { id: 'scripted-embedding', kind: 'embedding', provider: 'builtin', model: 'research-control', dims: 2, baseUrl: null, credentialSlot: null, features: [], rateCard: null }],
    capabilities: [], prompts: [], responseSchemas: [], components: [], inference: [], budgets: [], profiles: [{ id: 'scripted-v1', kind: 'root',
      description: 'In-process scripted research conformance; no external provider dispatch', roles: { chat: { candidate: 'scripted-chat', capability: null, prompt: null,
        responseSchema: null, tools: [], toolsRequired: false, inference: null, ranker: null } }, embedding: 'scripted-embedding', policyComponent: null, budget: null }] };
  const host: HostManifest = { sourceClass: 'synthetic', credentialSlots: [], providers: [{ provider: 'ollama', base: 'http://127.0.0.1:11434/v1', models: ['scripted-v1'], features: [] }],
    embedding: [{ provider: 'builtin', base: null, model: 'research-control', dims: 2 }], tools: [], components: [],
    budget: { maxCalls: caps.calls, maxTokens: caps.tokens, maxMs: caps.ms, maxConcurrency: caps.concurrency }, observation: null };
  const resolved = await resolveProfile({ registry, host, request: { kind: 'profile', profile: 'scripted-v1', overrides: null } });
  if (!resolved.ok) throw Error(JSON.stringify(resolved.issues)); return resolved.identity;
}
export function runResearchReasoningFixture<T = ResearchExecutionTopic>(loaded: LoadedResearchFixture, topic: ResearchFixtureTopic,
  mode: ResearchReasoningPolicy['mode'], execution?: ResearchReasoningExecution<T>): Promise<{ measurement: ResearchReasoningTopic; identity: RunIdentity; execution: T | undefined }>;
export function runResearchReasoningFixture<T>(loaded: LoadedResearchFixture, topic: ResearchFixtureTopic,
  mode: ResearchReasoningPolicy['mode'], execution: ResearchReasoningExecution<T>, automatic: boolean): Promise<{ measurement: ResearchReasoningTopic | null; identity: RunIdentity; execution: T | undefined }>;
export async function runResearchReasoningFixture<T = ResearchExecutionTopic>(loaded: LoadedResearchFixture, topic: ResearchFixtureTopic, mode: ResearchReasoningPolicy['mode'], execution?: ResearchReasoningExecution<T>, automatic = false) {
  if (automatic && !execution?.analysis) throw Error('The autonomous fixture requires the complete bounded decision owner.');
  const script = requireResearchShape<ResearchReasoningScript>('ResearchReasoningScript', execution?.script ?? JSON.parse(new TextDecoder().decode(loaded.files.get('scripts/' + topic.id + '.json')!)));
  if (script.topicId !== topic.id) throw Error('Research reasoning script belongs to another topic.');
  const caps = execution?.writing?.limits ?? loaded.manifest.caps, limits = execution?.writing?.limits ?? { ...caps, toolRounds: 4, fanOut: 8, iterations: 8 }, identity = await identityFor(caps);
  const writingPolicy = execution?.writing ? { ...execution.writing.policy, modelIdentity: identity.identityId } : undefined;
  const policy: ResearchReasoningPolicy = { mode, maxCards: 8, novelty: { criteriaId: 'identifier-overlap', concurrency: 1, maxRequests: 8, maxBytes: 1048576,
    query: { provider: 'crossref', pages: 3, rows: 32, bytes: 262144, pageSize: 5 } } };
  const discoveryConfiguration = await researchDiscoveryConfiguration(topic), binding = await createResearchBinding(topic.contract, {
    identity, promptRevision: researchArtifacts.revision, evaluator: topic.plan.evaluator,
    reservation: execution?.writing?.reservation ?? { calls: 32, tokens: 32768, ms: 30000, physical: 32 }, toolVersions: [
      { name: 'scholarly-discovery', version: discoveryConfiguration.revision }, { name: 'research-reasoning', version: await researchReasoningRevisionOf(policy) },
      ...(execution ? [{ name: 'research-execution-fixture', version: execution.revision },
        { name: 'research-execution', version: await researchExecutionRevisionOf(execution.policy) }] : []),
      ...(execution?.analysis ? [{ name: 'research-analysis', version: await researchAnalysisRevisionOf(execution.analysis) }] : []),
      ...(writingPolicy ? [{ name: 'research-writing', version: await researchWritingRevisionOf(writingPolicy) }] : [])] });
  const prepared = await prepareResearchWorkflow(topic.contract, { binding, profile: 'scripted-v1', limits, reasoning: policy,
    ...(automatic ? { mode: 'full-auto', experimental: true } as const : { mode: 'gate-only', experimental: false } as const),
    ...(execution ? { execution: execution.policy } : {}), ...(execution?.analysis ? { analysis: execution.analysis } : {}), ...(writingPolicy ? { writing: writingPolicy } : {}) });
  const project: ResearchProject = { id: topic.contract.projectId, topic: topic.title, question: topic.title, domainProfile: 'computational', owner: 'scripted-fixture',
    mode: automatic ? 'full-auto' : 'gate-only', ...(automatic ? { experimental: true } : {}), safetyClass: 'computational', status: 'CREATED', budget: { calls: caps.calls, tokens: caps.tokens, ms: caps.ms, physical: caps.calls }, createdAt: '2026-01-01T00:00:00.000Z' };
  const frame = await initialResearchFrame(project, topic.plan, binding), now = () => '2026-01-01T00:00:00.000Z';
  const db = await openTangleDb({ jobs: { now: () => 1000000, random: () => 0.5 } });
  let discovery: Awaited<ReturnType<typeof createResearchDiscoveryFixture>> | undefined;
  try {
    const masStore = createMasStore(db, { now }), researchStore = createResearchStore(db, { now });
    discovery = await createResearchDiscoveryFixture(loaded, topic, db, async () => {
      const snapshot = researchValue(await researchStore.snapshot(project.id));
      if (!snapshot?.records.some(row => row.kind === 'QueryPlan' && row.id === discoveryConfiguration.plan.id)) throw Error('Discovery ran before plan admission.');
    });
    const novelty = await createReplayTransport(script.noveltyTranscripts, { scope: 'research-reasoning-novelty' });
    let base = researchExampleTools({ binding, contract: topic.contract, plan: topic.plan, masStore, ...(execution ? { decisions: execution.decisions } : {}) });
    if (execution) base = await execution.tools(base, researchStore);
    let tools = await createDiscoveryStageTools(base, discovery.options);
    tools = await createResearchReasoningTools(tools, { project, policy,
      ...(execution ? { generatedStages: [...(['execute', 'analyze', 'decide'] as const), ...(writingPolicy ? ['write', 'verify'] as const : [])] } : {}), provider: { ...discovery.options.provider, transport: async (request, context) => {
      const snapshot = researchValue(await researchStore.snapshot(project.id));
      if (!snapshot?.records.some(row => row.kind === 'QueryPlan' && row.value.queries.some(query => query.text === new URL(request.url).searchParams.get('query'))))
        throw Error('Novelty ran before its hypothesis query plan was admitted.');
      return novelty.transport(request, context);
    } } });
    if (writingPolicy) tools = await createResearchWritingTools(tools, { policy: writingPolicy });
    const usage: ResearchModelUsage = { roles: 0, completion: 0, normalization: 0, repair: 0, physical: 0, promptTokens: 0, completionTokens: 0, unknownTokenRequests: 0, traceBytes: 0 };
    const requests: ResearchReasoningTopic['requests'] = [], executedPacks = new Set<string>(), visibleIds = new Set<string>();
    // This report inventories requests; native traces retain execution order.
    // Parallel hash completion must not reorder an otherwise identical measurement.
    const requestInventory = () => [...requests].sort((left, right) => {
      const a = canonicalizeJson(left), b = canonicalizeJson(right);
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const cursors = new Map<string, 'completion' | 'normalization' | 'repair'>();
    const clientFor: NonNullable<MasHostBindings['clientFor']> = node => ({ endpoint: { provider: 'scripted' }, complete: async request => {
      const messages = (request as { messages: Array<{ role: string; content: unknown }> }).messages;
      const fresh = !messages.some(message => message.role === 'assistant'), key = node.role + ':' + node.id;
      const phase = fresh ? 'completion' : cursors.get(key) ?? 'normalization'; cursors.set(key, phase === 'completion' ? 'normalization' : 'repair');
      const text = canonicalizeJson(messages), hiddenPaths = text.includes(topic.hiddenPath) ? 1 : 0;
      if (hiddenPaths) throw Error('Hidden result path leaked to a research model request.');
      const foundCards = [...text.matchAll(/card-[0-9a-f]{64}/g)].map(match => match[0]); foundCards.forEach(id => visibleIds.add(id));
      const cards = [...new Set(foundCards)];
      const stage = node.role.includes('designer') ? 'design' : node.role.includes('research-synthesis') ? 'synthesis' : 'hypothesis';
      let proposal: unknown = structuredClone(stage === 'synthesis' ? script.synthesis : stage === 'hypothesis' ? script.hypotheses : script.design);
      if (mode === 'debate' && stage !== 'design') {
        const participant = Object.keys(script.participants).find(name => node.role.startsWith('research-' + name + '-')) as keyof typeof script.participants | undefined;
        if (participant) proposal = script.participants[participant];
        const available = researchValue(await researchStore.listRecords(project.id, 'EvidenceCard'));
        const cited = stage === 'synthesis' ? script.synthesis.evidenceIds
          : [...new Set((participant ? script.participants[participant] : script.hypotheses).hypotheses.flatMap(row => row.evidenceIds))];
        if (cited.some(id => !cards.includes(id))) throw Error('Scripted proposal cites a card absent from its actual request.');
        const citations = cited.map(id => { const card = available.find(row => row.id === id); if (!card) throw Error('Model request names an unknown card.'); return { id, digest: card.contentHash }; });
        const result = { answer: JSON.stringify(proposal), disposition: 'completed', claims: [{ text: 'Prospective fixture comparison.', citations }], findings: [] };
        proposal = node.id.startsWith('position-') ? { result, stance: node.id } : node.id.startsWith('rebuttal-')
          ? { result, addresses: ['position-1:claim-1'] } : node.id === 'judge' ? { result, action: 'accept' } : { result };
      }
      if (node.role.startsWith('research-result-')) {
        if (!execution?.reviewResponse) throw Error('Result review requires a registered scripted response.');
        proposal = execution.reviewResponse(node, request);
      }
      if (node.role === 'research-writer' || /^research-(critic|attacker|defender|judge)-/.test(node.role)) {
        if (!execution?.writing) throw Error('Draft review requires its registered writing control.');
        proposal = execution.writing.response(node, request);
      }
      const base = researchArtifacts.prompts.find(pack => pack.role.id === node.role)!;
      executedPacks.add(base.id.replace(/-(analysis-analyst|analysis-merge|debate-position|debate-rebuttal|debate-judge)$/, ''));
      usage.physical++; usage[phase]++; if (fresh) usage.roles++; usage.promptTokens += 7; usage.completionTokens += 3;
      requests.push({ role: node.role, phase, sha256: await canonicalSha256(messages), hiddenPaths });
      return { message: { role: 'assistant', content: JSON.stringify(proposal) }, finishReason: 'stop', usage: { prompt_tokens: 7, completion_tokens: 3 } };
    } });
    const taskHandlers = createResearchTaskHandlers(researchStore, tools), bindings = createResearchHostBindings({ masStore, researchStore, taskHandlers,
      prepared, now, clock: () => 0, clientFor });
    const compiled = compileMasRuntime(prepared.validated, prepared.plan, prepared.snapshot, bindings);
    if (!compiled.valid) throw Error(JSON.stringify(compiled.issues));
    researchValue(await researchStore.createProject(researchValue(planProjectCreate(project))));
    const created = await masStore.createRun({ runId: project.id, workflowId: prepared.workflow.workflowId, workflowVersionId: prepared.workflow.versionId,
      registryRevision: prepared.snapshot.revision, executableRevision: prepared.plan.executableRevision, configRegistryRevision: prepared.catalog.revision,
      profile: 'scripted-v1', input: { frame }, limits: { ...limits } });
    if (!created.ok) throw Error(JSON.stringify(created));
    const driver = createMasSegmentDriver(db, masStore, { owner: 'research-reasoning', leaseMs: 1000 }); await driver.enqueue(created.value);
    if (automatic) {
      if (!await driver.drive(prepared.plan.executableRevision, compiled.value.executeSegment, execution!.signal ?? new AbortController().signal))
        throw Error('Autonomous research was not queued.');
      const trace = (await masStore.readTrace(project.id))!, snapshot = researchValue(await researchStore.snapshot(project.id))!;
      if (trace.run.status !== 'completed' || trace.interactions.length || !['COMPLETE', 'STOPPED'].includes(snapshot.state.status))
        throw Error('Autonomous research did not terminate in its native task topology: ' + JSON.stringify(trace.run.failure));
      const cost = snapshot.attempts.reduce((sum, row) => ({ calls: sum.calls + row.attempt.spend.calls,
        tokens: sum.tokens + row.attempt.spend.tokens, ms: sum.ms + row.attempt.spend.ms, physical: sum.physical + row.attempt.spend.physical }),
      { calls: 0, tokens: 0, ms: 0, physical: 0 });
      if (cost.calls !== requests.length || cost.calls !== trace.run.budget.spent.turns || cost.tokens !== trace.run.budget.spent.tokens)
        throw Error('Autonomous research must retain every model request and its incurred cost.');
      usage.traceBytes = new TextEncoder().encode(JSON.stringify(trace)).byteLength;
      const executionResult = await execution!.collect(researchStore, masStore, { runIdentityId: identity.identityId,
        workflowVersionId: prepared.workflow.versionId, executableRevision: prepared.plan.executableRevision, cost, usage },
      { runGraph: canonicalizeJson(prepared.mermaid), requests: requestInventory() });
      return { measurement: null, identity, execution: executionResult };
    }
    for (let segment = 0; segment < 2; segment++) {
      if (!await driver.drive(prepared.plan.executableRevision, compiled.value.executeSegment, new AbortController().signal)) throw Error('Research reasoning segment was not queued.');
      const trace = (await masStore.readTrace(project.id))!;
      if (trace.run.status !== 'waiting_for_input') throw Error('Research reasoning did not reach its gate: ' + JSON.stringify({ failure: trace.run.failure,
        bytes: Object.fromEntries(Object.entries(trace).map(([key, value]) => [key, new TextEncoder().encode(JSON.stringify(value)).byteLength])),
        largestAttempts: trace.attempts.map(row => ({ path: row.path, bytes: new TextEncoder().encode(JSON.stringify(row)).byteLength }))
          .sort((a, b) => b.bytes - a.bytes).slice(0, 6) }));
      const gate = trace.interactions.find(row => row.status === 'waiting')!, review = (gate.prompt as ResearchWorkflowFrame).gate!;
      if (segment === 1) { if (review.kind !== 'design') throw Error('Wrong reasoning terminal gate.'); break; }
      if (review.kind !== 'literature') throw Error('Wrong first reasoning gate.');
      const response = await masStore.respondInteraction(gate.id, { decision: 'approve', approvedManifestHash: review.manifestHash, note: '', actor: 'scripted' },
        gate.revision, topic.id + '-literature-approval'); if (!response.ok) throw Error(JSON.stringify(response));
      await ensurePendingMasSegments(db, masStore);
    }
    const trace = (await masStore.readTrace(project.id))!, snapshot = researchValue(await researchStore.snapshot(project.id))!;
    if (snapshot.state.status !== 'DESIGN_GATE' || snapshot.records.some(row => ['MetricObservation', 'ExperimentRun'].includes(row.kind)))
      throw Error('Reasoning crossed its preregistration-only measurement boundary.');
    const hypotheses = snapshot.records.filter(row => row.kind === 'ResearchHypothesis').map(row => row.value) as ResearchHypothesis[];
    const cards = snapshot.records.filter(row => row.kind === 'EvidenceCard').map(row => row.value) as EvidenceCard[];
    const synthesis = snapshot.records.find(row => row.kind === 'Synthesis')!.value as Synthesis;
    const set = snapshot.records.find(row => row.kind === 'HypothesisSet')!.value as HypothesisSet;
    const contract = snapshot.records.find(row => row.kind === 'ResearchContract' && row.value.contractHash === snapshot.state.contractHash)!.value as ResearchContract;
    const plan = snapshot.records.find(row => row.kind === 'ExperimentPlan' && row.value.planHash === snapshot.state.planHash)!.value as ExperimentPlan;
    const noveltyReport = snapshot.records.find(row => row.kind === 'NoveltyReport')!.value as NoveltyReport;
    const probes: ResearchReasoningTopic['probes'] = [];
    for (const test of script.cases) {
      const checked = await createResearchDesign(project.id, test.proposal, hypotheses, { contract: topic.contract, plan: topic.plan, budget: project.budget });
      const observed = checked.valid ? null : { code: checked.issues[0].code, path: checked.issues[0].path };
      probes.push({ id: test.id, kind: 'independent-verifier', calls: 0, expected: test.expected, observed,
        matched: canonicalizeJson(observed) === canonicalizeJson(test.expected) });
    }
    const attempts = snapshot.attempts.map(row => row.attempt), cost = attempts.reduce((sum, row) => ({ calls: sum.calls + row.spend.calls,
      tokens: sum.tokens + row.spend.tokens, ms: sum.ms + row.spend.ms, physical: sum.physical + row.spend.physical }), { calls: 0, tokens: 0, ms: 0, physical: 0 });
    if (cost.calls !== usage.physical || cost.tokens !== usage.promptTokens + usage.completionTokens
      || cost.calls !== trace.run.budget.spent.turns || cost.tokens !== trace.run.budget.spent.tokens) throw Error('Research reasoning cost does not reconcile with the native attempts.');
    usage.traceBytes = new TextEncoder().encode(JSON.stringify(trace)).byteLength;
    const score = (values: boolean[]) => researchScore(values.filter(Boolean).length, values.length);
    const measurement = requireResearchShape<ResearchReasoningTopic>('ResearchReasoningTopic', { topicId: topic.id, nativeStatus: trace.run.status,
      state: snapshot.state, bindingId: binding.id, runIdentityId: identity.identityId, workflowVersionId: prepared.workflow.versionId,
      registryRevision: prepared.snapshot.revision, executableRevision: prepared.plan.executableRevision, attempts,
      manifests: snapshot.records.filter(row => row.kind === 'InputManifest').map(row => row.value),
      artifacts: snapshot.artifacts.filter(row => snapshot.committedAdmissionIds.includes(row.id)), interactions: trace.interactions,
      synthesis, hypotheses, hypothesisSet: set, contract, plan, novelty: noveltyReport, visibleCardIds: [...visibleIds].sort(), availableCards: cards.length,
      requests: requestInventory(), executedPacks: [...executedPacks].sort(), probes, discoveryReplay: discovery.replay.stats(), noveltyReplay: novelty.stats(),
      hypothesisValidity: score(hypotheses.map(row => validateResearchShape('ResearchHypothesis', row).valid)),
      evidenceLinkage: score(hypotheses.map(row => row.evidenceIds.length > 0 && row.evidenceIds.every(id => visibleIds.has(id) && cards.some(card => card.id === id)))),
      designIntegrity: score([snapshot.state.contractHash === contract.contractHash, snapshot.state.planHash === plan.planHash,
        (await createResearchDesign(project.id, script.design, hypotheses, { contract: topic.contract, plan: topic.plan, budget: project.budget })).valid]),
      hiddenIsolation: score([requests.every(row => row.hiddenPaths === 0), probes.find(row => row.id === 'hidden-read')!.matched]),
      refusalConformance: score(probes.map(row => row.matched)), cost, usage,
      interventions: { total: 1, approvals: 1, substantive: 0 }, failures: { program: 0, verification: probes.filter(row => !row.matched).length,
        leakage: requests.reduce((sum, row) => sum + row.hiddenPaths, 0), confound: 0, budget: 0, provider: 0, unsupported: 0 } });
    if (!execution) return { measurement, identity, execution: undefined };
    const designGate = trace.interactions.find(row => row.status === 'waiting')!, review = (designGate.prompt as ResearchWorkflowFrame).gate!;
    const approved = await masStore.respondInteraction(designGate.id, { decision: 'approve', approvedManifestHash: review.manifestHash, note: '', actor: 'scripted' },
      designGate.revision, topic.id + '-design-approval');
    if (!approved.ok) throw Error(JSON.stringify(approved));
    await ensurePendingMasSegments(db, masStore);
    if (!await driver.drive(prepared.plan.executableRevision, compiled.value.executeSegment, execution.signal ?? new AbortController().signal))
      throw Error('Execution continuation was not queued.');
    if (execution.writing) {
      const reviewed = (await masStore.readTrace(project.id))!, gate = reviewed.interactions.find(row => row.status === 'waiting');
      const prompt = gate?.prompt as ResearchWorkflowFrame | undefined;
      if (reviewed.run.status !== 'waiting_for_input' || prompt?.gate?.kind !== 'quality')
        throw Error('Positive writing control did not reach its native quality gate: ' + JSON.stringify(reviewed.run.failure));
      const accepted = await masStore.respondInteraction(gate!.id, { decision: 'approve', approvedManifestHash: prompt.gate.manifestHash,
        note: 'Scripted mechanism approval; no human quality claim.', actor: 'scripted' }, gate!.revision, topic.id + '-writing-approval');
      if (!accepted.ok) throw Error(JSON.stringify(accepted));
      await ensurePendingMasSegments(db, masStore);
      if (!await driver.drive(prepared.plan.executableRevision, compiled.value.executeSegment, new AbortController().signal)) throw Error('Quality continuation was not queued.');
    }
    return { measurement, identity, execution: await execution.collect(researchStore, masStore, measurement,
      { runGraph: canonicalizeJson(prepared.mermaid), requests: requestInventory() }) };
  } finally { await discovery?.close(); await db.close(); }
}
