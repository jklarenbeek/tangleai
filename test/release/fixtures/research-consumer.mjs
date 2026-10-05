import assert from 'node:assert/strict';
import { join } from 'node:path';
import { openTangleDb, createResearchStore, researchRunLogId, createRunLog, createMasStore, createMasSegmentDriver, ensurePendingMasSegments } from '@tangleai/store';
import { compileMasRuntime } from '@tangleai/mas';
import { createResearchCommands, interventionReport, researchValue, planProjectCreate, initialResearchFrame, prepareResearchWorkflow,
  createResearchTaskHandlers, createResearchHostBindings } from '@tangleai/research';
import { exerciseResearchConsumer, qualifyResearchBrowser, qualifyResearchDiscoveryBrowser, qualifyResearchReasoningBrowser, qualifyResearchExecutionBrowser, qualifyResearchAnalysisBrowser, qualifyResearchWritingBrowser, qualifyResearchCommandsBrowser } from './research-browser.mjs';
import { runResearchExample, researchExampleData, researchExampleBinding, researchExampleTools, researchExampleLimits } from './research-example.mjs';

async function qualifyInstalledCommands(directory) {
  for (const action of ['approve', 'stop', 'automatic']) {
    const data = await researchExampleData('packed-command-' + action), binding = await researchExampleBinding(data.contract);
    if (action === 'automatic') Object.assign(data.project, { mode: 'full-auto', experimental: true });
    const prepared = await prepareResearchWorkflow(data.contract, { binding, profile: 'research-scripted', limits: researchExampleLimits,
      ...(action === 'automatic' ? { mode: 'full-auto', experimental: true } : {}) });
    const frame = await initialResearchFrame(data.project, data.plan, binding), path = join(directory, action + '.sqlite');
    const now = () => '2026-01-01T00:00:00Z', open = () => openTangleDb({ path, jobs: { now: () => 1000000, random: () => 0.5 } });
    let db = await open(), executions = 0;
    const assemble = () => {
      const masStore = createMasStore(db, { now }), researchStore = createResearchStore(db, { now });
      const taskHandlers = createResearchTaskHandlers(researchStore, researchExampleTools({ ...data, binding, masStore, onExecute: () => executions++ }));
      const bindings = createResearchHostBindings({ masStore, researchStore, taskHandlers, prepared, now, clock: () => 0 });
      const compiled = compileMasRuntime(prepared.validated, prepared.plan, prepared.snapshot, bindings); assert.ok(compiled.valid);
      return { masStore, researchStore, commands: createResearchCommands({ masStore, researchStore }), runtime: compiled.value,
        driver: createMasSegmentDriver(db, masStore, { owner: 'packed-command', leaseMs: 1000 }) };
    };
    try {
      let host = assemble(); researchValue(await host.researchStore.createProject(researchValue(planProjectCreate(data.project))));
      const created = await host.masStore.createRun({ runId: data.project.id, workflowId: prepared.workflow.workflowId,
        workflowVersionId: prepared.workflow.versionId, registryRevision: prepared.snapshot.revision, executableRevision: prepared.plan.executableRevision,
        configRegistryRevision: prepared.catalog.revision, profile: 'research-scripted', input: { frame }, limits: researchExampleLimits });
      assert.ok(created.ok); await host.driver.enqueue(created.value);
      for (let segment = 0; segment < 4; segment++) {
        await ensurePendingMasSegments(db, host.masStore);
        assert.ok(await host.driver.drive(prepared.plan.executableRevision, host.runtime.executeSegment, new AbortController().signal));
        const trace = await host.masStore.readTrace(data.project.id); assert.ok(trace);
        if (trace.run.status === 'completed') break;
        assert.equal(trace.run.status, 'waiting_for_input', JSON.stringify(trace.run.failure));
        const attached = await host.commands.attach(data.project.id); assert.ok(attached.ok);
        const gate = trace.interactions.find(row => row.status === 'waiting'); assert.ok(gate);
        const command = { kind: action, id: 'packed-action-' + segment, interactionId: gate.id, revision: gate.revision,
          gate: gate.prompt.gate.kind, approvedManifestHash: gate.prompt.gate.manifestHash, actor: 'scripted', actorId: 'packed-consumer', at: now(),
          ...(action === 'stop' ? { reason: 'Installed cancellation test.' } : { note: 'Installed approval test.' }) };
        const accepted = await host.commands.execute(command); assert.ok(accepted.ok, JSON.stringify(accepted));
        const before = executions; await db.close(); db = await open(); host = assemble();
        assert.deepEqual(await host.commands.execute(command), accepted); assert.equal(executions, before);
        if (action === 'stop') break;
      }
      const trace = await host.masStore.readTrace(data.project.id), snapshot = researchValue(await host.researchStore.snapshot(data.project.id));
      assert.equal(snapshot.state.status, action === 'stop' ? 'STOPPED' : 'COMPLETE');
      const report = interventionReport(trace);
      assert.equal(report.total, action === 'stop' ? 1 : 3); assert.equal(report.automatic, action === 'automatic' ? 3 : 0);
      assert.equal(snapshot.records.filter(row => row.kind === 'Intervention').length, report.total);
      assert.equal(trace.interactions.length, action === 'automatic' ? 0 : action === 'stop' ? 1 : 3);
      await ensurePendingMasSegments(db, host.masStore); assert.equal((await db.jobs.counts()).pending, 0);
    } finally { await db.close(); }
  }
}

