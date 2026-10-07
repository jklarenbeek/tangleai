/** Keyless state conformance: fake JSON artifacts and explicitly synthetic gate observations. */
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createDagJobRunner, type JobOutcome } from '@jarenjs/db';
import { compileDag } from '@jarenjs/flow';
import { resolveProfile, type ProfileRegistry, type HostManifest } from '@tangleai/config';
import { createExperientialMemoryStore, createExperientialDeployment, sealExperientialRecord, sealExperientialSelectionPolicy,
  planExperienceTransition, planExperientialSelection, planExperientialDataset, EXPERIENTIAL_EXAMPLE_TEMPLATE,
  createFakeTrainingBackend, planExperientialTraining, createExperientialTrainingTasks, experientialTrainingJobKind,
  EXPERIENTIAL_TRAINING_DAG, planExperientialEvaluation, createExperientialEvaluation, EXPERIENTIAL_EVALUATION_ROWS,
  EXPERIENTIAL_RETENTION_LANES, planExperientialActivation, planExperientialRollback, resolveExperientialInference,
  resolveExperientialLineage, createExperientialRunner, EXPERIENTIAL_TABLES,
  type ExperientialTrainingRecipe, type ExperientialResult, type ExperientialSelectionInput, type ExperientialStore,
  type ExperientialArtifact, type ExperientialEvaluationMetrics, type ExperientialInferencePin, type TrainingSpec } from '@tangleai/experiential';
import { openTangleDb, createExperientialDbStore, createIdentityRepository, enqueueExperientialTraining,
  createExperientialTrainingRunner } from '@tangleai/store';

const must = <T>(result: ExperientialResult<T>): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
};
const profile = 'experiential-example', scope = 'experiential-example', epoch = '2026-09-13T00:00:00.000Z';
const runtime = { provider: 'ollama', base: 'http://localhost:11434/v1', servedModel: 'example-base' };
const registry: ProfileRegistry = { version: 1, credentialSlots: [], capabilities: [], prompts: [], responseSchemas: [], components: [], inference: [], budgets: [],
  candidates: [
    { id: 'example-base', kind: 'chat', provider: 'ollama', model: runtime.servedModel, baseUrl: runtime.base, credentialSlot: null, features: [], rateCard: null },
    { id: 'example-embedding', kind: 'embedding', provider: 'builtin', model: 'hash-trigram-64', dims: 64, baseUrl: null, credentialSlot: null, features: [], rateCard: null },
  ], profiles: [{ id: profile, kind: 'root', description: 'Synthetic deployment conformance; no provider calls.',
    roles: { chat: { candidate: 'example-base', capability: null, prompt: null, responseSchema: null, tools: [], toolsRequired: false, inference: null, ranker: null } },
    embedding: 'example-embedding', policyComponent: null, budget: null }] };
const host: HostManifest = { sourceClass: 'synthetic', credentialSlots: [], providers: [{ provider: 'ollama', base: runtime.base, models: [runtime.servedModel], features: [] }],
  embedding: [{ provider: 'builtin', base: null, model: 'hash-trigram-64', dims: 64 }], tools: [], components: [],
  budget: { maxCalls: 1, maxTokens: null, maxMs: null, maxConcurrency: 1 }, observation: null };
const request = { kind: 'profile' as const, profile, overrides: null };

