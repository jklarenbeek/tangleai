import assert from 'node:assert/strict';
import { compileMasRuntime, MasInfrastructureCrash, type MasRuntimeObserver, type MasStore } from '@tangleai/mas';
import { openTangleDb, createMasStore, createResearchStore, createMasSegmentDriver, ensurePendingMasSegments,
  createRunLog, researchRunLogId } from '@tangleai/store';
import { researchValue, researchRevisionOf, planProjectCreate, initialResearchFrame, prepareResearchWorkflow,
  createResearchHostBindings, createResearchTaskHandlers, type ResearchStageOperation, type ResearchWorkflowFrame,
  type ResearchTaskTools, type ResearchGateResponse } from '@tangleai/research';
import { researchExampleData, researchExampleBinding, researchExampleTools, researchExampleLimits,
  type ResearchExampleDecisions } from '../../examples/research.ts';

export async function workflowFixture(decisions: ResearchExampleDecisions = [['Proceed']]) {
  const data = await researchExampleData('lifecycle-fixture'), binding = await researchExampleBinding(data.contract, decisions);
  const prepared = await prepareResearchWorkflow(data.contract, { binding, profile: 'research-scripted', limits: researchExampleLimits });
  const frame = await initialResearchFrame(data.project, data.plan, binding);
  return { ...data, binding, prepared, frame, decisions };
}
export type WorkflowFixture = Awaited<ReturnType<typeof workflowFixture>>;
export async function workflowHarness(f: WorkflowFixture, options: {
  path?: string; probe?: (point: string) => void; decisions?: ResearchExampleDecisions;
  tools?: (tools: ResearchTaskTools, stores: { researchStore: ReturnType<typeof createResearchStore>; masStore: MasStore }) => ResearchTaskTools | Promise<ResearchTaskTools>; observer?: MasRuntimeObserver;
  clientFor?: Parameters<typeof createResearchHostBindings>[0]['clientFor'];
} = {}) {
  let jobClock = 1000000, executions = 0;
  const operations: ResearchStageOperation[] = [], now = () => '2026-01-01T00:00:00.000Z';
  const open = () => openTangleDb({ ...(options.path ? { path: options.path } : {}), jobs: { now: () => jobClock, random: () => 0.5 } });
  let db = await open();
  const bind = async () => {
    const masStore = createMasStore(db, { now }), researchStore = createResearchStore(db, { now });
    let tools = researchExampleTools({ ...f, decisions: options.decisions ?? f.decisions, masStore,
      onExecute: op => { executions++; operations.push(op); }, onOperation: (step, op) => options.probe?.('research:' + op.path + ':' + step) });
    tools = await options.tools?.(tools, { researchStore, masStore }) ?? tools;
    const handlers = createResearchTaskHandlers(researchStore, tools);
    const bindings = createResearchHostBindings({ masStore, researchStore, taskHandlers: handlers, prepared: f.prepared, now, clock: () => 0, ...(options.clientFor ? { clientFor: options.clientFor } : {}),
      observer: { ...options.observer, onNodeSettle: (path, status) => { options.observer?.onNodeSettle?.(path, status); options.probe?.('native:' + path + ':' + status); } } });
    const compiled = compileMasRuntime(f.prepared.validated, f.prepared.plan, f.prepared.snapshot, bindings);
    assert.ok(compiled.valid, JSON.stringify(compiled));
    return { masStore, researchStore, handlers, bindings, runtime: compiled.value,
      driver: createMasSegmentDriver(db, masStore, { owner: 'research-test', leaseMs: 1000 }) };
  };
  let host = await bind();
  const harness = {
    get db() { return db; }, get host() { return host; }, get executions() { return executions; }, operations,
    async start(limits = researchExampleLimits) {
      researchValue(await host.researchStore.createProject(researchValue(planProjectCreate(f.project))));
      const created = await host.masStore.createRun({ runId: f.project.id, workflowId: f.prepared.workflow.workflowId,
        workflowVersionId: f.prepared.workflow.versionId, registryRevision: f.prepared.snapshot.revision,
        executableRevision: f.prepared.plan.executableRevision, configRegistryRevision: f.prepared.catalog.revision,
        profile: 'research-scripted', input: { frame: f.frame }, limits });
      assert.ok(created.ok, JSON.stringify(created)); await host.driver.enqueue(created.value);
    },
    async segment(signal = new AbortController().signal) {
      await ensurePendingMasSegments(db, host.masStore);
      const driven = await host.driver.drive(f.prepared.plan.executableRevision, host.runtime.executeSegment, signal);
      assert.ok(driven, 'Expected a native queued research segment');
      return (await host.masStore.readTrace(f.project.id))!;
    },
    async respond(decision: ResearchGateResponse['decision'] = 'approve', changes: Partial<ResearchGateResponse> = {}) {
      const trace = (await host.masStore.readTrace(f.project.id))!, gate = trace.interactions.find(i => i.status === 'waiting');
      assert.ok(gate, 'Expected a waiting research interaction');
      const frame = gate.prompt as ResearchWorkflowFrame;
      const response = { decision, approvedManifestHash: frame.gate!.manifestHash, note: 'Scripted lifecycle test', actor: 'scripted' as const, ...changes };
      const key = 'approval-' + await researchRevisionOf({ interaction: gate.id });
      const first = await host.masStore.respondInteraction(gate.id, response, gate.revision, key);
      if (first.ok) {
        const before = executions;
        assert.deepEqual(await host.masStore.respondInteraction(gate.id, response, gate.revision, key), first);
        assert.equal(executions, before); options.probe?.('response:' + gate.path);
      }
      return first;
    },
    async reopen() {
      assert.ok(options.path, 'Reopen requires an on-disk SQLite store');
      await db.close(); jobClock += 60000; db = await open(); host = await bind();
      await ensurePendingMasSegments(db, host.masStore);
    },
    async finish(responses: ResearchGateResponse['decision'][] = []) {
      let reply = 0;
      for (let segment = 0; segment < 30; segment++) {
        const trace = await harness.segment();
        if (trace.run.status === 'completed' || trace.run.status === 'failed' || trace.run.status === 'cancelled') return trace;
        assert.equal(trace.run.status, 'waiting_for_input', JSON.stringify(trace.run));
        assert.ok((await harness.respond(responses[reply++] ?? 'approve')).ok);
      }
      throw Error('Fixture exceeded its bounded native segment count');
    },
    async snapshot() { return researchValue(await host.researchStore.snapshot(f.project.id))!; },
    async projection() {
      const id = await researchRunLogId(db, f.project.id); assert.ok(id);
      return createRunLog(db, { now }).frames(id);
    },
    async close() { await db.close(); },
  };
  return harness;
}
export { MasInfrastructureCrash };
