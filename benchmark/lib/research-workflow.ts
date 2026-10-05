/** Measured native lifecycle execution; retained science and scripted controls are separate. */
import { canonicalizeJson, canonicalSha256 } from '@jarenjs/json/canonical';
import { equalsJson } from '@jarenjs/core/object';
import { JarenValidator } from '@jarenjs/validate';
import { compileMasRuntime, validateRuntimeRecord, interactionIdOf, type MasStore } from '@tangleai/mas';
import { openTangleDb, createMasStore, createResearchStore, createMasSegmentDriver, ensurePendingMasSegments } from '@tangleai/store';
import { researchValue, createResearchBinding, planProjectCreate, initialResearchFrame, prepareResearchWorkflow,
  createResearchTaskHandlers, createResearchHostBindings, createDiscoveryStageTools, inputManifestHashOf, checkResearchGate, gateResponseSchema,
  type ResearchTaskTools, type ResearchStageOperation, type ResearchStageAccess, type ResearchStageResult,
  type ResearchProject, type ResearchWorkflowFrame, type ResearchWorkflowBinding } from '@tangleai/research';
import { researchExampleIdentity, researchExampleTools, researchExampleLimits } from '../../examples/research.ts';
import { executeResearchFixturePrograms, evaluateResearchFixturePrograms, assembleResearchFixtureBundle } from './research-runner.ts';
import { researchMechanicalDecision, evaluateResearchRun } from './research-evaluator.ts';
import { researchBytesSha256, type LoadedResearchFixture } from './research-fixture.ts';
import { requireResearchShape } from './research-validation.ts';
import { researchDiscoveryConfiguration, createResearchDiscoveryFixture } from './research-discovery.ts';
import { researchExecutionFixture } from './research-execution-fixture.ts';
import type { ResearchFixtureTopic, ResearchDataset, ExperimentRun, MetricObservation, ResearchWorkflowMeasurement } from './research.types.ts';

