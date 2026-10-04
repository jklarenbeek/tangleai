import assert from 'node:assert/strict';
import { compileMasRuntime, MasInfrastructureCrash, masIssue, type MasHostBindings, type MasChatClient } from '@tangleai/mas';
import { openTangleDb, createMasStore, createResearchStore, createMasSegmentDriver, ensurePendingMasSegments } from '@tangleai/store';
import { createResearchBinding, createResearchReasoningTools, researchReasoningRevisionOf, researchArtifacts, prepareResearchWorkflow,
  initialResearchFrame, planProjectCreate, researchValue, createResearchTaskHandlers, createResearchHostBindings, createReplayTransport,
  type ResearchReasoningPolicy, type ResearchWorkflowFrame, type ResearchTaskTools, type ResearchStageOperation } from '@tangleai/research';
import { researchExampleIdentity, researchExampleTools, researchExampleLimits } from '../../examples/research.ts';
import { reasoningFixture } from './reasoning-fixtures.ts';
import { project } from './fixtures.ts';
import { providerHost, transcript } from './discovery-fixtures.ts';

export async function reasoningWorkflowHarness(mode: ResearchReasoningPolicy['mode'] = 'single-agent', options: {
  path?: string; proposal?: (stage: string, proposal: unknown) => unknown; onOperation?: ResearchTaskTools['onOperation'];
  client?: (base: MasChatClient, node: Parameters<NonNullable<MasHostBindings['clientFor']>>[0]) => MasChatClient;
  failTransition?: () => boolean;
  failInteraction?: (node: string) => boolean;
  inputPaths?: string[];
} = {}) {
  const f = await reasoningFixture(), owner = { ...project(), budget: { calls: 100, tokens: 100000, ms: 600000, physical: 100 } };
  const policy: ResearchReasoningPolicy = { mode, maxCards: 8, novelty: { criteriaId: 'novelty', concurrency: 1, maxRequests: 8, maxBytes: 1048576,
    query: { provider: 'crossref', pages: 3, rows: 100, bytes: 262144, pageSize: 5 } } };
  const binding = await createResearchBinding(f.bounds.contract, { identity: await researchExampleIdentity(), promptRevision: researchArtifacts.revision,
    toolVersions: [{ name: 'research-reasoning', version: await researchReasoningRevisionOf(policy) }], evaluator: f.bounds.plan.evaluator,
    reservation: { calls: 30, tokens: 30000, ms: 60000, physical: 30 } });
  const limits = { ...researchExampleLimits, traceBytes: 1048576 }, prepared = await prepareResearchWorkflow(f.bounds.contract,
    { binding, profile: 'research-scripted', limits, reasoning: policy });
  const frame = await initialResearchFrame(owner, f.bounds.plan, binding), entries = [];
  for (const query of f.set.queries) for (const page of [0, 1]) {
    const entry = await transcript('kmeans-seeding/crossref-' + page), url = new URL(entry.url);
    url.searchParams.set('query', query.query); entries.push({ ...entry, url: url.href });
  }
  const replay = await createReplayTransport(entries, { scope: 'reasoning-workflow' });
  let jobClock = 1000000, calls = 0, tick = 0, downstream = 0;
  const systems: string[] = [], operations: ResearchStageOperation[] = [], now = () => 'tick-' + String(tick++).padStart(6, '0');
  const open = () => openTangleDb({ ...(options.path ? { path: options.path } : {}), jobs: { now: () => jobClock, random: () => 0.5 } });
  let db = await open();
  const clientFor: NonNullable<MasHostBindings['clientFor']> = node => {
    const stage = node.role.includes('designer') ? 'design' : node.role.includes('research-synthesis') ? 'synthesis' : 'hypothesis';
    const base: MasChatClient = { endpoint: { provider: 'scripted' }, complete: async request => {
      calls++; const messages = (request as { messages: Array<{ role: string; content: string }> }).messages;
      systems.push(messages.filter(row => row.role === 'system').map(row => row.content).join('\n'));
      let proposal: unknown = options.proposal?.(stage, structuredClone(stage === 'synthesis' ? f.synthesisProposal : stage === 'hypothesis' ? f.hypothesisProposal : f.designProposal))
        ?? structuredClone(stage === 'synthesis' ? f.synthesisProposal : stage === 'hypothesis' ? f.hypothesisProposal : f.designProposal);
      if (mode === 'debate' && stage !== 'design') {
        const result = { answer: JSON.stringify(proposal), disposition: 'completed', findings: [],
          claims: [{ text: 'Evidence-linked fixture proposal.', citations: f.cards.map(card => ({ id: card.id, digest: card.contentHash })) }] };
        proposal = node.id.startsWith('position-') ? { result, stance: node.id } : node.id.startsWith('rebuttal-')
          ? { result, addresses: ['position-1:claim-1'] } : node.id === 'judge' ? { result, action: 'accept' } : { result };
      }
      return { message: { role: 'assistant', content: JSON.stringify(proposal) }, finishReason: 'stop', usage: { prompt_tokens: 7, completion_tokens: 3 } };
    } };
    return options.client?.(base, node) ?? base;
  };
  const bind = async () => {
    const native = createMasStore(db, { now }), masStore = { ...native, async transitionRun(...args: Parameters<typeof native.transitionRun>) {
      if (args[1].kind === 'fail' && options.failTransition?.()) throw new MasInfrastructureCrash('Crash between research failure and native failure.');
      return native.transitionRun(...args);
    }, async createInteraction(plan: Parameters<typeof native.createInteraction>[0]) {
      return options.failInteraction?.(plan.node)
        ? { ok: false as const, issue: masIssue('TMAS2007', '/interaction', 'Injected native interaction admission failure.') }
        : native.createInteraction(plan);
    } }, researchStore = createResearchStore(db, { now });
    const base = researchExampleTools({ contract: f.bounds.contract, plan: f.bounds.plan, binding, masStore,
      onOperation: (step, op) => { operations.push(op); options.onOperation?.(step, op); }, onExecute: op => { if (op.stage === 'execute') downstream++; } });
    const records = [{ kind: 'LiteratureRecord' as const, value: f.literature }, ...f.cards.map(value => ({ kind: 'EvidenceCard' as const, value }))];
    const tools = await createResearchReasoningTools({ ...base, ...(options.inputPaths ? { plan: { ...base.plan, inputPaths: options.inputPaths } } : {}), execute: async (op, access) => op.stage === 'discovery'
      ? { spend: { calls: 0, tokens: 0, ms: 0, physical: 0 }, records, artifacts: [{ bytes: f.source, mediaType: 'text/plain' },
        { bytes: new TextEncoder().encode(JSON.stringify({ kind: 'discovery-records', value: records })), mediaType: 'application/json' }] }
      : base.execute(op, access), verify: async (op, result, access) => op.stage === 'discovery' ? { valid: true, value: null } : base.verify(op, result, access) },
    { project: owner, policy, provider: providerHost(replay.transport, { now: () => 0 }) });
    const handlers = createResearchTaskHandlers(researchStore, tools), bindings = createResearchHostBindings({ masStore, researchStore, taskHandlers: handlers,
      prepared, now, clock: () => 0, clientFor });
    const compiled = compileMasRuntime(prepared.validated, prepared.plan, prepared.snapshot, bindings);
    assert.ok(compiled.valid, JSON.stringify(compiled));
    return { masStore, researchStore, handlers, bindings, runtime: compiled.value,
      driver: createMasSegmentDriver(db, masStore, { owner: 'reasoning-test', leaseMs: 1000 }) };
  };
  let host: Awaited<ReturnType<typeof bind>>;
  try { host = await bind(); } catch (cause) { await db.close(); throw cause; }
  return { f, owner, binding, prepared, limits, replay, systems, operations, get calls() { return calls; }, get downstream() { return downstream; }, get host() { return host; },
    async start() {
      researchValue(await host.researchStore.createProject(researchValue(planProjectCreate(owner))));
      const created = await host.masStore.createRun({ runId: owner.id, workflowId: prepared.workflow.workflowId, workflowVersionId: prepared.workflow.versionId,
        registryRevision: prepared.snapshot.revision, executableRevision: prepared.plan.executableRevision, configRegistryRevision: prepared.catalog.revision,
        profile: 'research-scripted', input: { frame }, limits });
      assert.ok(created.ok, JSON.stringify(created)); await host.driver.enqueue(created.value);
    },
    async segment() {
      await ensurePendingMasSegments(db, host.masStore);
      assert.ok(await host.driver.drive(prepared.plan.executableRevision, host.runtime.executeSegment, new AbortController().signal));
      return (await host.masStore.readTrace(owner.id))!;
    },
    async respond() {
      const trace = (await host.masStore.readTrace(owner.id))!, gate = trace.interactions.find(row => row.status === 'waiting'); assert.ok(gate);
      const response = { decision: 'approve', approvedManifestHash: (gate.prompt as ResearchWorkflowFrame).gate!.manifestHash, actor: 'scripted', note: 'Reasoning fixture approval.' };
      assert.ok((await host.masStore.respondInteraction(gate.id, response, gate.revision, 'approve-' + gate.node)).ok);
    },
    async snapshot() { return researchValue(await host.researchStore.snapshot(owner.id))!; },
    async reopen() { assert.ok(options.path); await db.close(); jobClock += 60000; db = await open(); host = await bind(); },
    async close() { await db.close(); },
  };
}
