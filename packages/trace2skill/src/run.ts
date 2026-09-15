/**
 * The run: one fixed stage graph, driven once and resumable into itself.
 *
 * The coarse shape is a workflow of the suite's own IR — thirteen task nodes
 * in one chain, validated, planned and lowered by the suite rather than by a
 * scheduler written here. The ports between them carry ids and counts, never
 * a trajectory: the fan-out inside a stage is recorded as this package's own
 * rows, and the workflow records only that a stage ran and what it cost.
 *
 * Making a directory active is deliberately NOT one of the nodes. A run
 * produces a candidate and a held-out evaluation; whether the head moves is a
 * separate explicit call a host makes afterwards, so nothing a run does can
 * promote a directory by finishing.
 *
 * Every stage short-circuits on what the store already holds, so the same run
 * driven twice spends nothing and writes nothing — which is what makes an
 * interrupted run resumable: resuming is the same drive, not a second
 * algorithm.
 */
import {
  createMasConfigCatalog, createMasRegistrySnapshot, defineMasWorkflow, masMessage, planMasWorkflow,
  taskInvocation, validateMasWorkflow,
  type MasConfigCatalog, type MasRegistrySnapshot, type MasTaskHandlerBinding, type MasWorkflow,
  type MasWorkflowPlan, type ValidatedMasWorkflow,
} from '@tangleai/mas';
import { trace2SkillIssue, type Trace2SkillOutcome } from './errors.ts';
import { byPath } from './identity.ts';
import { splitIsDisjoint, type Trace2SkillTaskAdapter } from './adapter.ts';
import { EMPTY_SKILL_HEAD } from './transitions.ts';
import { isReplayOnly, runRollouts, ROLLOUT_STAGE, type RolloutFanOut } from './rollouts.ts';
import { analystInputsOf, dispatchAnalysts, type AnalystFanOut, type AnalystInput } from './analysts.ts';
import { consolidate, type Consolidation } from './commit.ts';
import {
  EVALUATION_STAGE, evaluateCandidate, runHeldOut, settleCandidateStatus,
  type EvaluationResult, type HeldOutPass,
} from './evaluation.ts';
import type { MergeDispatch } from './merge.ts';
import type { SkillSnapshot } from './bundle.ts';
import type { SkillFormatProfile } from './format.ts';
import type { SkillChatClient } from './executor.ts';
import type { Trace2SkillStore } from './store.ts';
import type {
  EvaluationPolicy, EvolutionRun, EvolutionTask, Trace2SkillIssue,
  Trace2SkillPromptArtifact, Trace2SkillPromptRole,
} from './contracts.gen.ts';

/**
 * The stage graph, in the one order a run performs it. Two pairs name the two
 * halves of one owner — a rollout is produced and labeled by the same fan-out,
 * and the merge levels and the single guarded application are the two halves
 * of consolidation — so each of those nodes publishes its own half of one
 * receipt rather than repeating the work.
 */
export const TRACE2SKILL_STAGES: readonly string[] = Object.freeze([
  'run-create',
  'skill-snapshot-or-draft',
  'split-validate',
  'baseline-no-skill',
  'baseline-s0',
  'rollouts-generate',
  'rollouts-evaluate-and-label',
  'analysts-dispatch',
  'patches-validate',
  'merges-levels',
  'candidate-compile-and-stage',
  'heldout-evaluate',
  'candidate-eligible-or-rejected',
]);

export const TRACE2SKILL_WORKFLOW_ID = 'trace2skill-evolve';
export const TRACE2SKILL_PROFILE = 'trace2skill';

/** Stages that read and write this package's rows; the split check reads nothing. */
const PURE_STAGES = new Set(['split-validate']);

const RECEIPT_SCHEMA = {
  type: 'object',
  required: ['stage', 'executed', 'reused', 'calls', 'written', 'refused'],
  additionalProperties: false,
  properties: {
    stage: { type: 'string' },
    executed: { type: 'boolean' },
    reused: { type: 'integer' },
    calls: { type: 'integer' },
    written: { type: 'integer' },
    refused: { type: 'integer' },
  },
} as const;