const artifact = (value: unknown) => ({ mediaType: 'application/vnd.tangleai.research-value+json', bytes: new TextEncoder().encode(canonicalizeJson(value)) });
const zero = { calls: 0, tokens: 0, ms: 0, physical: 0 };
function orderRuns(topic: ResearchFixtureTopic, values: ExperimentRun[]): ExperimentRun[] {
  const ordered = topic.plan.conditions.flatMap(condition => topic.contract.replicatePolicy.seeds.map(seed =>
    values.find(run => run.id === `${topic.id}-${condition.id}-seed-${seed}`)));
  if (ordered.length !== values.length || ordered.some(run => !run)) throw Error('Native research run census drift.');
  return ordered as ExperimentRun[];
}
function orderObservations(runs: ExperimentRun[], values: MetricObservation[]): MetricObservation[] {
  const ordered = runs.map(run => values.find(observation => observation.experimentRunId === run.id));
  if (ordered.length !== values.length || ordered.some(row => !row)) throw Error('Native research observation census drift.');
  return ordered as MetricObservation[];
}
async function tagged<T>(op: ResearchStageOperation, access: ResearchStageAccess, kind: string): Promise<T[]> {
  const found: T[] = [];
  for (const ref of op.frame.artifacts) {
    if ((await access.describeArtifact(ref)).mediaType !== 'application/vnd.tangleai.research-value+json') continue;
    const value = JSON.parse(new TextDecoder().decode(await access.readArtifact(ref)));
    if (value.kind === kind) found.push(value.value);
  }
  return found;
}
function scientificTools(loaded: LoadedResearchFixture, topic: ResearchFixtureTopic, binding: ResearchWorkflowBinding,
  masStore: MasStore): ResearchTaskTools {
  const datasetHash = topic.contract.datasets[0].sha256;
  const datasetOf = async (op: ResearchStageOperation, access: ResearchStageAccess) => {
    const ref = op.frame.artifacts.find(ref => ref.artifactId === 'art-' + datasetHash);
    if (!ref) throw Error('Execution dataset absent from the admitted input manifest.');
    const bytes = await access.readArtifact(ref);
    if (researchBytesSha256(bytes) !== datasetHash) throw Error('Execution dataset byte hash mismatch.');
    return requireResearchShape<ResearchDataset>('ResearchDataset', JSON.parse(new TextDecoder().decode(bytes)));
  };
  return { binding, contract: topic.contract, plan: topic.plan, masStore,
    async execute(op, access): Promise<ResearchStageResult> {
      const result: ResearchStageResult = { artifacts: [], records: [], spend: zero };
      if (op.stage === 'create') result.artifacts.push({ mediaType: 'application/json', bytes: new Uint8Array(loaded.files.get(topic.datasetPath)!) });
      else if (op.stage === 'discovery') {
        const literature = loaded.literature.filter(record => record.id.startsWith(topic.id + '-paper-'));
        result.artifacts.push(artifact({ kind: 'literature-selection', value: literature.map(record => record.id) }));
        result.records.push(...literature.map(value => ({ kind: 'LiteratureRecord' as const, value })));
      } else if (op.stage === 'execute') {
        const runs = await executeResearchFixturePrograms(topic, await datasetOf(op, access));
        for (const run of runs) {
          result.records.push({ kind: 'ExperimentRun', value: run });
          result.artifacts.push(artifact({ kind: 'program-run', value: run }));
          if (run.output) result.artifacts.push(artifact(run.output));
        }
      } else if (op.stage === 'analyze') {
        const runs = orderRuns(topic, await tagged<ExperimentRun>(op, access, 'program-run'));
        for (const observation of await evaluateResearchFixturePrograms(loaded, topic, runs, await datasetOf(op, access))) {
          result.records.push({ kind: 'MetricObservation', value: observation });
          result.artifacts.push(artifact({ kind: 'observation', value: observation }));
        }
      } else if (op.stage === 'decide') {
        const runs = orderRuns(topic, await tagged<ExperimentRun>(op, access, 'program-run'));
        const observations = orderObservations(runs, await tagged<MetricObservation>(op, access, 'observation'));
        const decision = researchMechanicalDecision(topic, observations);
        result.artifacts.push(artifact({ kind: 'scientific-decision', value: decision }));
        result.records.push({ kind: 'ResearchDecision', value: decision }); result.decision = decision.kind;
      } else if (op.stage === 'write' || op.stage === 'verify') {
        const runs = orderRuns(topic, await tagged<ExperimentRun>(op, access, 'program-run'));
        const observations = orderObservations(runs, await tagged<MetricObservation>(op, access, 'observation'));
        result.artifacts.push(artifact({ kind: op.stage === 'write' ? 'metric-draft' : 'metric-verification',
          value: (await assembleResearchFixtureBundle(loaded, topic, 'no-model-runner', runs, observations)).claims }));
      } else result.artifacts.push(artifact({ kind: 'scripted-preregistration', value: { stage: op.stage,
        contractHash: topic.contract.contractHash, planHash: topic.plan.planHash } }));
      return result;
    },
    async verify(op, result, access) {
      try {
        if (op.stage === 'create' && researchBytesSha256(result.artifacts[0].bytes) !== datasetHash) throw Error('Dataset differs from preregistration.');
        if (op.stage === 'execute') {
          const dataset = await datasetOf(op, access), runs = result.records.filter(r => r.kind === 'ExperimentRun').map(r => r.value);
          orderRuns(topic, runs);
          for (const run of runs) {
            const checked = await evaluateResearchRun(topic, dataset, loaded.hidden.get(topic.id)!, run);
            if (!checked.valid) throw Error(JSON.stringify(checked.issues));
          }
        }
        if (op.stage === 'analyze') {
          const runs = orderRuns(topic, await tagged<ExperimentRun>(op, access, 'program-run'));
          const expected = await evaluateResearchFixturePrograms(loaded, topic, runs, await datasetOf(op, access));
          if (!equalsJson(result.records.filter(r => r.kind === 'MetricObservation').map(r => r.value), expected)) throw Error('Independent metric verification differs.');
        }
        if (op.stage === 'decide') {
          const runs = orderRuns(topic, await tagged<ExperimentRun>(op, access, 'program-run'));
          const observations = orderObservations(runs, await tagged<MetricObservation>(op, access, 'observation'));
          if (result.decision !== researchMechanicalDecision(topic, observations).kind) throw Error('Registered scientific decision changed.');
        }
        return { valid: true, value: null };
      } catch (cause) { return { valid: false, issues: [{ code: 'TRSH1005', path: '/verification', detail: String(cause) }] }; }
    },
  };
}