assert.match(import.meta.resolve('@tangleai/research'), /\.js$/);
const directory = process.env.TANGLE_FIXTURE_DIRECTORY; assert.ok(directory);
const original = globalThis.fetch; globalThis.fetch = () => { throw new Error('Research consumer forbids network access'); };
let db;
try {
  const expected = { state: 'LITERATURE_GATE', attempts: 1, replayed: true, bytes: [97, 98, 99],
    artifactId: 'art-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', refusal: 'TRSH1001' };
  assert.deepEqual(await qualifyResearchBrowser(), expected);
  assert.deepEqual(await qualifyResearchDiscoveryBrowser(), { doi: '10.5555/packed', rawHash: true, requests: 1, misses: 0, networkCalls: 0 });
  assert.deepEqual(await qualifyResearchReasoningBrowser(), { packs: 7, participants: 3, separateSynthesizer: true, generatedPlanSchema: true });
  assert.deepEqual(await qualifyResearchExecutionBrowser(), { status: 'ok', value: 2, signature: true, physical: 1, isolated: false, forged: 'TRSH1006', network: 'TRSH1010' });
  assert.deepEqual(await qualifyResearchAnalysisBrowser(), { support: 'not-supported', underpowered: true, decision: 'Stop', candidates: 1, reviewers: 2 });
  assert.deepEqual(await qualifyResearchWritingBrowser(), { sections: 6, files: 7, rerun: true, disclosure: 8, tex: ['main.tex', 'references.bib'], refused: 'TRSH1002' });
  assert.deepEqual(await qualifyResearchCommandsBrowser(), { mode: 'gate-only', experimental: true, pending: true, parent: true, immutable: true, refused: 'TRSH1005', total: 3, substantive: 1 });
  await qualifyInstalledCommands(directory);
  const path = join(directory, 'research.db'); db = await openTangleDb({ path });
  const run = await exerciseResearchConsumer(createResearchStore(db)); assert.deepEqual(run.summary, expected);
  const runLogId = await researchRunLogId(db, 'packed-research'); assert.ok(runLogId);
  await db.close(); db = await openTangleDb({ path });
  const replay = await createResearchStore(db).commitStage(run.plan); assert.ok(replay.ok && replay.replayed);
  assert.equal((await createRunLog(db).frames(runLogId)).length, 1);
  const lifecycle = await runResearchExample(join(directory, 'research-lifecycle.db'));
  assert.equal(lifecycle.status, 'COMPLETE'); assert.equal(lifecycle.approvals, 3);
  assert.equal(lifecycle.executions, 10); assert.equal(lifecycle.replayExecutions, 0); assert.equal(lifecycle.artifactIds.length, 26);
  assert.deepEqual(lifecycle.spend, { turns: 0, tokens: 0, ms: 0 });
  console.log(JSON.stringify({ researchInstalled: true, reopened: true, ...expected }));
} finally { await db?.close(); globalThis.fetch = original; }
