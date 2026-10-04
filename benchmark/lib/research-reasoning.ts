/** Measured scripted model paths stop at their actual preregistration gate. */
import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { resolveProfile, type ProfileRegistry, type HostManifest } from '@tangleai/config';
import { compileMasRuntime, type MasHostBindings } from '@tangleai/mas';
import { openTangleDb, createMasStore, createResearchStore, createMasSegmentDriver, ensurePendingMasSegments } from '@tangleai/store';
import { createResearchBinding, researchArtifacts, researchReasoningRevisionOf, createDiscoveryStageTools, createResearchReasoningTools,
  prepareResearchWorkflow, initialResearchFrame, planProjectCreate, researchValue, createResearchTaskHandlers, createResearchHostBindings,
  createReplayTransport, createResearchDesign, validateResearchShape, type ResearchReasoningPolicy, type ResearchProject,
  type ResearchWorkflowFrame, type EvidenceCard, type Synthesis, type ResearchHypothesis, type ResearchContract,
  type ExperimentPlan, type HypothesisSet, type NoveltyReport } from '@tangleai/research';
import { researchExampleTools } from '../../examples/research.ts';
import { createResearchDiscoveryFixture, researchDiscoveryConfiguration } from './research-discovery.ts';
import { requireResearchShape } from './research-validation.ts';
import { researchScore } from './research-oracle.ts';
import type { LoadedResearchFixture } from './research-fixture.ts';
import type { ResearchReasoningScript, ResearchReasoningTopic, ResearchModelUsage, ResearchFixtureTopic } from './research.types.ts';

async function identityFor(caps: LoadedResearchFixture['manifest']['caps']) {
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
export async function runResearchReasoningFixture(loaded: LoadedResearchFixture, topic: ResearchFixtureTopic, mode: ResearchReasoningPolicy['mode']) {
  const script = requireResearchShape<ResearchReasoningScript>('ResearchReasoningScript', JSON.parse(new TextDecoder().decode(loaded.files.get('scripts/' + topic.id + '.json')!)));
  if (script.topicId !== topic.id) throw Error('Research reasoning script belongs to another topic.');
  const caps = loaded.manifest.caps, limits = { ...caps, toolRounds: 4, fanOut: 8, iterations: 8 }, identity = await identityFor(caps);
  const policy: ResearchReasoningPolicy = { mode, maxCards: 8, novelty: { criteriaId: 'identifier-overlap', concurrency: 1, maxRequests: 8, maxBytes: 1048576,
    query: { provider: 'crossref', pages: 3, rows: 32, bytes: 262144, pageSize: 5 } } };
  const discoveryConfiguration = await researchDiscoveryConfiguration(topic), binding = await createResearchBinding(topic.contract, {
    identity, promptRevision: researchArtifacts.revision, evaluator: topic.plan.evaluator,
    reservation: { calls: 32, tokens: 32768, ms: 30000, physical: 32 }, toolVersions: [
      { name: 'scholarly-discovery', version: discoveryConfiguration.revision }, { name: 'research-reasoning', version: await researchReasoningRevisionOf(policy) }] });
  const prepared = await prepareResearchWorkflow(topic.contract, { binding, profile: 'scripted-v1', limits, reasoning: policy });
  const project: ResearchProject = { id: topic.contract.projectId, topic: topic.title, question: topic.title, domainProfile: 'computational', owner: 'scripted-fixture',
    mode: 'gate-only', safetyClass: 'computational', status: 'CREATED', budget: { calls: caps.calls, tokens: caps.tokens, ms: caps.ms, physical: caps.calls }, createdAt: '2026-01-01T00:00:00.000Z' };
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
    let tools = await createDiscoveryStageTools(researchExampleTools({ binding, contract: topic.contract, plan: topic.plan, masStore }), discovery.options);
    tools = await createResearchReasoningTools(tools, { project, policy, provider: { ...discovery.options.provider, transport: async (request, context) => {
      const snapshot = researchValue(await researchStore.snapshot(project.id));
      if (!snapshot?.records.some(row => row.kind === 'QueryPlan' && row.value.queries.some(query => query.text === new URL(request.url).searchParams.get('query'))))
        throw Error('Novelty ran before its hypothesis query plan was admitted.');
      return novelty.transport(request, context);
    } } });
    const usage: ResearchModelUsage = { roles: 0, completion: 0, normalization: 0, repair: 0, physical: 0, promptTokens: 0, completionTokens: 0, unknownTokenRequests: 0, traceBytes: 0 };
    const requests: ResearchReasoningTopic['requests'] = [], executedPacks = new Set<string>(), visibleIds = new Set<string>();
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
      profile: 'scripted-v1', input: { frame }, limits });
    if (!created.ok) throw Error(JSON.stringify(created));
    const driver = createMasSegmentDriver(db, masStore, { owner: 'research-reasoning', leaseMs: 1000 }); await driver.enqueue(created.value);
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
      requests, executedPacks: [...executedPacks].sort(), probes, discoveryReplay: discovery.replay.stats(), noveltyReplay: novelty.stats(),
      hypothesisValidity: score(hypotheses.map(row => validateResearchShape('ResearchHypothesis', row).valid)),
      evidenceLinkage: score(hypotheses.map(row => row.evidenceIds.length > 0 && row.evidenceIds.every(id => visibleIds.has(id) && cards.some(card => card.id === id)))),
      designIntegrity: score([snapshot.state.contractHash === contract.contractHash, snapshot.state.planHash === plan.planHash,
        (await createResearchDesign(project.id, script.design, hypotheses, { contract: topic.contract, plan: topic.plan, budget: project.budget })).valid]),
      hiddenIsolation: score([requests.every(row => row.hiddenPaths === 0), probes.find(row => row.id === 'hidden-read')!.matched]),
      refusalConformance: score(probes.map(row => row.matched)), cost, usage,
      interventions: { total: 1, approvals: 1, substantive: 0 }, failures: { program: 0, verification: probes.filter(row => !row.matched).length,
        leakage: requests.reduce((sum, row) => sum + row.hiddenPaths, 0), confound: 0, budget: 0, provider: 0, unsupported: 0 } });
    return { measurement, identity };
  } finally { await discovery?.close(); await db.close(); }
}