export async function runNativeResearchFixture(loaded: LoadedResearchFixture, topic: ResearchFixtureTopic,
  sourceRevision: string, kind: ResearchWorkflowMeasurement['kind'] = 'scientific') {
  const discoveryConfiguration = await researchDiscoveryConfiguration(topic);
  const domain = (await researchExecutionFixture(loaded, topic)).domain;
  const identity = await researchExampleIdentity(), binding = await createResearchBinding(topic.contract, {
    identity, promptRevision: researchBytesSha256(loaded.files.get('prompts/fixture-writer.json')!),
    toolVersions: [{ name: 'native-stages', version: await canonicalSha256({ sourceRevision, kind }) },
      { name: 'scholarly-discovery', version: discoveryConfiguration.revision },
      ...loaded.manifest.programs.map(program => ({ name: program.id, version: program.sha256 }))],
    evaluator: topic.plan.evaluator, reservation: zero, domain: domain.manifest });
  const limits = { ...researchExampleLimits, ms: loaded.manifest.caps.ms, contextChars: loaded.manifest.caps.contextChars, traceBytes: loaded.manifest.caps.traceBytes };
  const project: ResearchProject = { id: topic.contract.projectId, topic: topic.title, domainProfile: 'computational',
    question: kind === 'scientific' ? topic.contract.hypothesisSpace.join('; ') : 'Scripted complete-path control; no scientific decision claim',
    owner: 'benchmark', mode: 'gate-only', safetyClass: 'computational', status: 'CREATED',
    budget: { calls: limits.calls, tokens: limits.tokens, ms: limits.ms, physical: limits.calls }, createdAt: '2026-01-01T00:00:00.000Z' };
  const prepared = await prepareResearchWorkflow(topic.contract, { binding, profile: 'research-scripted', limits });
  const frame = await initialResearchFrame(project, topic.plan, binding), now = () => '2026-01-01T00:00:00.000Z';
  const db = await openTangleDb({ jobs: { now: () => 1000000, random: () => 0.5 } });
  let discoveryHost: Awaited<ReturnType<typeof createResearchDiscoveryFixture>> | undefined;
  try {
    const masStore = createMasStore(db, { now }), researchStore = createResearchStore(db, { now }), taskExecutions: string[] = [];
    let tools = kind === 'scientific' ? scientificTools(loaded, topic, binding, masStore)
      : researchExampleTools({ binding, contract: topic.contract, plan: topic.plan, masStore });
    tools = { ...tools, domain };
    if (kind === 'scientific') {
      discoveryHost = await createResearchDiscoveryFixture(loaded, topic, db, async () => {
        const current = researchValue(await researchStore.snapshot(project.id))!;
        if (current.state.status !== 'DISCOVERY' || !current.records.some(r => r.kind === 'QueryPlan' && r.id === discoveryConfiguration.plan.id)
          || !current.records.some(r => r.kind === 'InclusionCriteria' && r.id === discoveryConfiguration.criteria.id))
          throw Error('Provider request preceded durable discovery plan admission.');
      });
      tools = await createDiscoveryStageTools(tools, discoveryHost.options);
    }
    const execute = tools.execute;
    const handlers = createResearchTaskHandlers(researchStore, { ...tools, execute: async (op, access) => { taskExecutions.push(op.stage); return execute(op, access); } });
    const compiled = compileMasRuntime(prepared.validated, prepared.plan, prepared.snapshot,
      createResearchHostBindings({ masStore, researchStore, taskHandlers: handlers, prepared, now, clock: () => 0 }));
    if (!compiled.valid) throw Error(JSON.stringify(compiled.issues));
    researchValue(await researchStore.createProject(researchValue(planProjectCreate(project))));
    const run = await masStore.createRun({ runId: project.id, workflowId: prepared.workflow.workflowId, workflowVersionId: prepared.workflow.versionId,
      registryRevision: prepared.snapshot.revision, executableRevision: prepared.plan.executableRevision,
      configRegistryRevision: prepared.catalog.revision, profile: 'research-scripted', input: { frame }, limits });
    if (!run.ok) throw Error(JSON.stringify(run));
    const driver = createMasSegmentDriver(db, masStore, { owner: 'research-instrument', leaseMs: 1000 }); await driver.enqueue(run.value);
    let duplicateResponses = 0;
    for (let segment = 0; segment < 4; segment++) {
      if (!await driver.drive(prepared.plan.executableRevision, compiled.value.executeSegment, new AbortController().signal)) throw Error('Native segment was not queued.');
      const trace = (await masStore.readTrace(project.id))!;
      if (trace.run.status === 'completed') break;
      if (trace.run.status !== 'waiting_for_input') throw Error('Native research failed: ' + JSON.stringify(trace.run.failure));
      const gate = trace.interactions.find(i => i.status === 'waiting')!, prompt = gate.prompt as ResearchWorkflowFrame;
      const response = { decision: 'approve', approvedManifestHash: prompt.gate!.manifestHash, note: '', actor: 'scripted' };
      const key = topic.id + '-' + prompt.gate!.kind + '-approval';
      const accepted = await masStore.respondInteraction(gate.id, response, gate.revision, key), before = taskExecutions.length;
      if (!accepted.ok || !equalsJson(accepted, await masStore.respondInteraction(gate.id, response, gate.revision, key)) || taskExecutions.length !== before)
        throw Error('Native duplicate approval did not replay exactly.');
      duplicateResponses++;
      await ensurePendingMasSegments(db, masStore);
    }
    const trace = (await masStore.readTrace(project.id))!, snapshot = researchValue(await researchStore.snapshot(project.id))!;
    if (!validateRuntimeRecord('masRun', trace.run).valid || trace.run.status !== 'completed') throw Error('Native research did not complete.');
    const approved = new Set<string>();
    for (const interaction of trace.interactions) {
      const prompt = interaction.prompt as ResearchWorkflowFrame, gate = await checkResearchGate(prompt, prompt.gate!.kind);
      const response = interaction.response as { decision: string; approvedManifestHash: string; actor: string };
      const expectedSchema = gateResponseSchema(gate.kind, gate.manifestHash);
      if (!validateRuntimeRecord('masInteraction', interaction).valid || interaction.id !== interactionIdOf(project.id, interaction.path)
        || interaction.status !== 'responded' || !equalsJson(interaction.responseSchema, expectedSchema)
        || !new JarenValidator({ skipErrors: false, collectErrors: true }).compile(expectedSchema)(interaction.response).valid
        || response.decision !== 'approve' || response.actor !== 'scripted' || response.approvedManifestHash !== gate.manifestHash)
        throw Error('Measured native gate evidence does not verify.');
      approved.add(gate.kind);
    }
    const attempts = snapshot.attempts.map(row => row.attempt), manifests = snapshot.records.filter(r => r.kind === 'InputManifest').map(r => r.value);
    for (const attempt of attempts) if (!await Promise.all(manifests.map(inputManifestHashOf)).then(hashes => hashes.includes(attempt.inputManifestHash)))
      throw Error('Measured attempt has no retained input manifest.');
    const measurement = requireResearchShape<ResearchWorkflowMeasurement>('ResearchWorkflowMeasurement', { kind, runId: project.id,
      bindingId: binding.id, runIdentityId: binding.runIdentityId, workflowVersionId: prepared.workflow.versionId, registryRevision: prepared.snapshot.revision,
      executableRevision: prepared.plan.executableRevision, nativeStatus: trace.run.status, state: snapshot.state, attempts, manifests,
      artifacts: snapshot.artifacts.filter(a => snapshot.committedAdmissionIds.includes(a.id)), interactions: trace.interactions,
      spend: trace.run.budget.spent, providerCalls: 0, taskExecutions, duplicateResponses,
      gateBehaviour: { passed: approved.size, total: 3, value: approved.size / 3 } });
    const runs = kind === 'scientific' ? orderRuns(topic, snapshot.records.filter(r => r.kind === 'ExperimentRun').map(r => r.value)) : [];
    const observations = kind === 'scientific' ? orderObservations(runs, snapshot.records.filter(r => r.kind === 'MetricObservation').map(r => r.value)) : [];
    const bundle = kind === 'scientific' ? await assembleResearchFixtureBundle(loaded, topic, 'no-model-runner', runs, observations) : null;
    return { bundle, measurement, identity, discovery: discoveryHost ? await discoveryHost.measure(snapshot) : null };
  } finally { await discoveryHost?.close(); await db.close(); }
}