export async function runExperientialExample(options: { storage?: 'memory' | 'sqlite'; database?: string; tick?: boolean } = {}) {
  const clock = { value: Date.parse(epoch) }, now = () => new Date(clock.value).toISOString();
  const db = await openTangleDb({ path: options.database ?? ':memory:', jobs: { now: () => clock.value, random: () => 0.5, backoffBase: 0, backoffCap: 0 } });
  const memory = options.storage === 'sqlite' || options.tick ? null : createExperientialMemoryStore({ now });
  const store: ExperientialStore = memory ?? createExperientialDbStore(db, { now });
  const originalFetch = globalThis.fetch; let physicalRequests = 0, submissions = 0;
  globalThis.fetch = (() => { physicalRequests++; throw new Error('This example must not make network requests.'); }) as typeof fetch;
  try {
    const resolved = await resolveProfile({ registry, request, host }); assert.ok(resolved.ok, JSON.stringify(resolved));
    const identity = resolved.identity, identities = createIdentityRepository(db);
    assert.ok((await identities.put(identity)).ok);
    const common = { schemaVersion: 1 as const, scope, recordedAt: epoch };
    const principal = { kind: 'operator' as const, id: 'synthetic-example-operator', authorityId: await canonicalSha256('synthetic-example-authority') };
    const base = must(await sealExperientialRecord('artifact', { ...common, document: 'experiential-artifact', kind: 'base', method: null,
      checksum: await canonicalSha256('authored example base registration'), baseArtifactId: null, trainingRunId: null,
      storageUri: 'memory:experiential-example/base', runtime, state: 'staged', sizeBytes: 1 }));
    must(await store.put('artifacts', base));
    let deployment = must(await createExperientialDeployment({ profile, scope, candidateId: 'example-base', baseArtifact: base,
      recordedAt: epoch, operationalLimits: { maxFailureRate: 0.1, maxP95Ms: 100, window: 20 } }));
    must(await store.put('deployments', deployment));
    const policy = must(await sealExperientialSelectionPolicy({ scope, minimumSupport: 1, requireIndependentOutcome: true,
      allowedTrust: ['verified', 'operator'], allowedPrivacy: ['public', 'internal'], requireGeneralizable: true, requireApproval: true, principalKinds: ['operator', 'policy'] }));
    const input: ExperientialSelectionInput = { policy, experiences: [], assessments: [], approvals: [], trustView: { sources: [], producers: [] } };
    const variables: Array<{ experienceId: string; question: string; answer: string }> = [];
    for (let i = 0; i < 12; i++) {
      const text = { question: 'Authored demonstration question ' + i, answer: 'Independently supplied demonstration answer ' + i };
      const contentDigest = await canonicalSha256(text), sourceId = 'example-episode-' + i, digest = await canonicalSha256({ sourceId, text });
      const outcomeId = 'example-outcome-' + i, outcomeDigest = await canonicalSha256({ outcomeId, contentDigest, value: 1 });
      const ref = { sourceId, digest, kind: 'episode' };
      const experience = must(await sealExperientialRecord('experience', { ...common, document: 'experiential-experience',
        taskRef: ref, inputRef: ref, outputRef: ref, sourceRefs: [ref], producingIdentityId: identity.identityId,
        observedOutcome: { sourceId: outcomeId, digest: outcomeDigest, kind: 'outcome', value: 1 },
        trust: 'verified', privacy: 'internal', state: 'observed', contentDigest }));
      must(await store.put('experiences', experience));
      const assessment = must(await sealExperientialRecord('assessment', { ...common, document: 'experiential-assessment',
        experienceId: experience.id, author: { kind: 'operator', principalId: principal.id }, policyRevision: policy.revision,
        generalizable: true, rationale: 'Authored independent conformance evidence.', duplicateOf: null, contradiction: 'none',
        trustDecision: 'verified', inclusion: 'include', reason: 'synthetic-conformance', supportingIds: [outcomeDigest] }));
      must(await store.put('assessments', assessment));
      const eligible = must(planExperienceTransition(experience, 'eligible')); must(await store.transition(eligible));
      const selected = must(planExperienceTransition(eligible.after, 'selected')); must(await store.transition(selected));
      input.experiences = [...input.experiences, selected.after]; input.assessments = [...input.assessments, assessment];
      input.approvals = [...input.approvals, { scope, action: 'select', experienceId: experience.id, assessmentId: assessment.id,
        policyRevision: policy.revision, principal, reason: 'Authored selection conformance approval.' }];
      input.trustView.sources.push({ ...ref, scope, producerId: 'example-source-host', trust: 'verified', privacy: 'internal', parents: [], outcome: null },
        { sourceId: outcomeId, digest: outcomeDigest, kind: 'independent-outcome', scope, producerId: 'example-independent-evaluator',
          trust: 'verified', privacy: 'internal', parents: [], outcome: { contentDigest, value: 1 } });
      variables.push({ experienceId: experience.id, ...text });
    }
    input.trustView.producers.push({ identityId: identity.identityId, producerId: 'example-observation-producer' });
    const selection = must(await planExperientialSelection(input)); assert.equal(selection.counts.selected, 12);
    const { dataset } = must(await planExperientialDataset(selection, { seed: 17753, splitRatios: { validation: 0.2, replay: 0.2 },
      groupKeyOf: experience => ({ sourceEpisodeId: experience.sourceRefs[0].sourceId, duplicateFamilyId: experience.contentDigest }),
      conceptsOf: experience => [experience.sourceRefs[0].sourceId], holdoutPairsOf: () => [], template: EXPERIENTIAL_EXAMPLE_TEMPLATE,
      tokenizerIdentity: 'synthetic-example-tokenizer/v1', chatTemplateIdentity: 'synthetic-example-chat/v1', recordedAt: epoch }));
    must(await store.put('datasets', dataset));
    if (options.tick) {
      const backend = createFakeTrainingBackend({ seed: 17753, clock: () => clock.value, baseModels: [base.id], runtime });
      const recipe: ExperientialTrainingRecipe = { profile, runtime, method: 'lora',
        hyperparameters: { rank: 8, epochs: 1, learningRate: 0.001 }, seed: 17753, precision: 'fp32',
        budget: { maxRecords: 12, maxBytes: 100000, maxWallMs: 60000, maxPolls: 8, maxSpend: null } };
      const sleep = async (ms: number, signal?: AbortSignal) => { signal?.throwIfAborted(); clock.value += ms; };
      const beforeHead = must(await store.head(profile, scope)), beforeApprovals = must(await store.list('approvals', scope));
      const runner = await createExperientialRunner({ store, backend, recipe, now: () => clock.value, sleep,
        jobs: { enqueue: plan => enqueueExperientialTraining(db, plan) },
        policy: { enabled: true, minimumEligible: 12, maxCadenceMs: 1000, scopeCooldownMs: 0,
          computeBudget: { maxRunsPerDay: 2, maxSpend: null }, maxQueued: 1, concurrency: 1, maxQueue: 4 } });
      let worker;
      try {
        const triggers = [
          { scope, kind: 'count' as const, key: 'example-count' },
          { scope, kind: 'time' as const, key: 'example-time' },
          { scope, kind: 'manual' as const, key: 'example-manual' },
        ];
        assert.equal(must(await runner.run(triggers[1])).reason, 'cadence');
        clock.value += 1000;
        const first = must(await runner.run(triggers[0])); assert.equal(first.action, 'enqueued');
        assert.equal(must(await runner.run(triggers[2])).reason, 'queue-full');
        let finish!: () => void, fail!: (error: Error) => void;
        const completed = new Promise<void>((yes, no) => { finish = yes; fail = no; });
        worker = await createExperientialTrainingRunner(db, { backend, clock: () => clock.value, random: () => 0.5,
          sleep, budgets: recipe.budget, readBytes: backend.readBytes, compileDag, pollInterval: 5, leaseMs: 300000,
          resolveExamples: async () => ({ template: EXPERIENTIAL_EXAMPLE_TEMPLATE,
            variables: variables.filter(value => [...dataset.splits.train, ...dataset.splits.validation].includes(value.experienceId)) }),
          onOutcome: event => {
            if (event.outcome === 'completed') finish();
            else if (event.outcome !== 'failed' || event.attempt >= recipe.budget.maxPolls + 16) fail(Error('Native tick job did not complete.'));
          } });
        worker.start(); await completed;
        assert.equal((await worker.stop({ graceMs: 1000 })).drained, true); worker = undefined;
        clock.value += 1000;
        const firstCycle = [first];
        for (const trigger of triggers.slice(1)) firstCycle.push(must(await runner.run(trigger)));
        assert.deepEqual(firstCycle.map(row => row.action), ['enqueued', 'replayed', 'replayed']);
        const snapshot = async () => Object.fromEntries(await Promise.all(EXPERIENTIAL_TABLES.map(async table => [table, must(await store.list(table, scope))])));
        const before = await snapshot(), jobs = await db.jobs!.counts(), secondCycle = [];
        for (const trigger of triggers) secondCycle.push(must(await runner.run(trigger)));
        assert.ok(secondCycle.every(row => row.action === 'replayed' && row.jobId === first.jobId));
        assert.deepEqual(await snapshot(), before); assert.deepEqual(await db.jobs!.counts(), jobs);
        const afterHead = must(await store.head(profile, scope));
        assert.deepEqual(afterHead.head, beforeHead.head); assert.equal(afterHead.eventId, beforeHead.eventId);
        assert.deepEqual(must(await store.list('approvals', scope)), beforeApprovals);
        const [run] = must(await store.list('training_runs', scope)); assert.equal(run.state, 'complete');
        const artifact = must(await store.get('artifacts', run.progress!.artifactId!)); assert.ok(artifact);
        assert.equal(artifact.state, 'staged'); assert.equal(backend.stats().submissions, 1); assert.equal(physicalRequests, 0);
        return { tier: 'synthetic-cadence-conformance', storage: 'sqlite', datasetId: dataset.id, deploymentId: deployment.id,
          selected: selection.counts.selected, jobId: first.jobId, artifactId: artifact.id,
          firstCycle: firstCycle.map(row => ({ action: row.action, reason: row.reason, jobId: row.jobId })),
          secondCycle: secondCycle.map(row => ({ action: row.action, reason: row.reason, jobId: row.jobId })),
          counts: runner.stats(), newJobsOnReplay: 0, approvals: beforeApprovals.length, head: beforeHead.head,
          fakeSubmissions: backend.stats().submissions, scientificApproval: false, physicalRequests };
      } finally { await worker?.stop({ graceMs: 1000 }); await runner.close(); }
    }
    const gates = must(await sealExperientialRecord('gatePolicy', { ...common, document: 'experiential-gate-policy', primaryMetric: 'cgc',
      controls: ['frozen-retrieval', 'frozen-distilled-rule'], interval: { statistic: 'paired-bootstrap', level: 0.95, resamples: 1000, seed: 17753 },
      learning: { minLowerBound: 0 }, retention: { cgtReplayMaxDrop: 0, baseReplayMaxDrop: 0, locomoRecallMaxDrop: 0, locomoQaMaxDrop: 0 },
      security: { fixtures: ['authored-conformance-refusal'], requiredOutcome: 'refused-or-unchanged' },
      operations: { maxArtifactBytes: 4096, maxTrainingMs: 60000, maxInferenceP95Ms: 100, maxFailureRate: 0, maxCost: 0, runtimeProviders: ['ollama'] },
      rows: [...EXPERIENTIAL_EVALUATION_ROWS], requiredRows: [...EXPERIENTIAL_EVALUATION_ROWS] }));
    must(await store.put('gate_policies', gates));

    async function train(label: string, seed: number) {
      const serving = { ...runtime, servedModel: 'example-' + label };
      const backend = createFakeTrainingBackend({ seed, clock: () => clock.value, baseModels: [base.id], runtime: serving });
      const spec: TrainingSpec = { datasetId: dataset.id, manifestDigest: dataset.manifestDigest, baseArtifactId: base.id, baseChecksum: base.checksum,
        method: 'lora', hyperparameters: { rank: 8, epochs: 1, learningRate: 0.001 }, seed, precision: 'fp32',
        tokenizerIdentity: dataset.tokenizerIdentity, chatTemplateIdentity: dataset.chatTemplateIdentity,
        budget: { maxRecords: 12, maxBytes: 100000, maxWallMs: 60000, maxPolls: 8, maxSpend: null } };
      const plan = must(await planExperientialTraining({ dataset, base, spec, backendIdentity: backend.identity, runtime: serving, recordedAt: now() }));
      const context = { store, backend, clock: () => clock.value, random: () => 0.5, budgets: spec.budget,
        sleep: async (ms: number, signal?: AbortSignal) => { signal?.throwIfAborted(); clock.value += ms; },
        resolveExamples: async () => ({ template: EXPERIENTIAL_EXAMPLE_TEMPLATE,
          variables: variables.filter(value => [...dataset.splits.train, ...dataset.splits.validation].includes(value.experienceId)) }),
        readBytes: backend.readBytes };
      let finish!: () => void, fail!: (error: Error) => void;
      const completed = new Promise<void>((yes, no) => { finish = yes; fail = no; });
      const onOutcome = (event: JobOutcome) => {
        if (event.outcome === 'completed') finish();
        else if (event.outcome !== 'failed' || event.attempt >= spec.budget.maxPolls + 16) fail(new Error('Native example job did not complete.'));
      };
      let worker;
      if (memory) {
        // The native queue owns retry and checkpoints; only the example's domain rows are in memory.
        must(await store.put('training_runs', plan.run));
        const kind = experientialTrainingJobKind(plan.pipelineRevision);
        await db.jobs!.enqueue(kind, { input: plan.input }, { id: plan.idempotencyKey, maxAttempts: spec.budget.maxPolls + 16 });
        worker = createDagJobRunner(db, { compileDag, documents: { [kind]: EXPERIENTIAL_TRAINING_DAG },
          tasks: createExperientialTrainingTasks(context), pollInterval: 5, leaseMs: 300000, backoffBase: 0, backoffCap: 0,
          effectSafety: async () => true, onOutcome }); // The in-process fake submit is idempotent.
      } else {
        await enqueueExperientialTraining(db, plan);
        worker = await createExperientialTrainingRunner(db, { ...context, compileDag, pollInterval: 5, leaseMs: 300000, onOutcome });
      }
      worker.start();
      try { await completed; } finally { assert.equal((await worker.stop({ graceMs: 1000 })).drained, true); }
      const run = must(await store.get('training_runs', plan.run.id)); assert.ok(run);
      assert.equal(run.state, 'complete', JSON.stringify({ stopReason: run.stopReason, progress: run.progress }));
      assert.equal(backend.stats().submissions, 1); submissions += backend.stats().submissions;
      const artifact = must(await store.get('artifacts', run.progress!.artifactId!)); assert.ok(artifact);
      assert.equal(artifact.state, 'staged'); return artifact;
    }
    async function evaluate(artifact: ExperientialArtifact) {
      const head = must(await store.head(profile, scope));
      const baseline = head.head.versionId ? must(await store.get('artifacts', head.head.versionId))! : base;
      const registration = must(await planExperientialEvaluation({ artifact, baseline, dataset, policy: gates, head, sampleCount: 32,
        evaluatorRevision: await canonicalSha256('recorded-conformance-evaluator/v1'), questionSetId: await canonicalSha256('recorded-conformance-values/v1'), recordedAt: now() }));
      must(await store.startEvaluation(registration));
      // These are explicit test values. No CGT candidate, retained capability, latency or model quality was measured here.
      const measurements: ExperientialEvaluationMetrics = { scope, gatePolicyId: gates.id, migrationExperiment: false,
        rows: EXPERIENTIAL_EVALUATION_ROWS.map(rowId => ({ rowId, status: 'run', cgc: rowId === 'candidate-no-retrieval' ? 0.75 : 0.5,
          retention: 1, failures: 0, cost: null, identityId: identity.identityId, samples: 32 })),
        interval: gates.controls.map(control => ({ control, low: 0.125, high: 0.375, seed: 17753, resamples: 1000, level: 0.95, pairs: 32 })),
        retention: EXPERIENTIAL_RETENTION_LANES.map(lane => ({ lane, status: 'run', drop: 0 })),
        security: [{ fixtureId: 'authored-conformance-refusal', outcome: 'unchanged' }],
        operations: { status: 'run', artifactBytes: artifact.sizeBytes, trainingMs: 1, inferenceP95Ms: 1, failureRate: 0, cost: 0, runtimeProvider: 'ollama' }, cost: null };
      const evaluation = must(await createExperientialEvaluation({ registration: registration.registration, policy: gates, measurements,
        reportId: await canonicalSha256({ fixture: 'recorded-conformance-only', artifactId: artifact.id }), recordedAt: now() }));
      const result = must(await store.recordEvaluation(evaluation)); assert.equal(result.after.state, 'approved');
      return { artifact: result.after, evaluation };
    }
    async function approve(candidate: Awaited<ReturnType<typeof evaluate>>, action: 'activate' | 'canary' | 'rollback', reason: string) {
      deployment = must(await store.get('deployments', deployment.id))!;
      const head = must(await store.head(profile, scope));
      const artifact = must(await store.get('artifacts', candidate.artifact.id))!;
      const approval = must(await sealExperientialRecord('approval', { ...common, document: 'experiential-approval', recordedAt: now(), profile,
        artifactId: artifact.id, evaluationId: candidate.evaluation.id, expectedHead: head.head,
        deploymentId: deployment.id, expectedDeploymentRevision: deployment.revision, rolloutFraction: action === 'canary' ? 0.25 : null,
        action, principal, reason }));
      must(await store.put('approvals', approval));
      const input = { head, deployment, artifact, evaluation: candidate.evaluation, approval };
      const plan = action === 'rollback' ? must(planExperientialRollback({ ...input, reason })) : must(planExperientialActivation(input));
      const result = must(await (action === 'rollback' ? store.rollback(plan) : store.activate(plan)));
      deployment = plan.nextDeployment; return result;
    }
    // Establish one approved synthetic predecessor so the drill restores an exact retained artifact.
    const previous = await evaluate(await train('previous', 17753)); await approve(previous, 'activate', 'Establish the synthetic predecessor.');
    const candidate = await evaluate(await train('candidate', 17754)); await approve(candidate, 'canary', 'Canary the recorded-value conformance candidate.');
    let routed = 0, inFlight: ExperientialInferencePin | undefined;
    const artifacts = must(await store.list('artifacts', scope));
    for (let i = 0; i < 1000; i++) {
      const choice = must(await resolveExperientialInference({ registry, request, host, deployment, artifacts, capability: { trainable: true },
        runId: 'synthetic-run-' + i, recordedAt: now() }));
      must(await store.pin(choice.pin)); if (choice.pin.canary) { routed++; inFlight ??= choice.pin; }
    }
    assert.ok(Math.abs(routed - 250) <= 60); assert.ok(inFlight);
    await approve(candidate, 'activate', 'Activate the recorded-value conformance candidate.');
    assert.deepEqual(must(await store.get('pins', inFlight.id)), inFlight);
    assert.equal((await store.pin(inFlight)).ok, false);
    const restored = await approve(previous, 'rollback', 'Restore the exact synthetic predecessor after the operational drill.');
    assert.equal(restored.head.versionId, previous.artifact.id); assert.equal(restored.head.revision, 3);
    assert.equal(must(await store.get('artifacts', candidate.artifact.id))?.state, 'archived');
    assert.equal(must(await resolveExperientialLineage(store, candidate.artifact.id)).experiences.length, 12);
    assert.equal(physicalRequests, 0); assert.equal(submissions, 2);
    return { tier: 'synthetic-deployment-conformance', storage: memory ? 'memory' : 'sqlite', selected: selection.counts.selected,
      datasetId: dataset.id, deploymentId: deployment.id, previousArtifactId: previous.artifact.id, candidateArtifactId: candidate.artifact.id,
      fakeSubmissions: submissions, trainingExamples: dataset.splits.train.length, validationExamples: dataset.splits.validation.length,
      retainedReplayExamples: dataset.splits.replay.length, pins: 1000, rolloutFraction: 0.25, routed, tolerance: 60, inFlightUnchanged: true,
      restoredHead: restored.head, failedArtifactRetained: true, scientificApproval: false, physicalRequests };
  } finally { globalThis.fetch = originalFetch; await memory?.close(); await db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { sqlite: { type: 'boolean' }, database: { type: 'string' }, tick: { type: 'boolean' } } });
  console.log(JSON.stringify(await runExperientialExample({ storage: values.sqlite ? 'sqlite' : 'memory', database: values.database, tick: values.tick }), null, 2));
}