/** The capability document a host snapshots before it may bind a stage. */
export function trace2SkillRegistryDocument(): Record<string, unknown> {
  return {
    $masRegistry: '0.1',
    registryId: TRACE2SKILL_WORKFLOW_ID,
    roles: [],
    handlers: TRACE2SKILL_STAGES.map(stage => ({
      id: stage,
      title: stage,
      effect: PURE_STAGES.has(stage) ? 'pure' : 'effectful',
      idempotency: PURE_STAGES.has(stage) ? 'not-required' : 'honored',
    })),
    tools: [],
    messageAdapters: [{ id: 'json-schema', version: '0.1' }],
    contextAdapters: [],
    templates: [],
    subgraphs: [],
  };
}

/** The host allowlist a run resolves against: one profile, no tool and no context. */
export function trace2SkillConfigCatalogDocument(): Record<string, unknown> {
  return { $masConfigCatalog: '0.1', catalogId: TRACE2SKILL_WORKFLOW_ID, profiles: [TRACE2SKILL_PROFILE], tools: [], contexts: [] };
}

export interface Trace2SkillGraph {
  workflow: MasWorkflow;
  validated: ValidatedMasWorkflow;
  plan: MasWorkflowPlan;
  snapshot: MasRegistrySnapshot;
  catalog: MasConfigCatalog;
}

let cached: Promise<Trace2SkillGraph> | null = null;

/** Build, validate and lower the stage graph. The result is immutable and shared. */
export function trace2SkillGraph(): Promise<Trace2SkillGraph> {
  cached ??= build();
  return cached;
}

async function build(): Promise<Trace2SkillGraph> {
  const snapshot = await createMasRegistrySnapshot(trace2SkillRegistryDocument());
  if (!snapshot.valid) throw new Error(`the stage registry does not snapshot: ${JSON.stringify(snapshot.issues)}`);
  const catalog = await createMasConfigCatalog(trace2SkillConfigCatalogDocument());
  if (!catalog.valid) throw new Error(`the stage catalog does not resolve: ${JSON.stringify(catalog.issues)}`);
  const nodes = TRACE2SKILL_STAGES.map((stage, index) => taskInvocation({
    id: stage,
    handler: stage,
    effect: PURE_STAGES.has(stage) ? 'pure' : 'effectful',
    input: index === 0 ? { run: { type: 'string' } } : { upstream: RECEIPT_SCHEMA as unknown as Record<string, unknown> },
    output: { receipt: RECEIPT_SCHEMA as unknown as Record<string, unknown> },
  }));
  const messages = TRACE2SKILL_STAGES.slice(1).map((stage, index) =>
    masMessage([TRACE2SKILL_STAGES[index], 'receipt'], [stage, 'upstream']));
  const workflow = await defineMasWorkflow({
    workflowId: TRACE2SKILL_WORKFLOW_ID,
    title: 'Skill evolution',
    description: 'One frozen skill directory in, labeled rollouts, independent analysts, one merged patch applied once, one held-out comparison.',
    input: { type: 'object', required: ['run'], additionalProperties: false, properties: { run: { type: 'string' } } },
    output: { type: 'object', required: ['receipt'], additionalProperties: false, properties: { receipt: RECEIPT_SCHEMA as unknown as Record<string, unknown> } },
    entry: [{ port: 'run', to: { node: TRACE2SKILL_STAGES[0], port: 'run' } }],
    exit: [{ port: 'receipt', from: { node: TRACE2SKILL_STAGES[TRACE2SKILL_STAGES.length - 1], port: 'receipt' } }],
    nodes,
    messages,
    registryRevision: snapshot.value.revision,
    configRegistryRevision: catalog.value.revision,
    profile: TRACE2SKILL_PROFILE,
  });
  const validated = await validateMasWorkflow(workflow, snapshot.value, catalog.value);
  if (!validated.valid) throw new Error(`the stage graph does not validate: ${JSON.stringify(validated.issues)}`);
  const plan = await planMasWorkflow(validated.value);
  if (!plan.valid) throw new Error(`the stage graph does not lower: ${JSON.stringify(plan.issues)}`);
  return { workflow, validated: validated.value, plan: plan.value, snapshot: snapshot.value, catalog: catalog.value };
}

