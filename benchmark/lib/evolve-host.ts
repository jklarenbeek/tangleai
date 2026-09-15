/**
 * The executor the registration was written for.
 *
 * One function runs one registered proposal all the way through —
 * prepare, isolate, apply, gate, rerun, measure, decide, settle, record —
 * and every judgement along the way belongs to `@tangleai/evolve`. Nothing
 * here decides anything: this file wires a repository, a runner, a store
 * and a fence together and reports what came back. That separation is the
 * point of the campaign. A mechanism that scored itself would be free to
 * grade generously, so the instrument owns the oracle and the package owns
 * the decisions, and neither can quietly become the other.
 *
 * Two things are per-ROW rather than per-run, and both are determinism
 * rather than tidiness. The transcript is keyed by leg id, and leg ids
 * repeat across experiments — one shared transcript would let experiment
 * two's gate overwrite experiment one's, and hand a reviewer the wrong
 * text. The effect driver is built around that transcript's classifier, so
 * it is per-row for the same reason. The repository, runner, worktree host
 * and stores are shared, because they are the things that must be the same
 * for every row to be comparable.
 *
 * Nothing that varies between two runs of the same tree may reach a row.
 * A gate prints durations, so byte counts and record ids move run to run —
 * they live in the evolve store, which is thrown away, and never in the
 * report, which is committed.
 */

import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createExternalEffects } from '@jarenjs/flow';
import { openTangleDb, createEvolveEffectStore } from '@tangleai/store';
import { createMemoryOutcomeStore, createOutcomeService, outcomeRevision } from '@tangleai/outcomes';
import {
  createProcessRunner, validateGitArgs, createWorktreeHost, createEffectExecutor,
  createEffectDriver, createEvolveClassifier, createTranscript, authorizeEffect, neverWriteSet,
  runGate, earnsRerun, measureFitness, applyProposal, settleExperiment,
  type ProcessRunner, type WorktreeHost,
} from '@tangleai/evolve/host';
import {
  compileSurfacePolicy, createPatchRefiner, createMemoryEvolveStore, sealRecord,
  recordExperimentOutcome, resolveEvolveEvidence, createSourceRegistry, planExperimentDecision,
  DEFAULT_EVOLVE_BUDGETS, AUTOMATION_PRINCIPAL, ok, refuseOne,
  type EvolveStore, type PlannedDecision,
} from '@tangleai/evolve';
import { createExperimentOutcomeAdapter } from '@tangleai/evolve/adapters/experiment';
import type { EvolveBudgets, EvolveDecision, EvolveExperiment, EvolveGateResult, EvolveMeasurement } from '@tangleai/evolve/contracts';

import { materializeEvolveFixture, FIXTURE_IDENTITY, type LoadedEvolveFixture } from './evolve-fixture.ts';
import type { Manifest as EvolveManifest, Row } from './evolve.types.ts';

/** The registered epoch, in the millisecond form the outcome service accepts. */
export const FIXTURE_EPOCH = new Date(FIXTURE_IDENTITY.date).toISOString();

/** One experiment's outcome chronology, ten seconds apart so none overlap. */
export const epochFor = (index: number): string =>
  new Date(Date.parse(FIXTURE_EPOCH) + index * 10_000).toISOString();

/** The registered budgets, in the record's own vocabulary. */
export function experimentBudgets(manifest: EvolveManifest): EvolveBudgets {
  return {
    ...DEFAULT_EVOLVE_BUDGETS,
    patchBytes: manifest.budgets.patchBytes,
    patchFiles: manifest.budgets.patchFiles,
    legMs: manifest.budgets.gateTimeoutMs,
    stdoutBytes: manifest.budgets.stdoutBytes,
    stderrBytes: manifest.budgets.stderrBytes,
    workspaceBytes: manifest.budgets.workspaceBytes,
    samples: manifest.budgets.samples,
  };
}

/** What a whole run spent, beside what each row decided. */
export interface HostCounters {
  processRuns: number;
  worktreesCreated: number;
  worktreesRemoved: number;
  branchesLeft: number;
  protectedRefWrites: number;
}