/** The stage order the suite's partitioner planned, flattened over its regions. */
export function plannedStageOrder(plan: MasWorkflowPlan): string[] {
  return plan.regions.flatMap(region => (region.kind === 'dag' ? [...region.invocations] : []));
}

export interface StageReceipt {
  stage: string;
  executed: boolean;
  reused: number;
  calls: number;
  written: number;
  refused: number;
  /** Why a stage this run does not perform did nothing; null where it ran. */
  reason: string | null;
  issues: Trace2SkillIssue[];
}

/** The coarse header a run writes to the host's run log: ids and counts, never a trace. */
export interface Trace2SkillRunLog {
  startRun(kind: string, options?: { identityId?: string }): Promise<{ id: string }>;
  finishRun(runId: string, status: 'ok' | 'error', summary?: unknown): Promise<unknown>;
}

export interface Trace2SkillRunDeps {
  store: Trace2SkillStore;
  adapter: Trace2SkillTaskAdapter;
  /** Every registered task of the scope; each stage reads only the split it may. */
  tasks: readonly EvolutionTask[];
  /** The directory this run freezes, already imported or drafted. */
  snapshot: SkillSnapshot;
  /** The row name the starting directory carries: the frozen import, or the blind draft. */
  baselineCondition: string;
  /** The wire for one executed unit, addressed by the task, the row it belongs to and the stage that asked. */
  executorClient: (task: EvolutionTask, condition: string, stage: string) => SkillChatClient;
  analystClient: (input: AnalystInput) => SkillChatClient;
  mergeClient: (group: MergeDispatch) => SkillChatClient;
  modelIdentity: string;
  forbidden?: readonly string[];
  profile?: SkillFormatProfile;
  policy?: EvaluationPolicy;
  /**
   * The compiled pack each role a run drives renders through. A pack is part
   * of a unit's identity, so a pack that moves moves every key that named it,
   * which is what makes a resumed run refuse to replay an answer to a
   * different question. The drafting role is absent because a run receives an
   * already-frozen directory: the draft's pack is `draftS0`'s own option.
   */
  prompts?: Partial<Record<Exclude<Trace2SkillPromptRole, 'draft'>, Trace2SkillPromptArtifact>>;
  maxToolRounds?: number;
  contextChars?: number;
  now?: () => number;
  trajectory?: { add(entry: unknown): unknown };
  runLog?: Trace2SkillRunLog;
}

export interface Trace2SkillRunResult {
  run: EvolutionRun;
  stages: StageReceipt[];
  baselines: HeldOutPass[];
  rollouts: RolloutFanOut | null;
  labels: { success: number, failure: number, unanswered: number };
  analysts: AnalystFanOut | null;
  consolidation: Consolidation | null;
  evaluation: EvaluationResult | null;
  counts: { calls: number, written: number, reused: number, refused: number };
  issues: Trace2SkillIssue[];
  /** The coarse run-log header, where a host injected one. */
  headerId: string | null;
}

interface Session {
  run: EvolutionRun;
  deps: Trace2SkillRunDeps;
  baselines: Map<string, HeldOutPass>;
  rollouts: RolloutFanOut | null;
  labels: { success: number, failure: number, unanswered: number };
  analysts: AnalystFanOut | null;
  consolidation: Consolidation | null;
  evaluation: EvaluationResult | null;
}

type StageOutcome = Omit<StageReceipt, 'stage' | 'executed'> & { executed?: boolean };

const idle = (reason: string): StageOutcome => ({ reused: 0, calls: 0, written: 0, refused: 0, reason, issues: [], executed: false });
const ran = (partial: Partial<StageOutcome> = {}): StageOutcome =>
  ({ reused: 0, calls: 0, written: 0, refused: 0, reason: null, issues: [], ...partial });

/** The two analyst packs, passed only where a host supplied one. */
function analystPrompts(deps: Trace2SkillRunDeps): { prompts?: { success?: Trace2SkillPromptArtifact, error?: Trace2SkillPromptArtifact } } {
  const chosen = {
    ...(deps.prompts?.['success-analyst'] === undefined ? {} : { success: deps.prompts['success-analyst'] }),
    ...(deps.prompts?.['error-analyst'] === undefined ? {} : { error: deps.prompts['error-analyst'] }),
  };
  return Object.keys(chosen).length === 0 ? {} : { prompts: chosen };
}

const heldOut = (tasks: readonly EvolutionTask[]): EvolutionTask[] =>
  tasks.filter(task => task.split === 'test').sort((left, right) => byPath(left.id, right.id));
const evolveTasks = (tasks: readonly EvolutionTask[]): EvolutionTask[] =>
  tasks.filter(task => task.split === 'evolve').sort((left, right) => byPath(left.id, right.id));

function heldOutDeps(session: Session, condition: string): Parameters<typeof runHeldOut>[4] {
  const { deps } = session;
  return {
    store: deps.store, adapter: deps.adapter, modelIdentity: deps.modelIdentity,
    client: (task: EvolutionTask) => deps.executorClient(task, condition, EVALUATION_STAGE),
    ...(deps.prompts?.executor === undefined ? {} : { prompt: deps.prompts.executor }),
    ...(deps.maxToolRounds === undefined ? {} : { maxToolRounds: deps.maxToolRounds }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
    ...(deps.trajectory === undefined ? {} : { trajectory: deps.trajectory }),
  };
}

async function baselinePass(session: Session, condition: string, snapshot: SkillSnapshot | null): Promise<StageOutcome> {
  const pass = await runHeldOut(session.run, condition, snapshot, heldOut(session.deps.tasks), heldOutDeps(session, condition));
  if (!pass.valid) return ran({ refused: 1, issues: pass.issues });
  session.baselines.set(condition, pass.value);
  const counts = pass.value.fanOut.counts;
  return ran({ reused: counts.reused, calls: counts.calls, written: counts.written, refused: counts.refused, issues: pass.value.fanOut.issues });
}

/**
 * The starting directory is seated as the active one before anything is
 * measured against it. A candidate replaces the directory it was derived
 * from, so without a seated head there is no parent for the fence to check.
 */
async function seatStartingHead(session: Session): Promise<{ issues: Trace2SkillIssue[] }> {
  const { store } = session.deps;
  const head = await store.head(session.deps.snapshot.bundle.scopeKey);
  if (head.versionId !== null) return { issues: [] };
  const bundleId = session.deps.snapshot.bundle.id;
  const eligible = await store.markBundle(bundleId, 'eligible');
  if (!eligible.valid) return { issues: eligible.issues };
  const seated = await store.activate(session.deps.snapshot.bundle.scopeKey, EMPTY_SKILL_HEAD, bundleId);
  return { issues: seated.valid ? [] : seated.issues };
}

const STAGES: Record<string, (session: Session) => Promise<StageOutcome>> = {
  async 'run-create'(session) {
    const before = session.deps.store.stats().writes;
    const written = await session.deps.store.putRun(session.run);
    if (!written.valid) return ran({ refused: 1, issues: written.issues });
    const wrote = session.deps.store.stats().writes - before;
    return ran({ written: wrote, reused: wrote === 0 ? 1 : 0 });
  },
  async 'skill-snapshot-or-draft'(session) {
    const before = session.deps.store.stats().writes;
    const stored = await session.deps.store.putSnapshot(session.deps.snapshot);
    if (!stored.valid) return ran({ refused: 1, issues: stored.issues });
    const seated = await seatStartingHead(session);
    const wrote = session.deps.store.stats().writes - before;
    return ran({ written: wrote, reused: wrote === 0 ? 1 : 0, refused: seated.issues.length, issues: seated.issues });
  },
  async 'split-validate'(session) {
    const { tasks } = session.deps;
    if (!splitIsDisjoint(tasks)) {
      return ran({ refused: 1, issues: [trace2SkillIssue('TT2S1006', '/splits', 'the evolve and held-out splits share a task id')] });
    }
    if (heldOut(tasks).length === 0) {
      return ran({ refused: 1, issues: [trace2SkillIssue('TT2S1006', '/splits', 'the run registers no held-out task to be judged on')] });
    }
    return ran();
  },
  'baseline-no-skill': session => baselinePass(session, 'no-skill', null),
  'baseline-s0': session => baselinePass(session, session.deps.baselineCondition, session.deps.snapshot),
  async 'rollouts-generate'(session) {
    const tasks = evolveTasks(session.deps.tasks);
    if (tasks.length === 0) return idle('the run registers no evolve task, so it learns from no trajectory');
    const { deps } = session;
    const fanOut = await runRollouts(session.run, tasks, {
      store: deps.store, adapter: deps.adapter, snapshot: deps.snapshot,
      condition: deps.baselineCondition, stage: ROLLOUT_STAGE, modelIdentity: deps.modelIdentity,
      client: (task: EvolutionTask) => deps.executorClient(task, deps.baselineCondition, ROLLOUT_STAGE),
      ...(deps.prompts?.executor === undefined ? {} : { prompt: deps.prompts.executor }),
      ...(deps.maxToolRounds === undefined ? {} : { maxToolRounds: deps.maxToolRounds }),
      ...(deps.now === undefined ? {} : { now: deps.now }),
      ...(deps.trajectory === undefined ? {} : { trajectory: deps.trajectory }),
    });
    session.rollouts = fanOut;
    return ran({ reused: fanOut.counts.reused, calls: fanOut.counts.calls, written: fanOut.counts.written, refused: fanOut.counts.refused, issues: fanOut.issues });
  },
  async 'rollouts-evaluate-and-label'(session) {
    if (session.rollouts === null) return idle('no trajectory was produced, so nothing was labeled');
    for (const rollout of session.rollouts.rollouts) session.labels[rollout.label]++;
    const strayed = session.rollouts.rollouts.filter(rollout => rollout.s0Hash !== session.run.s0Hash);
    return ran({
      refused: strayed.length,
      issues: strayed.map(rollout => trace2SkillIssue('TT2S1002', `/rollouts/${rollout.taskId}`, 'a stored trajectory names another frozen directory')),
    });
  },
  async 'analysts-dispatch'(session) {
    if (session.rollouts === null) return idle('no trajectory was produced, so no analyst was dispatched');
    const { deps } = session;
    const fanOut = await dispatchAnalysts(session.run, analystInputsOf(session.rollouts.rollouts, deps.snapshot.bundle, deps.adapter.id), {
      store: deps.store, adapter: deps.adapter, snapshot: deps.snapshot, modelIdentity: deps.modelIdentity,
      client: deps.analystClient,
      ...analystPrompts(deps),
      ...(deps.forbidden === undefined ? {} : { forbidden: deps.forbidden }),
      ...(deps.profile === undefined ? {} : { profile: deps.profile }),
      ...(deps.contextChars === undefined ? {} : { contextChars: deps.contextChars }),
      ...(deps.maxToolRounds === undefined ? {} : { maxToolRounds: deps.maxToolRounds }),
      ...(deps.now === undefined ? {} : { now: deps.now }),
      ...(deps.trajectory === undefined ? {} : { trajectory: deps.trajectory }),
    });
    session.analysts = fanOut;
    return ran({ reused: fanOut.counts.reused, calls: fanOut.counts.calls, written: fanOut.counts.written, refused: fanOut.counts.refused, issues: fanOut.issues });
  },
  async 'patches-validate'(session) {
    if (session.analysts === null) return idle('no analyst ran, so there is no patch population to check');
    const issues: Trace2SkillIssue[] = [];
    for (const patch of session.analysts.patches) {
      if (patch.baseHash !== session.run.s0Hash) {
        issues.push(trace2SkillIssue('TT2S1002', `/patches/${patch.id}`, 'a proposal was compiled against another frozen directory'));
      }
      if (patch.validation.state !== 'compiled') {
        issues.push(trace2SkillIssue('TT2S1004', `/patches/${patch.id}`, `a proposal reached the pool as ${patch.validation.state}`));
      }
      if (patch.sourcePatchIds.length > 0) {
        issues.push(trace2SkillIssue('TT2S1007', `/patches/${patch.id}`, 'a trajectory-local proposal names a peer patch'));
      }
    }
    return ran({ refused: issues.length, issues });
  },
  async 'merges-levels'(session) {
    if (session.analysts === null) return idle('no analyst ran, so there is no pool to consolidate');
    const { deps } = session;
    const result = await consolidate(session.run, session.analysts.patches, {
      store: deps.store, snapshot: deps.snapshot, modelIdentity: deps.modelIdentity,
      client: deps.mergeClient, leaves: session.analysts.patches,
      ...(deps.prompts?.merge === undefined ? {} : { prompt: deps.prompts.merge }),
      ...(deps.forbidden === undefined ? {} : { forbidden: deps.forbidden }),
      ...(deps.profile === undefined ? {} : { profile: deps.profile }),
      ...(deps.trajectory === undefined ? {} : { trajectory: deps.trajectory }),
    });
    session.consolidation = result;
    return ran({
      reused: result.counts.reused, calls: result.counts.calls,
      // The application is the next node's half of this receipt.
      written: Math.max(0, result.counts.written - result.counts.applications),
      refused: result.counts.refused, issues: result.issues,
    });
  },
  async 'candidate-compile-and-stage'(session) {
    const result = session.consolidation;
    if (result === null) return idle('no pool was consolidated, so no patch was applied');
    if (result.candidate === null) {
      return ran({ refused: 1, issues: [trace2SkillIssue('TT2S1008', '/candidate', 'the consolidation produced no candidate to stage')] });
    }
    return ran({ written: result.counts.applications, reused: result.counts.applications === 0 ? 1 : 0 });
  },
  async 'heldout-evaluate'(session) {
    const result = session.consolidation;
    if (result === null || result.candidate === null || result.snapshot === null) {
      return idle('no candidate was staged for this mode, so there is nothing to evaluate against the held-out split');
    }
    const { deps } = session;
    const head = await deps.store.head(session.run.scopeKey);
    const evaluation = await evaluateCandidate(session.run, {
      candidate: result.candidate, snapshot: result.snapshot, baseline: deps.snapshot,
      baselineCondition: deps.baselineCondition, tasks: heldOut(deps.tasks), expectedHead: head,
      ...(deps.policy === undefined ? {} : { policy: deps.policy }),
    }, heldOutDeps(session, 'evolved-s-star'));
    session.evaluation = evaluation;
    // The baseline stage already scored this condition; the evaluation replays
    // it, and a replay reports no calls. Keeping the first pass keeps the row
    // honest about what the baseline cost.
    if (evaluation.baseline !== null && !session.baselines.has(evaluation.baseline.condition)) {
      session.baselines.set(evaluation.baseline.condition, evaluation.baseline);
    }
    return ran({
      reused: evaluation.counts.reused, calls: evaluation.counts.calls,
      written: evaluation.counts.written, refused: evaluation.counts.refused, issues: evaluation.issues,
    });
  },
  async 'candidate-eligible-or-rejected'(session) {
    const evaluation = session.evaluation?.evaluation ?? null;
    if (evaluation === null) return idle('no held-out evaluation was recorded, so no verdict was written onto a directory');
    const before = session.deps.store.stats().writes;
    const settled = await settleCandidateStatus(session.deps.store, evaluation.candidateBundleId, evaluation);
    if (!settled.valid) return ran({ refused: 1, issues: settled.issues });
    const wrote = session.deps.store.stats().writes - before;
    return ran({ written: wrote, reused: wrote === 0 ? 1 : 0 });
  },
};

/**
 * The stage handlers a durable host binds. The same bindings the in-process
 * drive uses, so what a resumed segment executes is what a single-process run
 * executed — the ports carry a receipt, and the work stays in this package's
 * own rows.
 */
export function trace2SkillStageHandlers(run: EvolutionRun, deps: Trace2SkillRunDeps): Record<string, MasTaskHandlerBinding> {
  const session = newSession(run, deps);
  const bindings: Record<string, MasTaskHandlerBinding> = {};
  for (const stage of TRACE2SKILL_STAGES) {
    bindings[stage] = async () => {
      const outcome = await STAGES[stage](session);
      return { receipt: { stage, executed: outcome.executed ?? true, reused: outcome.reused, calls: outcome.calls, written: outcome.written, refused: outcome.refused } };
    };
  }
  return bindings;
}

function newSession(run: EvolutionRun, deps: Trace2SkillRunDeps): Session {
  return {
    run, deps, baselines: new Map(), rollouts: null,
    labels: { success: 0, failure: 0, unanswered: 0 },
    analysts: null, consolidation: null, evaluation: null,
  };
}

/**
 * Drive every stage once, in the order the suite's plan puts them. A stage
 * that finds its work already stored reports a replay; nothing is repeated
 * and nothing is skipped silently.
 */
export async function runTrace2Skill(run: EvolutionRun, deps: Trace2SkillRunDeps): Promise<Trace2SkillRunResult> {
  const graph = await trace2SkillGraph();
  const planned = plannedStageOrder(graph.plan);
  const stages: StageReceipt[] = [];
  const issues: Trace2SkillIssue[] = [];
  const session = newSession(run, deps);
  if (JSON.stringify(planned) !== JSON.stringify([...TRACE2SKILL_STAGES])) {
    issues.push(trace2SkillIssue('TT2S1013', '/stages', `the lowered plan orders the stages as ${planned.join(', ')}`));
  }
  const header = await deps.runLog?.startRun('trace2skill');
  const countsOf = (): { calls: number, written: number, reused: number, refused: number } => stages.reduce((total, receipt) => ({
    calls: total.calls + receipt.calls, written: total.written + receipt.written,
    reused: total.reused + receipt.reused, refused: total.refused + receipt.refused,
  }), { calls: 0, written: 0, reused: 0, refused: 0 });
  // Ids and counts only: the trajectories, analyses and patches of this run are
  // its own rows, and the run log never becomes a second copy of them. A drive
  // that fails part way settles its header too — a header left `running` is a
  // run nobody can tell from one still going.
  //
  // The stored run record settles with it. The header is the host's log and the
  // record is the run itself; a reader that finds only one of them settled is
  // reading two answers to when the drive stopped. A run the store never
  // accepted has nothing to settle, so a refusal here is carried, not thrown.
  const settle = async (status: 'ok' | 'error'): Promise<void> => {
    const stage = status === 'ok' ? 'completed' : 'refused';
    const marked = await deps.store.markRun(run.id, stage);
    if (!marked.valid) issues.push(...marked.issues);
    if (header === undefined) return;
    await deps.runLog?.finishRun(header.id, status, {
      runId: run.id, scopeKey: run.scopeKey, mode: run.mode, s0Id: run.s0Id,
      candidateId: session.consolidation?.candidate?.id ?? null,
      evaluationId: session.evaluation?.evaluation?.id ?? null,
      stages: stages.map(receipt => receipt.stage), ...countsOf(),
    });
  };

  try {
    for (const stage of planned) {
      const run2 = STAGES[stage];
      if (run2 === undefined) {
        issues.push(trace2SkillIssue('TT2S1013', `/stages/${stage}`, 'the lowered plan names a stage no handler covers'));
        continue;
      }
      const outcome = await run2(session);
      stages.push({ stage, executed: outcome.executed ?? true, reused: outcome.reused, calls: outcome.calls, written: outcome.written, refused: outcome.refused, reason: outcome.reason, issues: outcome.issues });
      issues.push(...outcome.issues);
    }
  }
  catch (cause) {
    await settle('error');
    throw cause;
  }

  const counts = countsOf();
  await settle(counts.refused === 0 ? 'ok' : 'error');

  return {
    run, stages,
    baselines: [...session.baselines.values()],
    rollouts: session.rollouts, labels: session.labels, analysts: session.analysts,
    consolidation: session.consolidation, evaluation: session.evaluation,
    counts, issues, headerId: header?.id ?? null,
  };
}

/** Whether a whole drive was a replay: the same two numbers every stage is judged by. */
export function runIsReplayOnly(result: Trace2SkillRunResult): Trace2SkillOutcome<null> {
  return isReplayOnly(result, '/run');
}