export interface ExperimentHost {
  repositoryRoot: string;
  worktreeRoot: string;
  baseRevision: string;
  runner: ProcessRunner;
  host: WorktreeHost;
  effects: ReturnType<typeof createEvolveEffectStore>;
  evolveStore: EvolveStore;
  outcomeStore: ReturnType<typeof createMemoryOutcomeStore>;
  adapter: Awaited<ReturnType<typeof createExperimentOutcomeAdapter>>;
  revision: string;
  budgets: EvolveBudgets;
  gateArgs: string[];
  instrumentArgs: string[];
  registration: LoadedEvolveFixture;
  counters: HostCounters;
  /** Build a row-private fence: its own transcript, classifier and driver. */
  fenceFor(): { driver: ReturnType<typeof createEffectDriver>, transcript: ReturnType<typeof createTranscript> };
  protectedRefs(): Promise<string>;
}

const MEMORY_OF = (strategyId: string): string => 'evolve-strategy:' + strategyId;

/**
 * Materialize the registered repository with a worktree root beside it —
 * never inside it — and wire the host stack over it.
 */
export async function withExperimentHost<T>(
  root: string,
  registration: LoadedEvolveFixture,
  body: (host: ExperimentHost) => Promise<T>,
): Promise<T> {
  const base = await mkdtemp(join(tmpdir(), 'evolve-run-'));
  const repositoryRoot = join(base, 'repo');
  const worktreeRoot = join(base, 'worktrees');
  await mkdir(repositoryRoot, { recursive: true });
  await mkdir(worktreeRoot, { recursive: true });

  const materialized = await materializeEvolveFixture(root, repositoryRoot);
  const manifest = registration.manifest;
  const budgets = experimentBudgets(manifest);
  const gateArgs = [...manifest.policy.gate.command.slice(1)];
  const instrumentArgs = [...manifest.policy.instrument.command.slice(1)];

  // A registered command has exactly one argv. Anything else is a different
  // command wearing its name.
  const exact = (expected: readonly string[]) => (argv: string[]) =>
    (argv.length === expected.length && argv.every((one, index) => one === expected[index])
      ? ok(true as const)
      : refuseOne<true>('TEVO1006', '/args', 'Only the registered argv is accepted.'));

  const runner = createProcessRunner({
    allow: {
      git: { file: 'git', args: validateGitArgs, cwd: 'worktree' },
      gate: { file: manifest.policy.gate.command[0], args: exact(gateArgs), cwd: 'worktree' },
      instrument: { file: manifest.policy.instrument.command[0], args: exact(instrumentArgs), cwd: 'worktree' },
      'instrument-base': { file: manifest.policy.instrument.command[0], args: exact(instrumentArgs), cwd: 'base' },
    },
    env: {
      allow: ['PATH', 'HOME'],
      set: {
        GIT_AUTHOR_NAME: FIXTURE_IDENTITY.name, GIT_AUTHOR_EMAIL: FIXTURE_IDENTITY.email,
        GIT_AUTHOR_DATE: FIXTURE_IDENTITY.date,
        GIT_COMMITTER_NAME: FIXTURE_IDENTITY.name, GIT_COMMITTER_EMAIL: FIXTURE_IDENTITY.email,
        GIT_COMMITTER_DATE: FIXTURE_IDENTITY.date,
        GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', LANG: 'C', LC_ALL: 'C', TZ: 'UTC',
      },
    },
    limits: {
      legMs: manifest.budgets.gateTimeoutMs,
      stdoutBytes: manifest.budgets.stdoutBytes,
      stderrBytes: manifest.budgets.stderrBytes,
    },
    roots: { worktree: base, repository: base, base },
  });

  const repository = {
    schemaVersion: 1 as const,
    kind: 'repository' as const,
    id: 'f'.repeat(64),
    repositoryId: manifest.fixture.id,
    vcs: 'git' as const,
    protectedRefs: ['main', 'master'],
    policy: {
      immutablePaths: [...manifest.policy.immutable.paths, ...manifest.policy.immutable.prefixes],
      generated: manifest.policy.immutable.generated.map(one => one.path),
      gate: { command: manifest.policy.gate.command[0], args: gateArgs },
      instrument: {
        command: manifest.policy.instrument.command[0], args: instrumentArgs,
        metric: {
          name: manifest.policy.truth.metric,
          direction: manifest.policy.thresholds.direction,
          schema: manifest.policy.metricSchema,
        },
      },
      thresholdsPath: manifest.policy.thresholds.path,
    },
    allow: { commands: ['git', 'gate', 'instrument', 'instrument-base'] },
    budgets,
  };

  const host = createWorktreeHost({ runner, repositoryRoot, worktreeRoot, repository: repository as never });
  const db = await openTangleDb({
    path: join(base, 'effects.sqlite'),
    jobs: { now: () => Date.parse(FIXTURE_EPOCH), random: () => 0.5 },
  });
  const effects = createEvolveEffectStore(db, { maxLegs: Math.max(manifest.budgets.samples, 2) });
  const evolveStore = createMemoryEvolveStore();
  const outcomeStore = createMemoryOutcomeStore();
  const adapter = await createExperimentOutcomeAdapter();
  const revision = await outcomeRevision({ instrument: 'evolve', manifest: registration.manifestRevision });

  // One carrier per registered strategy. The outcome lifecycle resolves
  // against these, and a citation with no carrier is a refusal — so they
  // are written once here rather than invented later.
  for (const strategy of registration.strategies) {
    await outcomeStore.memories.put({
      id: MEMORY_OF(strategy.id), kind: 'fact', text: strategy.name,
      tags: ['evolve-strategy'], evidence: strategy.evidence,
      at: FIXTURE_EPOCH, confidence: 0.5,
    });
  }

  const never = neverWriteSet({ protectedRefs: repository.protectedRefs, operatorBranch: 'main', checkedOut: [] });
  const executor = createEffectExecutor({ runner, host });
  const counters: HostCounters = {
    processRuns: 0, worktreesCreated: 0, worktreesRemoved: 0, branchesLeft: 0, protectedRefWrites: 0,
  };

  const fenceFor = () => {
    // Per row: the transcript keys on leg ids, and leg ids repeat.
    const transcript = createTranscript();
    const external = createExternalEffects({
      store: effects,
      executor,
      authorize: (plan: never) => authorizeEffect(plan, {
        never, allowedCommands: repository.allow.commands,
      }),
      classify: createEvolveClassifier({
        transcript, metric: { name: manifest.policy.truth.metric },
      }) as never,
    });
    const driver = createEffectDriver({
      jobs: db.jobs as never, effects: effects as never, external: external as never, owner: 'evolve-instrument',
    });
    return { driver, transcript };
  };

  /** What every protected ref points at, as one comparable string. */
  const protectedRefs = async (): Promise<string> => {
    const seen: string[] = [];
    for (const ref of [...repository.protectedRefs].sort()) {
      const shown = await runner.run({
        name: 'git', args: ['show-ref', '--verify', 'refs/heads/' + ref], cwd: repositoryRoot,
      });
      seen.push(ref + '=' + (shown.ok && shown.value.exitCode === 0 ? shown.value.stdout.trim() : 'absent'));
    }
    return seen.join('\n');
  };

  try {
    return await body({
      repositoryRoot, worktreeRoot, baseRevision: materialized.baseRevision,
      runner, host, effects, evolveStore, outcomeStore, adapter, revision,
      budgets, gateArgs, instrumentArgs, registration, counters, fenceFor, protectedRefs,
    });
  }
  finally {
    await db.close().catch(() => undefined);
    await rm(base, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
}

export interface ExperimentRun {
  row: Row;
  decision: PlannedDecision;
}

/**
 * One registered proposal, all the way through. Sequential on purpose: two
 * experiments sharing one repository would race the base the measurement
 * depends on being still.
 */
export async function runExperiment(
  registration: LoadedEvolveFixture,
  entry: { document: { id: string, strategyId: string, rationale: string, evidence: string, patch: unknown[] }, index: number, budgets: Row['budgets'], expect: { decision: string, reason: string, code: string | null } },
  host: ExperimentHost,
  baseFiles: Record<string, string>,
): Promise<ExperimentRun> {
  const { document } = entry;
  const experimentId = document.id;
  const manifest = registration.manifest;
  const { driver, transcript } = host.fenceFor();

  const policy = compileSurfacePolicy({
    immutablePaths: [...manifest.policy.immutable.paths, ...manifest.policy.immutable.prefixes],
    generated: manifest.policy.immutable.generated.map(one => one.path),
    budgets: host.budgets,
  });
  const refiner = createPatchRefiner({ policy, budgets: host.budgets });

  let legs = 0;
  let unresolved = 0;
  const gateResultIds: string[] = [];
  const effectRecordIds: string[] = [];
  let measurement: EvolveMeasurement | null = null;

  /** The experiment record, advanced under its own compare-and-swap. */
  const seeded = await sealRecord<EvolveExperiment>({
    schemaVersion: 1,
    kind: 'experiment',
    experimentId,
    repositoryId: manifest.fixture.id,
    baseRevision: host.baseRevision,
    strategyId: document.strategyId,
    proposalId: document.id,
    status: 'proposed',
    runIdentityId: registration.manifestRevision,
    revision: 1,
    history: [],
  });
  if (!seeded.ok) throw new Error('the experiment record does not seal: ' + JSON.stringify(seeded.issues));
  let experiment = seeded.value;
  await host.evolveStore.putRecord(experiment);

  const advance = async (command: 'isolate' | 'apply' | 'gate' | 'measure' | 'decide'): Promise<void> => {
    const moved = await host.evolveStore.transitionExperiment(experimentId, command, experiment.revision);
    if (!moved.ok) throw new Error('the lifecycle refused ' + command + ': ' + JSON.stringify(moved.issues));
    experiment = moved.value;
  };

  const worktreePath = join(host.worktreeRoot, experimentId);

  /** Settle, record the outcome, and answer the row. */
  const finish = async (decision: PlannedDecision): Promise<ExperimentRun> => {
    const sealedDecision = await sealRecord<EvolveDecision>({
      schemaVersion: 1,
      kind: 'decision',
      experimentId,
      decision: decision.decision,
      reason: decision.reason,
      code: decision.code,
      evidenceIds: [...gateResultIds, ...(measurement === null ? [] : [measurement.id])],
      budgets: host.budgets,
    });
    if (!sealedDecision.ok) throw new Error('the decision does not seal: ' + JSON.stringify(sealedDecision.issues));
    await host.evolveStore.putRecord(sealedDecision.value);

    if (decision.decision === 'kept') {
      // A keep is the only path that has to reach `decided` first, because
      // `record` is the one transition the lifecycle grants from there.
      await advance('decide');
    }

    const had = existsSync(worktreePath);
    const settled = await settleExperiment({
      host: host.host,
      store: host.evolveStore,
      experiment,
      decision,
      worktreePath: had ? worktreePath : undefined,
      bundle: decision.decision !== 'kept' ? undefined : {
        gateResultIds,
        measurementId: measurement?.id ?? '',
        decisionId: sealedDecision.value.id,
        runIdentityId: registration.manifestRevision,
        effectRecordIds,
      },
    });
    if (!settled.ok) throw new Error('settling refused: ' + JSON.stringify(settled.issues));
    if (settled.value.worktreeRemoved) host.counters.worktreesRemoved += 1;
    if (had && !settled.value.branchDeleted) host.counters.branchesLeft += 1;

    // What the experiment MEANT, through the outcome lifecycle. The ids it
    // produces stay out of the row: they are evidence, not a measurement.
    const registry = createSourceRegistry();
    const service = await createOutcomeService({
      store: host.outcomeStore,
      scope: { namespace: 'evolve', domain: host.adapter.identity.id, subject: experimentId },
      adapters: [host.adapter],
      principal: {
        id: AUTOMATION_PRINCIPAL.id, authorityId: host.revision,
        approve: false, reconcile: false,
      },
      resolver: { revision: host.revision, resolve: resolveEvolveEvidence(host.evolveStore, registry) },
      authorizeMemoryIds: async () => ({ allowed: true, authorizationId: host.revision }),
      evaluationSlot: async () => undefined,
    });
    const recorded = await recordExperimentOutcome({
      service: service as never,
      registry,
      experiment: { experimentId, strategyId: document.strategyId, baseRevision: host.baseRevision },
      decision: sealedDecision.value,
      measurement,
      strategy: { memoryId: MEMORY_OF(document.strategyId) },
      configuration: { kind: 'scripted', revision: registration.manifestRevision },
      metric: { name: manifest.policy.truth.metric, direction: manifest.policy.thresholds.direction },
      adapter: host.adapter.identity as never,
      epoch: epochFor(entry.index),
    });
    if (!recorded.ok) throw new Error('recording the outcome refused: ' + JSON.stringify(recorded.issues));

    const actual = { decision: decision.decision, reason: decision.reason, code: decision.code } as Row['actual'];
    return {
      decision,
      row: {
        proposalId: document.id,
        strategyId: document.strategyId,
        state: 'run',
        actual,
        matches: decision.decision === entry.expect.decision
          && decision.reason === entry.expect.reason
          && decision.code === entry.expect.code,
        budgets: entry.budgets,
        effects: { legs, unresolved },
      },
    };
  };

  // ---- prepare -----------------------------------------------------------
  const prepared = refiner.prepare(baseFiles, {
    proposalId: document.id,
    strategyId: document.strategyId,
    rationale: document.rationale,
    evidence: [document.evidence],
    origin: 'hand-authored',
    patch: document.patch,
  });
  if (!prepared.ok) {
    // Refused before anything ran: no worktree, no spawn, no effect.
    return finish(refiner.decide(prepared.issues));
  }

  // ---- isolate and apply -------------------------------------------------
  const applied = await applyProposal({
    driver,
    host: host.host,
    experimentId,
    baseRevision: host.baseRevision,
    worktreePath,
    plan: prepared.value.plan,
    message: 'Apply ' + document.id,
    baseFiles,
    verify: (previous, next, status) => refiner.verifyStaged(previous, next, status),
  });
  legs += 3;
  if (existsSync(worktreePath)) host.counters.worktreesCreated += 1;
  if (!applied.ok) {
    if (applied.issues.some(issue => issue.code === 'TEVO1009')) unresolved += 1;
    return finish(refiner.decide(applied.issues));
  }
  await advance('isolate');
  await advance('apply');
  effectRecordIds.push(...applied.value.effectRecordIds);

  // ---- gate, and the single rerun red earns ------------------------------
  const gate = await runGate({
    driver, effects: host.effects, host: host.host, experimentId,
    worktreePath, args: host.gateArgs, budgets: host.budgets, leg: 'gate', transcript,
  });
  legs += 1;
  if (!gate.ok) {
    unresolved += 1;
    return finish({ decision: 'uncertain', reason: 'uncertain-effect', code: 'TEVO1009' });
  }
  gateResultIds.push(gate.value.record.id);
  effectRecordIds.push(experimentId + '/gate');
  await advance('gate');

  let rerun: typeof gate.value.verdict | null = null;
  if (earnsRerun(gate.value.verdict)) {
    const second = await runGate({
      driver, effects: host.effects, host: host.host, experimentId,
      worktreePath, args: host.gateArgs, budgets: host.budgets, leg: 'gate-rerun', transcript,
    });
    legs += 1;
    if (!second.ok) {
      unresolved += 1;
      return finish({ decision: 'uncertain', reason: 'uncertain-effect', code: 'TEVO1009' });
    }
    rerun = second.value.verdict;
    gateResultIds.push(second.value.record.id);
    effectRecordIds.push(experimentId + '/gate-rerun');
  }

  // ---- measure, only behind a green gate ---------------------------------
  let fitness: 'improved' | 'equal' | 'regression' | 'unverifiable' | null = null;
  if (gate.value.verdict === 'green') {
    const measured = await measureFitness({
      driver, effects: host.effects, host: host.host, experimentId,
      worktreePath, repositoryRoot: host.repositoryRoot,
      args: host.instrumentArgs,
      metric: { name: manifest.policy.truth.metric, direction: manifest.policy.thresholds.direction },
      samples: host.budgets.samples,
      baseRevision: host.baseRevision,
      truth: manifest.policy.truth.value,
      minDelta: manifest.policy.thresholds.minDelta,
      transcript,
    });
    legs += host.budgets.samples * 2;
    if (measured.ok) {
      measurement = measured.value.record;
      fitness = measured.value.comparison;
      await host.evolveStore.putRecord(measurement);
      effectRecordIds.push(experimentId + '/measure-base', experimentId + '/measure-candidate');
      await advance('measure');
    }
    else if (measured.issues.some(issue => issue.code === 'TEVO1003' || issue.code === 'TEVO1009')) {
      // The base moved, or a leg was lost. Either way nothing measured here
      // is worth anything, and a person looks rather than a retry running.
      unresolved += 1;
      return finish({ decision: 'uncertain', reason: 'uncertain-effect', code: 'TEVO1009' });
    }
    else {
      // Nothing readable. Not a regression — an absence of evidence.
      fitness = 'unverifiable';
      await advance('measure');
    }
  }

  // The campaign's one planner, over records. Everything above this line
  // gathered evidence; nothing above it decided what the evidence meant.
  return finish(planExperimentDecision({ gate: gate.value.verdict, rerun, fitness }));
}
