/**
 * The skill-evolution report: what the instrument can say today, and
 * what it refuses to say.
 *
 * Four kinds of row live here. Two are analytic: the oracle answers every
 * held-out task with its registered answer and has to reach exactly 1.000,
 * and a seeded control answers uniformly from the pool of held-out answers
 * and has to land inside an analytic band. Together they prove the scorer
 * before any table is believed. Two are executed: the same bounded executor
 * runs the held-out split with no directory, with the frozen human directory,
 * with the trajectory-blind draft and with the directory the deepening run
 * evolved, over a scripted wire that reproduces the registered turn counts —
 * so the tables separate conditions, and say nothing about how a real model
 * would answer. The rest — the three named ablations, and a creation
 * candidate no rollout has produced — stay `implementation-missing`, with
 * empty task lists and null deltas, because the mechanism those rows measure
 * does not exist yet. A zero there would read as a measured failure; an
 * honest skip reads as what it is.
 *
 * Nothing here reads a clock, constructs a provider client, or reaches
 * a network: a counting trap is installed around the build and its zero
 * is published as a probe.
 */

import { join } from 'node:path';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createBudgetAccount, createTrajectory } from '@tangleai/agents';
import { createSharedBudgetClient } from '@tangleai/mas';
import {
  activateCandidate, ANALYST_EXCLUSIONS, analystRoleOf, applyCompiled, compilePatch,
  createMemoryTrace2SkillStore, DEFAULT_EVALUATION_POLICY, eligibilityIssuesOf, evaluationPolicyVersionOf,
  draftS0, draftsOf, DRAFT_PROMPT_VERSION, ERROR_ANALYST_PROMPT_VERSION,
  EXECUTOR_PROMPT_VERSION, importBundle, importS0, MERGE_CHANGELOG_ACTIONS, MERGE_PROMPT_VERSION,
  ROLLOUT_STAGE, runTrace2Skill, SUCCESS_ANALYST_PROMPT_VERSION, TRACE2SKILL_PROMPTS,
  trace2SkillPrompt, validateTrace2SkillPromptArtifact, validateTrace2SkillShape,
  type AnalystFanOut, type AnalystInput, type Consolidation, type EvaluationResult, type EvolutionRun,
  type EvolutionTask, type HeldOutPass, type MergeDispatch, type SkillBundle, type SkillFileDraft,
  type EvaluationPolicy, type HeldOutResult, type SkillEvaluation, type SkillPatch, type SkillSnapshot,
  type SkillPromotionRegistration, type TaskRollout, type Trace2SkillPromptRole,
  type Trace2SkillRunResult, type Trace2SkillTaskAdapter,
} from '@tangleai/trace2skill';
import { analyticEnvelope } from './report-envelope.ts';
import { describeErrors } from './validate.ts';
import { score as score3, table } from './table.ts';
import { createFixtureAdapter, toTaskAdapter, type FixtureAdapter } from './trace2skill-adapter.ts';
import {
  createTrace2SkillValidator, isRefusal, loadTrace2SkillFixture, operationsOf, patchFromDocument, ROOT,
  type LoadedFixture, type LoadOptions,
} from './trace2skill-fixture.ts';
import { answerPool, oracleCeiling, randomBand, randomDraw, type TruthEntry } from './trace2skill-oracle.ts';
import {
  analystUnit, createScriptedChatClient, createScriptedWire, draftUnit, executorUnit, mergeUnit,
  registeredUnits, type ScriptedWire,
} from './trace2skill-script.ts';
import { ABLATION_CONDITIONS, runTrace2SkillAblations, type AblationMethod } from './trace2skill-ablations.ts';
import type {
  AblationEntry, AblationsBlock, ActivationRefusal, AnalystsBlock, Capabilities, Condition, ConsolidationBlock,
  EvaluationBlock, FailureCount, FixtureIssue, IdentityPromptVersions, Probe, Row, RowStatus, ScriptUnit, SkillRef,
  SourceManifest, TaskResult, Trace2skillReport,
} from './trace2skill.types.ts';
import rootPackage from '../../package.json' with { type: 'json' };
import jarenPackage from '@jarenjs/json/package.json' with { type: 'json' };

export const REPORT_PATH = join(ROOT, 'benchmark/results/trace2skill.json');
export const DOCUMENT_PATH = join(ROOT, 'docs/TRACE2SKILL_BENCHMARK.md');

/** Why each unimplemented row is a skip rather than a zero. */
const MISSING_REASONS: Record<string, string> = {
  'evolved-s-star': 'no candidate was staged for this mode, so there is no evolved directory to evaluate',
  'retrieval-bank': 'the cluster-then-retrieve baseline is registered and unbuilt',
  'single-call-error': 'the single-call error-analysis ablation is registered and unbuilt',
  'sequential-merge': 'the sequential-merge ablation is registered and unbuilt',
};

/** Why each planned-and-unexecuted row is a `not-run` rather than a zero. */
const NOT_RUN_REASONS: Record<string, string> = {
  'cross-model': 'transfer to a second model needs a second executor identity, and this instrument builds no provider client',
  ood: 'transfer out of distribution needs a second domain adapter, and this corpus registers a single domain',
};

const LIMITATIONS = [
  'Scripted rows measure fixture sensitivity and instrument mechanics, not model quality; no provider request is possible here.',
  'The evolved row is scored over scripted answers, so no improvement is claimed or implied for any real model: it separates the conditions this corpus registers, and nothing more.',
  'The held-out denominator is eight tasks, so a difference smaller than 0.125 cannot be resolved by this corpus.',
  'The seeded control band is analytic over the registered answer pool, not an empirical distribution; with eight tasks it is wide.',
  'The held-out verdict and the five refused candidates are scripted: they establish that the gate names the clause that stopped each one and that a refusal moves nothing, not that a model would earn or fail the gate.',
  'The corpus is Tangle-authored and deliberately small; it qualifies the instrument and transfers nothing to another domain.',
  'The ablations swap out one part of the method each and keep everything else; their held-out verdicts are the corpus\'s registration for that condition, so what they establish is the mechanism difference and its cost, never a model\'s preference between them.',
  'The retrieval bank builds its records from the same patch pool without a model call, so its mechanism cost is not comparable with the analyst and merge calls the method spends; only the executor half of its cost is.',
  'Transfer is unmeasured: the cross-model row needs a second executor identity and the out-of-distribution row a second domain adapter, and this instrument builds neither. Both are published as not-run rather than assumed.',
];

/** One unit's contribution to a row. */
export interface UnitResult extends TaskResult { }

export interface RowInput {
  id: string;
  condition: Condition;
  status: RowStatus;
  reason: string | null;
  skill: SkillRef;
  tasks: UnitResult[];
  excluded?: number;
  leakage?: number;
  withheld?: number;
  scriptMissing?: number;
  calls?: number;
  cached?: number;
}

/** Every row is shaped here, so a count cannot disagree with its tasks. */
export function summarizeRow(input: RowInput): Row {
  const count = (label: TaskResult['label']): number => input.tasks.filter((task) => task.label === label).length;
  const correct = count('correct');
  const answered = correct + count('incorrect');
  return {
    id: input.id,
    condition: input.condition,
    status: input.status,
    reason: input.reason,
    skill: input.skill,
    tasks: input.tasks,
    metric: { answered, correct, score: input.tasks.length === 0 ? null : correct / input.tasks.length },
    counts: {
      unanswered: count('unanswered'),
      excluded: input.excluded ?? 0,
      failed: count('failed'),
      leakage: input.leakage ?? 0,
      withheld: input.withheld ?? 0,
      scriptMissing: input.scriptMissing ?? 0,
    },
    cost: {
      turns: input.tasks.reduce((total, task) => total + task.turns, 0),
      tokens: input.tasks.reduce((total, task) => total + task.tokens, 0),
      calls: input.calls ?? 0,
      cached: input.cached ?? 0,
      live: false,
    },
    deltas: { vsNoSkill: null, vsS0: null },
  };
}

/** Signed deltas against a table's own baselines; null while one is unrun. */
export function resolveDeltas(rows: readonly Row[], baseline: Condition): Row[] {
  const scoreOf = (condition: Condition): number | null => {
    const row = rows.find((entry) => entry.condition === condition);
    return row !== undefined && row.status === 'run' ? row.metric.score : null;
  };
  const noSkill = scoreOf('no-skill');
  const frozen = scoreOf(baseline);
  return rows.map((row) => ({
    ...row,
    deltas: row.status === 'run' && row.metric.score !== null
      ? {
        vsNoSkill: noSkill === null ? null : row.metric.score - noSkill,
        vsS0: frozen === null ? null : row.metric.score - frozen,
      }
      : { vsNoSkill: null, vsS0: null },
  }));
}

/** Capability gates, derived from rows and probes and never asserted. */
export function reportCapabilities(rows: readonly Row[], probes: readonly Probe[]): Capabilities {
  const passed = (capability: Probe['capability']): boolean => {
    const registered = probes.filter((probe) => probe.capability === capability);
    return registered.length > 0 && registered.every((probe) => probe.state === 'pass');
  };
  const ran = (...conditions: Condition[]): boolean =>
    conditions.every((condition) => rows.some((row) => row.condition === condition && row.status === 'run'));
  const instrument = passed('instrument');
  const contracts = instrument && passed('contracts');
  const rollouts = contracts && passed('rollouts') && ran('no-skill', 'frozen-s0');
  const analysts = rollouts && passed('analysts');
  const consolidation = analysts && passed('consolidation') && ran('evolved-s-star');
  const evaluation = consolidation && passed('evaluation');
  const packs = evaluation && passed('packs');
  const mechanisms = rows.filter((row) => row.condition !== 'oracle' && row.condition !== 'random');
  // Complete means nothing this corpus registers is unbuilt. A row the corpus
  // deliberately does not execute is a `not-run` with its reason beside it,
  // and reading that as a missing mechanism would make the gate unreachable
  // for a reason no implementation can fix.
  const complete = packs && mechanisms.every((row) => row.status !== 'implementation-missing');
  return { instrument, contracts, rollouts, analysts, consolidation, evaluation, packs, complete };
}

/** The six per-row counters plus the loader's refusals, always published. */
export function failureCounts(rows: readonly Row[], issues: readonly FixtureIssue[]): FailureCount[] {
  const total = (pick: (row: Row) => number): number => rows.reduce((sum, row) => sum + pick(row), 0);
  return [
    { reason: 'unanswered', count: total((row) => row.counts.unanswered) },
    { reason: 'excluded', count: total((row) => row.counts.excluded) },
    { reason: 'failed', count: total((row) => row.counts.failed) },
    { reason: 'leakage', count: total((row) => row.counts.leakage) },
    { reason: 'withheld', count: total((row) => row.counts.withheld) },
    { reason: 'script-missing', count: total((row) => row.counts.scriptMissing) },
    { reason: 'fixture-issue', count: issues.length },
  ];
}

/**
 * The analyst stage as the report publishes it: both roles, every exclusion
 * reason and the two isolation counters, whether or not any of them is
 * non-zero. A reason with no count would read as a reason nobody considered.
 */
function analystsBlock(mode: 'deepening' | 'creation', fan: AnalystFanOut | null): AnalystsBlock {
  const roles = (['success', 'error'] as const).map((role) => ({
    role,
    analyzed: fan?.counts[role].analyzed ?? 0,
    patches: fan?.counts[role].patches ?? 0,
    excluded: fan?.counts[role].excluded ?? 0,
    calls: fan?.counts[role].calls ?? 0,
    tokens: fan?.counts[role].tokens ?? 0,
  }));
  return {
    mode,
    roles,
    exclusions: ANALYST_EXCLUSIONS.map((reason) => ({ reason, count: fan?.counts.exclusions[reason] ?? 0 })),
    patches: roles.reduce((total, role) => total + role.patches, 0),
    refused: fan?.counts.refused ?? 0,
    peerPatchesSeen: fan?.counts.peerPatchesSeen ?? 0,
    baseHashMismatches: fan?.counts.baseHashMismatches ?? 0,
  };
}

/**
 * The consolidation stage as the report publishes it: the tree the pool was
 * cut into, what each group decided, and the one application. Every decision
 * name carries its count whether or not a group reached it, and a run that
 * consolidated nothing publishes the same shape with zeros rather than
 * leaving the block out.
 */
function consolidationBlock(
  mode: 'deepening' | 'creation',
  merge: { bMerge: number, lMax: number },
  supportThreshold: number,
  result: Consolidation | null,
): ConsolidationBlock {
  const counts = result?.counts;
  return {
    mode,
    terminal: result?.fanOut.terminal ?? 'empty',
    bMerge: merge.bMerge,
    lMax: merge.lMax,
    supportThreshold,
    levels: counts?.levels ?? 0,
    groups: counts?.groups ?? 0,
    nodes: (result?.fanOut.nodes ?? []).map((node) => ({
      id: node.id, level: node.level, groupIndex: node.groupIndex,
      inputs: node.inputPatchIds.length, unique: node.report.unique, duplicates: node.report.duplicates,
      withheld: node.report.withheld, supportCount: node.supportCount,
    })),
    changelog: MERGE_CHANGELOG_ACTIONS.map((action) => ({ action, count: counts?.changelog[action] ?? 0 })),
    discarded: counts?.discarded ?? 0,
    // The committer refuses a patch with any withheld hunk, so an applied
    // candidate carries none; the number is published rather than implied.
    withheldHunks: 0,
    unattributed: counts?.unattributed ?? 0,
    applications: counts?.applications ?? 0,
    refused: counts?.refused ?? 0,
    supportCount: result?.final?.supportCount ?? 0,
    finalPatchId: result?.final?.id ?? null,
    candidateId: result?.candidate?.id ?? null,
    bundleId: result?.candidate?.bundleId ?? null,
    diffSummary: result?.candidate?.diffSummary ?? null,
    calls: counts?.calls ?? 0,
    tokens: counts?.tokens ?? 0,
  };
}

/** The five ways a candidate must fail to reach the head, in the order the instrument tries them. */
const REFUSAL_SCENARIOS: ReadonlyArray<ActivationRefusal['scenario']> =
  ['regressing', 'under-covered', 'over-budget', 'evaluation-failed', 'stale-parent'];

/** An evaluation block for a mode that staged nothing: the same shape, honestly empty. */
function emptyEvaluationBlock(mode: 'deepening' | 'creation'): EvaluationBlock {
  return {
    mode, policyVersion: null, policy: { ...DEFAULT_EVALUATION_POLICY },
    evaluationId: null, baselineBundleId: null, candidateBundleId: null,
    tasks: 0, answered: 0, meanDelta: null, costDelta: null, failures: 0, skips: 0, leakage: 0,
    eligible: false, clauses: [], regressions: [],
    drives: 1, resumedCalls: 0, resumedWritten: 0, candidateStable: false,
    activations: { attempted: 0, activated: 0, refused: 0, previousRevision: 0, revision: 0, previousVersionId: null, versionId: null },
    refusals: [],
  };
}

/**
 * What a scripted candidate has to look like to fail one named clause. The
 * scores and counters are forged, the gate is not: each variant is judged by
 * the same `eligibilityIssuesOf` the real evaluation was.
 */
function forgedEvaluation(
  scenario: ActivationRefusal['scenario'],
  evaluation: SkillEvaluation,
  policy: EvaluationPolicy,
  tokens: number,
): { evaluation: Omit<SkillEvaluation, 'id'>, policy: EvaluationPolicy } {
  const swapped: HeldOutResult[] = evaluation.results.map((result) => ({
    ...result, baselineScore: result.candidateScore, candidateScore: result.baselineScore,
  }));
  // Silence a task the candidate did not change, so the mean still improves
  // and the only clause left to fail is the coverage floor.
  const silent = evaluation.results.find((result) => result.candidateScore === result.baselineScore)?.taskId ?? null;
  const silenced: HeldOutResult[] = evaluation.results.map((result) =>
    (result.taskId === silent ? { ...result, label: 'unanswered' as const } : { ...result }));
  const variants: Record<ActivationRefusal['scenario'], { results: HeldOutResult[], policy: EvaluationPolicy, leakage: number }> = {
    regressing: { results: swapped, policy, leakage: 0 },
    'under-covered': { results: silenced, policy: { ...policy, minAnsweredCoverage: 1 }, leakage: 0 },
    'over-budget': { results: evaluation.results as HeldOutResult[], policy: { ...policy, costCeiling: 0 }, leakage: 0 },
    'evaluation-failed': { results: evaluation.results as HeldOutResult[], policy, leakage: 1 },
    'stale-parent': { results: evaluation.results as HeldOutResult[], policy, leakage: 0 },
  };
  const variant = variants[scenario];
  const meanDelta = variant.results.reduce((total, result) => total + (result.candidateScore - result.baselineScore), 0) / (variant.results.length || 1);
  const clauses = eligibilityIssuesOf(variant.policy, {
    results: variant.results, meanDelta,
    answered: variant.results.filter((result) => result.label !== 'unanswered').length,
    failures: 0, leakage: variant.leakage,
    tokens: scenario === 'over-budget' ? tokens : 0,
  });
  return {
    policy: variant.policy,
    evaluation: {
      ...evaluation, results: variant.results, meanDelta, leakage: variant.leakage,
      eligible: clauses.length === 0, issues: clauses,
    },
  };
}

interface ActivationObservation { block: EvaluationBlock, issues: FixtureIssue[] }

/**
 * The held-out verdict and everything that must not follow from it. One
 * eligible candidate is activated exactly once through the fence; four forged
 * verdicts and one stale parent are each refused and must leave the head and
 * the previously active directory exactly as they were.
 */
async function observeActivation(
  execution: ModeExecution,
  mode: 'deepening' | 'creation',
  resumed: { calls: number, written: number, candidateId: string | null } | null,
): Promise<ActivationObservation> {
  const issues: FixtureIssue[] = [];
  const evaluation = execution.evaluation?.evaluation ?? null;
  const candidate = execution.consolidation?.candidate ?? null;
  if (evaluation === null || candidate === null) return { block: emptyEvaluationBlock(mode), issues };
  const store = execution.store;
  const scopeKey = evaluation.scopeKey;
  const policy = execution.evaluation?.policy ?? DEFAULT_EVALUATION_POLICY;
  const registrationOf = (gate: string, head = evaluation.expectedHead): SkillPromotionRegistration => ({
    scopeKey, executorIdentityId: evaluation.executorIdentityId, policyVersion: gate,
    testHash: evaluation.testHash, expectedHead: head,
  });
  const priorId = evaluation.expectedHead.versionId;
  const priorBefore = priorId === null ? null : await store.getSnapshot(priorId);
  const readable = async (): Promise<boolean> => {
    if (priorId === null || priorBefore === null || !priorBefore.valid) return false;
    const now = await store.getSnapshot(priorId);
    return now.valid && JSON.stringify(now.value.files) === JSON.stringify(priorBefore.value.files);
  };

  const candidateTokens = (execution.evaluation?.candidate?.fanOut.rollouts ?? [])
    .reduce((total, rollout) => total + rollout.spend.tokens, 0);
  const refusals: ActivationRefusal[] = [];
  const record = async (scenario: ActivationRefusal['scenario'], evaluationId: string, registration: SkillPromotionRegistration, named?: { path: string, detail: string }): Promise<void> => {
    const before = await store.head(scopeKey);
    const result = await activateCandidate(store, { scopeKey, candidateId: candidate.id, evaluationId, registration, actor: 'instrument' });
    const after = await store.head(scopeKey);
    const first = result.issues[0];
    refusals.push({
      scenario,
      code: first?.code ?? 'none',
      // The promotion refuses an ineligible verdict as a whole; the clause the
      // verdict itself named is what says which promise broke.
      clause: named?.path ?? first?.path ?? 'none',
      detail: named?.detail ?? first?.detail ?? 'the gate refused without naming a clause',
      refused: result.outcome === 'refused',
      headUnchanged: JSON.stringify(before) === JSON.stringify(after),
      priorReadable: await readable(),
    });
    if (result.outcome !== 'refused') {
      issues.push({ code: 'TT2S1010', path: `${mode}/activations/${scenario}`, detail: 'a candidate that must not activate did' });
    }
  };

  // Four forged verdicts, before the head has moved anywhere.
  for (const scenario of REFUSAL_SCENARIOS.filter((name) => name !== 'stale-parent')) {
    const forged = forgedEvaluation(scenario, evaluation, policy, candidateTokens);
    const gate = await evaluationPolicyVersionOf(forged.policy);
    const payload = { ...forged.evaluation, policyVersion: gate, runId: await canonicalSha256({ run: evaluation.runId, scenario }) };
    const row: SkillEvaluation = { ...payload, id: await canonicalSha256(payload as unknown as Record<string, unknown>) };
    const written = await store.putEvaluation(row);
    if (!written.valid) {
      issues.push({ code: written.issues[0].code, path: `${mode}/activations/${scenario}`, detail: written.issues[0].detail });
      continue;
    }
    const named = row.issues[0];
    await record(scenario, row.id, registrationOf(gate), named === undefined ? undefined : { path: named.path, detail: named.detail });
  }

  // The one activation the fence allows.
  const previous = await store.head(scopeKey);
  const activated = await activateCandidate(store, {
    scopeKey, candidateId: candidate.id, evaluationId: evaluation.id,
    registration: registrationOf(evaluation.policyVersion), actor: 'instrument',
  });
  if (activated.outcome !== 'activated') {
    issues.push({ code: activated.issues[0]?.code ?? 'TT2S1010', path: `${mode}/activations/eligible`, detail: activated.issues[0]?.detail ?? 'the eligible candidate did not activate' });
  }
  const head = await store.head(scopeKey);

  // The same request again: the candidate's parent is no longer the head.
  await record('stale-parent', evaluation.id, registrationOf(evaluation.policyVersion));

  if (!(await readable())) {
    issues.push({ code: 'TT2S1002', path: `${mode}/activations/superseded`, detail: 'the superseded directory is no longer readable byte for byte' });
  }
  const regressions = evaluation.results
    .filter((result) => result.baselineScore > result.candidateScore)
    .map((result) => ({ taskId: result.taskId, baseline: result.baselineScore, candidate: result.candidateScore }));

  return {
    issues,
    block: {
      mode, policyVersion: evaluation.policyVersion, policy: { ...policy },
      evaluationId: evaluation.id, baselineBundleId: evaluation.baselineBundleId, candidateBundleId: evaluation.candidateBundleId,
      tasks: evaluation.results.length,
      answered: evaluation.results.filter((result) => result.label !== 'unanswered').length,
      meanDelta: evaluation.meanDelta, costDelta: evaluation.costDelta,
      failures: evaluation.failures, skips: evaluation.skips, leakage: evaluation.leakage,
      eligible: evaluation.eligible,
      clauses: evaluation.issues.map((issue) => ({ code: issue.code, clause: issue.path, detail: issue.detail })),
      regressions,
      drives: resumed === null ? 1 : 2,
      resumedCalls: resumed?.calls ?? 0,
      resumedWritten: resumed?.written ?? 0,
      candidateStable: resumed !== null && resumed.candidateId === candidate.id,
      activations: {
        attempted: refusals.length + 1,
        activated: activated.outcome === 'activated' ? 1 : 0,
        refused: refusals.length,
        previousRevision: previous.revision, revision: head.revision,
        previousVersionId: previous.versionId, versionId: head.versionId,
      },
      refusals,
    },
  };
}

/** How much of a complete run the committed script actually covers. */
export async function scriptCoverage(loaded: LoadedFixture): Promise<{ registered: number, resolved: number, missing: number }> {
  const wire = await createScriptedWire(loaded.script);
  const units = registeredUnits(loaded.tasks, loaded.labels, loaded.tree);
  let resolved = 0;
  for (const unit of units) if ((await wire.lookup(unit)).found) resolved++;
  return { registered: units.length, resolved, missing: units.length - resolved };
}

const SCRIPTED_MODEL = 'scripted-v1';
/** Injected everywhere a clock could be read, so no duration enters the document. */
const FIXED_CLOCK = (): number => 0;
const OVERLAPPING = ['overlap-a', 'overlap-b'];

/** The frozen directory's bytes, in the order the manifest registers them. */
function frozenFilesOf(loaded: LoadedFixture): Array<{ path: string, bytes: Uint8Array }> {
  const encoder = new TextEncoder();
  return loaded.fixture.s0.files.map((entry) => ({ path: entry.path, bytes: encoder.encode(loaded.skillFiles.get(entry.path) ?? '') }));
}

/**
 * The task-instance facts reusable guidance may never carry: every task id and
 * both spellings of every registered answer. One list, so the compiler probe
 * and the analysts are held to the same boundary.
 */
function forbiddenTermsOf(loaded: LoadedFixture): string[] {
  const terms: string[] = [];
  for (const task of loaded.tasks) {
    terms.push(task.id);
    const truth = loaded.readTruth('evaluate', task.id);
    if (!isRefusal(truth)) terms.push(truth.answer, truth.normalized);
  }
  return terms;
}

/** Every registered task as a run record, with the digests the corpus already pins. */
function taskRecordsOf(loaded: LoadedFixture, adapter: FixtureAdapter): EvolutionTask[] {
  const digests = new Map(loaded.source.files.map((file) => [file.path, file.sha256]));
  const encoder = new TextEncoder();
  const held = new Set(loaded.splits.test);
  return loaded.tasks.map((task) => ({
    id: task.id,
    scopeKey: loaded.scope.scopeKey,
    split: held.has(task.id) ? 'test' as const : 'evolve' as const,
    prompt: task.prompt,
    inputs: task.inputs.map((path) => {
      const content = loaded.readInput(path);
      return { path, sha256: digests.get(path) ?? '0'.repeat(64), size: isRefusal(content) ? 0 : encoder.encode(content).length };
    }),
    adapterId: adapter.id,
    adapterRevision: adapter.revision,
  }));
}

/** One stored execution as the row vocabulary sees it. A stop is never read as an answer. */
function resultOf(taskId: string, rollout: TaskRollout | null): UnitResult {
  if (rollout === null) return { taskId, label: 'failed', score: 0, stopReason: 'refused', turns: 0, tokens: 0 };
  const stopped = rollout.stopReason.startsWith('budget-') || rollout.stopReason === 'tool-limit';
  const stopReason: UnitResult['stopReason'] = rollout.stopReason === 'script-missing' ? 'script-missing'
    : stopped ? 'budget' : rollout.label === 'unanswered' ? 'refused' : 'complete';
  const label: UnitResult['label'] = rollout.stopReason === 'script-missing' ? 'failed'
    : rollout.label === 'success' ? 'correct' : rollout.label === 'failure' ? 'incorrect' : 'unanswered';
  return { taskId, label, score: rollout.evaluation.score, stopReason, turns: rollout.spend.calls, tokens: rollout.spend.tokens };
}

export interface ExecutedRow { tasks: UnitResult[], calls: number, skill: SkillRef }

/** The run record one mode drives under; every stage keys its units against it. */
async function runRecordOf(loaded: LoadedFixture, adapter: FixtureAdapter, mode: 'deepening' | 'creation', condition: Condition, s0: SkillBundle, modelIdentity: string): Promise<EvolutionRun> {
  const fixture = loaded.fixture;
  return {
    // The run a mode drives under is the one its trajectories were written to,
    // so the patch pool a later pass consolidates is addressed exactly as the
    // pass that produced it addressed it.
    id: await canonicalSha256({ fixture: loaded.fixtureId, mode, condition, stage: 'rollout', identity: modelIdentity }),
    scopeKey: loaded.scope.scopeKey, mode, s0Id: s0.id, s0Hash: s0.id,
    evolveHash: loaded.splits.evolveHash, testHash: loaded.splits.testHash,
    roles: [{ role: 'executor', identityId: modelIdentity, promptVersion: EXECUTOR_PROMPT_VERSION }],
    toolManifestHash: adapter.toolManifestHash,
    budgets: { turns: fixture.budgets.turns, tokens: fixture.budgets.tokens, ms: fixture.budgets.ms },
    concurrency: fixture.budgets.concurrency, bMerge: fixture.merge.bMerge, lMax: fixture.merge.lMax,
    seed: fixture.seed, supportThreshold: 1, status: 'running', spend: { calls: 0, tokens: 0, cost: null },
  };
}

/** One stored execution as the row vocabulary sees it, over one held-out pass. */
function rowOf(pass: HeldOutPass, skill: SkillRef): ExecutedRow {
  return {
    tasks: pass.fanOut.units.map((unit) => resultOf(unit.taskId, unit.rollout)),
    calls: pass.fanOut.counts.calls,
    skill,
  };
}

/**
 * What the corpus registered about this analyst stage, against what the run
 * observed. A disagreement is a counted refusal rather than a quietly updated
 * number: the repairable tasks each owe exactly one evaluator-proven patch
 * carrying the edits their registered document names, and the unrepairable
 * one owes none.
 */
function crossCheckAnalyses(loaded: LoadedFixture, mode: 'deepening' | 'creation', fan: AnalystFanOut): FixtureIssue[] {
  const issues: FixtureIssue[] = [];
  const registered = new Map<string, { outcome?: string, patchId?: string | null, exclusion?: string | null }>();
  for (const entry of loaded.script.entries) {
    // The method's own units only: an ablation registers the same role under
    // its own condition, and reading one as the other would compare a run
    // against a decision nobody asked it to make.
    if (entry.unit.stage !== 'analysis' || entry.unit.mode !== mode || entry.unit.taskId === null) continue;
    if (entry.unit.condition !== loaded.labels.modes[mode].rolloutCondition) continue;
    registered.set(`${entry.unit.role}/${entry.unit.taskId}`, entry.response as { outcome?: string });
  }
  const documents = new Map(loaded.patches.map((document) => [document.id, document]));
  const patches = new Map(fan.patches.map((patch) => [patch.id, patch]));
  const proven = new Set<string>();

  for (const unit of fan.units) {
    const result = unit.result;
    if (result === null) continue;
    const script = registered.get(`${unit.role === 'success' ? 'success-analyst' : 'error-analyst'}/${unit.taskId}`);
    if (script === undefined) {
      issues.push({ code: 'TT2S1001', path: `analyses/${unit.taskId}`, detail: `no scripted analyst entry describes ${unit.role}/${unit.taskId}` });
      continue;
    }
    const wanted = script.outcome === 'patch' ? 'patch' : 'excluded';
    if (result.status !== wanted || (wanted === 'excluded' && result.exclusion !== (script.exclusion ?? null))) {
      issues.push({
        code: 'TT2S1002', path: `analyses/${unit.taskId}`,
        detail: `the script registers ${String(script.outcome)}/${String(script.exclusion)} and the run answered ${result.status}/${String(result.exclusion)}`,
      });
      continue;
    }
    if (result.status !== 'patch' || unit.role !== 'error') continue;
    proven.add(unit.taskId);
    const document = documents.get(loaded.labels.analystPatches[unit.taskId as keyof typeof loaded.labels.analystPatches] ?? '');
    const patch = result.patchId === null ? undefined : patches.get(result.patchId);
    if (document === undefined || patch === undefined) continue;
    if (JSON.stringify(patch.operations) !== JSON.stringify(operationsOf(document))) {
      issues.push({ code: 'TT2S1002', path: `patches/${document.id}.json`, detail: `the patch proven for ${unit.taskId} is not the edits its registered document names` });
    }
  }
  const repairable = [...loaded.fixture.rollouts.repairable].sort();
  if (JSON.stringify([...proven].sort()) !== JSON.stringify(repairable)) {
    issues.push({
      code: 'TT2S1002', path: 'manifest.json',
      detail: `the corpus registers ${repairable.join(', ')} as repairable and the run proved ${[...proven].sort().join(', ') || 'none'}`,
    });
  }
  for (const taskId of loaded.fixture.rollouts.unrepairable) {
    const unit = fan.units.find((entry) => entry.taskId === taskId);
    if (unit?.result?.status === 'patch') {
      issues.push({ code: 'TT2S1002', path: 'manifest.json', detail: `${taskId} is registered unrepairable and the run stored a patch for it` });
    }
  }
  return issues;
}

/**
 * What the corpus registered about the merge tree, against what the run
 * built. The registered tree names documents and a run names content-addressed
 * patches, so the binding is the shape — how many levels, how many groups of
 * what size — together with the trajectories the final patch must stand on.
 */
function crossCheckMerges(loaded: LoadedFixture, result: Consolidation | null): FixtureIssue[] {
  const issues: FixtureIssue[] = [];
  const at = 'patches/expected-merge-tree.json';
  if (result === null) return issues;
  const plan = result.fanOut.plan;
  const registeredShape = loaded.tree.levels.map((level) => level.groups.map((group) => group.members.length));
  const observedShape = plan.levels.map((level) => level.groups.map((group) => group.members.length));
  if (JSON.stringify(observedShape) !== JSON.stringify(registeredShape)) {
    issues.push({ code: 'TT2S1008', path: at, detail: `the corpus registers groups of ${JSON.stringify(registeredShape)} and the run planned ${JSON.stringify(observedShape)}` });
  }
  const registeredIds = loaded.tree.levels.flatMap((level) => level.groups.map((group) => group.id));
  const observedIds = plan.levels.flatMap((level) => level.groups.map((group) => group.id));
  if (JSON.stringify(observedIds) !== JSON.stringify(registeredIds)) {
    issues.push({ code: 'TT2S1008', path: at, detail: `the corpus registers ${registeredIds.join(', ')} and the run planned ${observedIds.join(', ')}` });
  }
  if (plan.finalGroupId !== loaded.tree.final) {
    issues.push({ code: 'TT2S1008', path: at, detail: `the corpus registers ${loaded.tree.final} as the final group and the run planned ${String(plan.finalGroupId)}` });
  }
  if (plan.pool.length !== loaded.tree.pool.length) {
    issues.push({ code: 'TT2S1008', path: at, detail: `the corpus registers a pool of ${loaded.tree.pool.length} and the run merged ${plan.pool.length}` });
  }
  const support = result.final?.supportCount ?? 0;
  if (support !== loaded.tree.uniqueRolloutSupport) {
    issues.push({ code: 'TT2S1002', path: at, detail: `the corpus registers ${loaded.tree.uniqueRolloutSupport} supporting trajectories and the final patch names ${support}` });
  }
  if (result.candidate !== null && result.counts.applications !== 1) {
    issues.push({ code: 'TT2S1008', path: at, detail: `a staged candidate was written by ${result.counts.applications} application(s)` });
  }
  return issues;
}

const skillRefOf = (snapshot: SkillSnapshot, mode: 'deepening' | 'creation'): SkillRef => ({
  bundleId: snapshot.bundle.id,
  hash: snapshot.bundle.files.find((file) => file.path === 'SKILL.md')?.sha256 ?? snapshot.bundle.id,
  mode,
});

export interface ModeOptions {
  /** A store to drive into, so a second drive can resume the first one's rows. */
  store?: ReturnType<typeof createMemoryTrace2SkillStore>;
  /** The gate the candidate is judged against; the package's default when absent. */
  policy?: EvaluationPolicy;
  /** Counts what the drive asked the wire for, so an interrupted drive can be measured. */
  meter?: { calls: number };
  /** Stop the drive by refusing the call after this many, standing in for a lost process. */
  callLimit?: number;
  /** A host run log, so a test can read the coarse header a drive writes. */
  runLog?: Parameters<typeof runTrace2Skill>[1]['runLog'];
}

/** A wire that stops answering after a bounded number of calls: an interrupted run. */
class DriveInterrupted extends Error {}

function metered<T extends { complete(request: unknown): Promise<unknown> }>(client: T, options: ModeOptions): T {
  const meter = options.meter;
  if (meter === undefined) return client;
  const limit = options.callLimit ?? Number.POSITIVE_INFINITY;
  return {
    ...client,
    complete: (request: unknown) => {
      if (meter.calls >= limit) throw new DriveInterrupted(`the drive was interrupted after ${limit} call(s)`);
      meter.calls++;
      return client.complete(request);
    },
  };
}

export interface ModeExecution {
  rows: Map<Condition, ExecutedRow>;
  rollouts: TaskRollout[];
  issues: FixtureIssue[];
  labels: { success: number, failure: number, unanswered: number };
  reasoningCaptured: boolean;
  draftPromptVersion: string | null;
  /** The analyst stage over this mode's rollouts, or null where a mode produces none. */
  analysts: AnalystFanOut | null;
  /** The consolidation of this mode's patch pool, or null where a mode produces none. */
  consolidation: Consolidation | null;
  /** The held-out evaluation of this mode's candidate, or null where none was staged. */
  evaluation: EvaluationResult | null;
  /** The whole drive, so a caller can resume it or read its stage receipts. */
  run: Trace2SkillRunResult;
  store: ReturnType<typeof createMemoryTrace2SkillStore>;
  snapshot: SkillSnapshot;
}

/** Deepening executes the frozen directory; creation drafts one first and measures it. */
async function executeMode(
  loaded: LoadedFixture,
  fixtureAdapter: FixtureAdapter,
  adapter: Trace2SkillTaskAdapter,
  wire: ScriptedWire,
  tasks: readonly EvolutionTask[],
  mode: 'deepening' | 'creation',
  modelIdentity: string,
  options: ModeOptions = {},
): Promise<ModeExecution> {
  const store = options.store ?? createMemoryTrace2SkillStore();
  const account = createBudgetAccount({}, FIXED_CLOCK);
  const trajectory = createTrajectory();
  const issues: FixtureIssue[] = [];
  const rows = new Map<Condition, ExecutedRow>();
  let draftPromptVersion: string | null = null;

  let snapshot: SkillSnapshot;
  if (mode === 'deepening') {
    const imported = await importS0(store, frozenFilesOf(loaded), { scopeKey: loaded.scope.scopeKey, mode, origin: 'human-import' });
    if (!imported.valid) throw new Error(`the frozen directory does not import: ${JSON.stringify(imported.issues)}`);
    snapshot = imported.value;
    if (snapshot.bundle.id !== loaded.fixture.s0.bundleId) {
      issues.push({ code: 'TT2S1002', path: 'manifest.json', detail: `the frozen directory hashes to ${snapshot.bundle.id.slice(0, 12)}…, registered ${loaded.fixture.s0.bundleId.slice(0, 12)}…` });
    }
  }
  else {
    const client = createSharedBudgetClient(
      createScriptedChatClient(wire, draftUnit(), { tokensPerTurn: loaded.labels.tokensPerTurn, draftTitle: loaded.scope.scopeKey }),
      account) as Parameters<typeof draftS0>[0];
    const drafted = await draftS0(client, {
      scopeKey: loaded.scope.scopeKey, description: loaded.scope.description,
      tools: loaded.scope.tools.map((tool) => ({ name: tool.name, description: tool.description })),
      answerShape: loaded.scope.answerShape,
    });
    if (!drafted.valid) throw new Error(`the trajectory-blind draft does not seal: ${JSON.stringify(drafted.issues)}`);
    const stored = await store.putSnapshot(drafted.value.snapshot);
    if (!stored.valid) throw new Error(`the drafted directory does not store: ${JSON.stringify(stored.issues)}`);
    snapshot = drafted.value.snapshot;
    draftPromptVersion = DRAFT_PROMPT_VERSION;
  }

  const baselineCondition = mode === 'deepening' ? 'frozen-s0' as const : 'draft-s0' as const;
  // The corpus registers evolve trajectories for the deepening mode only, so
  // creation is measured as a starting directory and learns from nothing: a
  // creation rollout would have no scripted unit to answer it.
  const visible = mode === 'deepening' ? tasks : tasks.filter((task) => task.split === 'test');
  const documents = new Map(loaded.patches.map((document) => [document.id, document]));
  const run = await runRecordOf(loaded, fixtureAdapter, mode, baselineCondition, snapshot.bundle, modelIdentity);
  // Every stage's wire is addressed by unit, so each unit gets its own client —
  // all of them over the one account, which is what keeps the ceiling run-wide.
  const bound = (unit: ScriptUnit, extra: Parameters<typeof createScriptedChatClient>[2] = { tokensPerTurn: loaded.labels.tokensPerTurn }) =>
    metered(createSharedBudgetClient(createScriptedChatClient(wire, unit, extra), account), options);
  const firstInput = new Map(tasks.map((task) => [task.id, task.inputs[0]?.path ?? '']));
  const result = await runTrace2Skill(run, {
    store, adapter, tasks: visible, snapshot, baselineCondition, modelIdentity,
    forbidden: forbiddenTermsOf(loaded), now: FIXED_CLOCK, trajectory,
    ...(options.policy === undefined ? {} : { policy: options.policy }),
    ...(options.runLog === undefined ? {} : { runLog: options.runLog }),
    executorClient: (task: EvolutionTask, condition: string, stage: string) => bound(
      executorUnit(stage === ROLLOUT_STAGE ? 'rollout' : 'evaluation', mode, condition as Condition, task.id),
      {
        tokensPerTurn: loaded.labels.tokensPerTurn,
        toolCall: { name: 'read_file', arguments: JSON.stringify({ path: firstInput.get(task.id) ?? '' }) },
      }),
    analystClient: (input: AnalystInput) => bound(
      analystUnit(analystRoleOf(input.rollout) === 'success' ? 'success-analyst' : 'error-analyst', mode, baselineCondition, input.rollout.taskId),
      {
        tokensPerTurn: loaded.labels.tokensPerTurn,
        // The registered document is what a role would have authored; the
        // run seals its identity, so nothing here writes a patch record.
        patches: (patchId: string) => {
          const document = documents.get(patchId);
          return document === undefined ? null : { reasoning: document.rationale, operations: operationsOf(document) };
        },
      }),
    mergeClient: (group: MergeDispatch) => bound(mergeUnit(mode, group.id)),
  });

  issues.push(...result.issues.map((issue) => ({ code: issue.code, path: `${mode}${issue.path}`, detail: issue.detail })));
  for (const pass of result.baselines) {
    const condition = pass.condition as Condition;
    rows.set(condition, rowOf(pass, condition === 'no-skill' ? null : skillRefOf(snapshot, mode)));
  }
  if (result.analysts !== null) issues.push(...crossCheckAnalyses(loaded, mode, result.analysts));
  issues.push(...crossCheckMerges(loaded, result.consolidation));
  const evolved = result.evaluation?.candidate ?? null;
  if (evolved !== null && result.consolidation?.snapshot != null) {
    rows.set('evolved-s-star', rowOf(evolved, skillRefOf(result.consolidation.snapshot, mode)));
  }

  return {
    rows, rollouts: result.rollouts?.rollouts ?? [], issues, labels: result.labels,
    reasoningCaptured: (result.rollouts?.rollouts.length ?? 0) > 0
      && (result.rollouts?.rollouts ?? []).every((rollout) => rollout.reasoning.length > 0),
    draftPromptVersion, analysts: result.analysts, consolidation: result.consolidation,
    evaluation: result.evaluation, run: result, store, snapshot,
  };
}

/**
 * One mode over the committed corpus, assembled the way the report assembles
 * it. Exposed so a test can pin the stored labels against `expected/labels.json`
 * task by task rather than against the counts the report publishes.
 */
export async function executeSkillMode(loaded: LoadedFixture, mode: 'deepening' | 'creation', options: ModeOptions = {}): Promise<ModeExecution> {
  const fixtureAdapter = await createFixtureAdapter(loaded);
  const wire = await createScriptedWire(loaded.script);
  const modelIdentity = await canonicalSha256({
    model: SCRIPTED_MODEL, budgets: loaded.fixture.budgets, evaluator: loaded.fixture.evaluator,
    toolManifestHash: fixtureAdapter.toolManifestHash,
  });
  return executeMode(loaded, fixtureAdapter, toTaskAdapter(fixtureAdapter), wire, taskRecordsOf(loaded, fixtureAdapter), mode, modelIdentity, options);
}

/**
 * The five role packs as the run actually renders them: each compiled
 * artifact revalidates against its own source pack, and its revision is the
 * prompt version this report publishes for that role. A pack that compiled
 * once and then drifted from the version a run keys against would make every
 * stored unit name a question nobody can reproduce, so the probe counts the
 * artifacts that still agree rather than the files on disk.
 */
const PACK_ROLES: ReadonlyArray<[Trace2SkillPromptRole, keyof IdentityPromptVersions]> = [
  ['draft', 'draft'], ['executor', 'executor'], ['success-analyst', 'successAnalyst'],
  ['error-analyst', 'errorAnalyst'], ['merge', 'merge'],
];

export async function observePacks(published: IdentityPromptVersions): Promise<{ packs: number, issues: FixtureIssue[] }> {
  const issues: FixtureIssue[] = [];
  let packs = 0;
  for (const [role, key] of PACK_ROLES) {
    const artifact = trace2SkillPrompt(role);
    const checked = await validateTrace2SkillPromptArtifact(artifact);
    if (!checked.valid) {
      issues.push({ code: checked.issues[0].code, path: `prompts/${role}`, detail: checked.issues[0].detail });
      continue;
    }
    if (artifact.policyVersion !== TRACE2SKILL_PROMPTS.policyVersion) {
      issues.push({ code: 'TT2S1001', path: `prompts/${role}`, detail: `the pack compiled under ${artifact.policyVersion}` });
      continue;
    }
    if (published[key] !== artifact.revision) {
      issues.push({ code: 'TT2S1002', path: `prompts/${role}`, detail: `the report publishes ${published[key]} where the compiled pack is ${artifact.revision}` });
      continue;
    }
    packs++;
  }
  return { packs, issues };
}

/** What the compiler does to the committed pool, counted rather than asserted. */
async function observeContracts(loaded: LoadedFixture): Promise<{
  bundle: { bundles: number, closed: boolean },
  compiler: { refused: number, withheld: number },
  issues: FixtureIssue[],
}> {
  const issues: FixtureIssue[] = [];
  const imported = await importBundle(frozenFilesOf(loaded), { scopeKey: loaded.scope.scopeKey, mode: 'deepening', origin: 'human-import' });
  if (!imported.valid) {
    issues.push({ code: 'TT2S1005', path: loaded.fixture.s0.path, detail: 'the frozen directory does not import' });
    return { bundle: { bundles: 0, closed: false }, compiler: { refused: 0, withheld: 0 }, issues };
  }
  const bundles = imported.value.bundle.id === loaded.fixture.s0.bundleId ? 1 : 0;
  if (bundles === 0) {
    issues.push({ code: 'TT2S1002', path: loaded.fixture.s0.path, detail: 'the computed directory identity is not the registered one' });
  }
  // A directory record that accepted an undeclared member would carry
  // anything a caller invented; the contract is closed exactly when it does not.
  const closed = !validateTrace2SkillShape('skillBundle', { ...imported.value.bundle, files: [...imported.value.bundle.files], extra: 1 }).valid;

  const runId = await canonicalSha256({ fixture: loaded.fixtureId, stage: 'contract-probe' });
  const frozen = { bundle: imported.value.bundle, files: draftsOf(imported.value.files) };
  const bytesOf = (files: readonly SkillFileDraft[]): string => files.map((file) => `${file.path} ${file.content}`).join('');
  const before = bytesOf(frozen.files);
  const forbidden = forbiddenTermsOf(loaded);
  const documents = new Map(loaded.patches.map((document) => [document.id, document]));

  const drive = (patch: SkillPatch): string | null => {
    const compiled = compilePatch(frozen, patch, { forbidden });
    if (!compiled.valid) return compiled.issues[0].code;
    const applied = applyCompiled(frozen.files, compiled.value);
    if (!applied.valid) return applied.issues[0].code;
    return compiled.value.withheld.length ? compiled.value.issues[0].code : null;
  };

  let refused = 0;
  let withheld = 0;
  for (const [id, document] of documents) {
    // The overlapping pair is one conflict and is compiled as one patch; on
    // its own each half is a clean edit and would report nothing.
    if (OVERLAPPING.includes(id)) { refused++; withheld++; continue; }
    const code = drive(await patchFromDocument(document, { runId, baseHash: frozen.bundle.id }));
    if (code !== (document.expectedCode ?? null)) {
      issues.push({ code: 'TT2S1002', path: `patches/${id}.json`, detail: `the document expects ${String(document.expectedCode)} and the compiler answered ${String(code)}` });
    }
    if (code !== null) refused++;
  }
  const pair = compilePatch(frozen, await patchFromDocument(documents.get('overlap-a')!, {
    runId, baseHash: frozen.bundle.id, sourcePatchIds: OVERLAPPING, supportCount: 2,
    operations: OVERLAPPING.flatMap((id) => operationsOf(documents.get(id)!)),
  }), { forbidden });
  if (!pair.valid || pair.value.withheld.length !== 1) {
    issues.push({ code: 'TT2S1004', path: 'patches/overlap-a.json', detail: 'the overlapping pair did not withhold exactly one hunk' });
  }
  if (bytesOf(frozen.files) !== before) {
    issues.push({ code: 'TT2S1002', path: loaded.fixture.s0.path, detail: 'compiling the pool moved the frozen directory' });
  }
  return { bundle: { bundles, closed }, compiler: { refused, withheld }, issues };
}

export interface ReportOptions extends LoadOptions {
  /** Frozen source manifest, so a test can pin determinism. */
  source?: SourceManifest;
}

interface Analytic { oracleRow: Row, randomRow: Row, ceiling: number, draw: ReturnType<typeof randomDraw>, poolSize: number }

/** The two analytic rows, and the scorer proof they carry. */
function analyticRows(loaded: LoadedFixture, adapter: FixtureAdapter, prefix: string, truths: readonly TruthEntry[]): Analytic {
  const ceiling = oracleCeiling(truths);
  const draw = randomDraw(truths, loaded.fixture.seed);
  const verdicts = (answers: readonly string[]): TaskResult[] => truths.map((truth, index) => {
    const verdict = adapter.evaluate(truth.id, answers[index]);
    if (isRefusal(verdict)) return { taskId: truth.id, label: 'failed', score: 0, stopReason: 'refused', turns: 0, tokens: 0 };
    return { taskId: truth.id, label: verdict.label, score: verdict.score, stopReason: 'complete', turns: 0, tokens: 0 };
  });
  return {
    ceiling, draw, poolSize: answerPool(truths).length,
    oracleRow: summarizeRow({
      id: `${prefix}:oracle`, condition: 'oracle', status: 'run', reason: null, skill: null,
      tasks: verdicts(truths.map((truth) => truth.answer)),
    }),
    randomRow: summarizeRow({
      id: `${prefix}:random`, condition: 'random', status: 'run', reason: null, skill: null,
      tasks: verdicts(draw.picks),
    }),
  };
}

/** The canonical identity of everything the corpus registers. */
export function registrationIdOf(loaded: LoadedFixture): Promise<string> {
  return canonicalSha256({
    tasks: loaded.tasks, patches: loaded.patches, tree: loaded.tree, labels: loaded.labels, oracle: loaded.oracle,
  });
}

function missingRow(prefix: string, condition: Condition): Row {
  return summarizeRow({
    id: `${prefix}:${condition}`, condition, status: 'implementation-missing',
    reason: MISSING_REASONS[condition] ?? 'the mechanism this row measures is unbuilt', skill: null, tasks: [],
  });
}

export function buildTrace2SkillReport(options: ReportOptions = {}): Promise<Trace2skillReport> { // writes benchmark/results/trace2skill.json
  return assemble(options);
}

async function assemble(options: ReportOptions): Promise<Trace2skillReport> {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error('the skill-evolution instrument must not make a network call'); }) as typeof fetch;
  try {
    const loaded = await loadTrace2SkillFixture(options);
    const adapter = await createFixtureAdapter(loaded);
    const taskAdapter = toTaskAdapter(adapter);
    const issues = [...loaded.issues];

    const truths: TruthEntry[] = [];
    for (const id of loaded.splits.test) {
      const truth = loaded.readTruth('evaluate', id);
      if (isRefusal(truth)) issues.push({ code: truth.code, path: `truth/${id}.json`, detail: truth.error });
      else truths.push(truth);
    }

    const deepening = analyticRows(loaded, adapter, 'deepening', truths);
    const creation = analyticRows(loaded, adapter, 'creation', truths);
    const band = randomBand(truths);
    const inBand = deepening.randomRow.metric.score !== null
      && deepening.randomRow.metric.score >= band.low && deepening.randomRow.metric.score <= band.high;

    // The registered expectations are the fixture's, not the run's: a
    // disagreement is a counted refusal, never a quietly updated number.
    const expected = loaded.oracle;
    if (expected.ceiling !== deepening.ceiling || expected.randomDraw.score !== deepening.draw.score) {
      issues.push({ code: 'TT2S1002', path: 'expected/oracle.json', detail: 'the registered oracle expectations disagree with the scorer' });
    }

    // The executed half. Every condition runs the shipped executor over the
    // scripted wire; the frozen directory is imported from the corpus bytes
    // and the creation draft is authored before either row is scored.
    const wire = await createScriptedWire(loaded.script);
    const tasks = taskRecordsOf(loaded, adapter);
    const modelIdentity = await canonicalSha256({
      model: SCRIPTED_MODEL, budgets: loaded.fixture.budgets, evaluator: loaded.fixture.evaluator,
      toolManifestHash: adapter.toolManifestHash,
    });
    const executed = {
      deepening: await executeMode(loaded, adapter, taskAdapter, wire, tasks, 'deepening', modelIdentity),
      creation: await executeMode(loaded, adapter, taskAdapter, wire, tasks, 'creation', modelIdentity),
    };
    const contracts = await observeContracts(loaded);
    issues.push(...contracts.issues, ...executed.deepening.issues, ...executed.creation.issues);

    // The same run, driven again over the rows it already wrote: a resume is
    // the same drive, so the second one must spend nothing and stage the same
    // candidate. It runs before the head moves and is reported beside the
    // activation matrix that follows.
    const resumedDrive = await executeMode(loaded, adapter, taskAdapter, wire, tasks, 'deepening', modelIdentity, { store: executed.deepening.store });
    const resumed = {
      calls: resumedDrive.run.counts.calls,
      written: resumedDrive.run.counts.written,
      candidateId: resumedDrive.consolidation?.candidate?.id ?? null,
    };
    issues.push(...resumedDrive.run.issues.map((issue) => ({ code: issue.code, path: `resume${issue.path}`, detail: issue.detail })));
    const activation = await observeActivation(executed.deepening, 'deepening', resumed);
    issues.push(...activation.issues);

    // The diagnostic half: the method with one part swapped out, each over the
    // same corpus, the same frozen directory and the same held-out split.
    const methodRun: AblationMethod = {
      run: executed.deepening.run.run,
      snapshot: executed.deepening.snapshot,
      rollouts: executed.deepening.rollouts,
      analyses: executed.deepening.analysts?.results ?? [],
      leaves: executed.deepening.analysts?.patches ?? [],
      candidate: executed.deepening.consolidation?.candidate ?? null,
      levels: executed.deepening.consolidation?.counts.levels ?? 0,
      groups: executed.deepening.consolidation?.counts.groups ?? 0,
      discarded: executed.deepening.consolidation?.counts.discarded ?? 0,
      errorAnalystCalls: executed.deepening.analysts?.counts.error.calls ?? 0,
      mergeCalls: executed.deepening.consolidation?.counts.calls ?? 0,
    };
    const ablated = await runTrace2SkillAblations({
      loaded, fixtureAdapter: adapter, adapter: taskAdapter, wire, tasks, modelIdentity,
      forbidden: forbiddenTermsOf(loaded), method: methodRun, now: FIXED_CLOCK,
      toResult: resultOf,
    });
    issues.push(...ablated.issues);

    const rowsOf = (prefix: 'deepening' | 'creation', analytic: Analytic): Row[] =>
      loaded.fixture.tables[prefix].map((condition) => {
        if (condition === 'oracle') return analytic.oracleRow;
        if (condition === 'random') return analytic.randomRow;
        const notRun = NOT_RUN_REASONS[condition];
        if (notRun !== undefined) {
          return summarizeRow({ id: `${prefix}:${condition}`, condition, status: 'not-run', reason: notRun, skill: null, tasks: [] });
        }
        const run = executed[prefix].rows.get(condition) ?? ablated.rows.get(condition);
        if (run === undefined) {
          // A mode the corpus registers no evolve trajectory for learns from
          // nothing and stages no candidate. That is the corpus's decision,
          // not a mechanism this repository has failed to build.
          if (executed[prefix].rollouts.length === 0) {
            return summarizeRow({
              id: `${prefix}:${condition}`, condition, status: 'not-run', skill: null, tasks: [],
              reason: `the corpus registers no ${prefix} evolve trajectory, so this mode stages no candidate to evaluate`,
            });
          }
          return missingRow(prefix, condition);
        }
        return summarizeRow({
          id: `${prefix}:${condition}`, condition, status: 'run', reason: null, skill: run.skill,
          tasks: run.tasks, calls: run.calls, leakage: 0,
        });
      });
    const tables = {
      deepening: resolveDeltas(rowsOf('deepening', deepening), 'frozen-s0'),
      creation: resolveDeltas(rowsOf('creation', creation), 'draft-s0'),
    };
    // The held-out expectations are the corpus's, not the run's: a row that
    // scores something else is a counted disagreement, never a quiet update.
    for (const prefix of ['deepening', 'creation'] as const) {
      const registered = loaded.oracle.heldOut[prefix] as unknown as Record<string, number>;
      for (const row of tables[prefix]) {
        const expectedScore = registered[row.condition];
        if (row.status !== 'run' || expectedScore === undefined || row.metric.score === expectedScore) continue;
        issues.push({
          code: 'TT2S1002', path: 'expected/oracle.json',
          detail: `${prefix}:${row.condition} scored ${String(row.metric.score)} against the registered ${expectedScore}`,
        });
      }
    }

    const evolvedScore = tables.deepening.find((row) => row.condition === 'evolved-s-star');
    const methodScore = evolvedScore?.status === 'run' ? evolvedScore.metric.score : null;
    const ablations: AblationsBlock = {
      mode: 'deepening',
      method: {
        condition: 'evolved-s-star',
        candidateId: methodRun.candidate?.id ?? null,
        candidateBundleId: methodRun.candidate?.bundleId ?? null,
        levels: methodRun.levels, groups: methodRun.groups, withheld: methodRun.discarded,
      },
      entries: ABLATION_CONDITIONS.map((condition): AblationEntry => {
        const entry = ablated.entries.find((candidate) => candidate.condition === condition);
        const row = tables.deepening.find((table) => table.condition === condition);
        const score = row?.status === 'run' ? row.metric.score : null;
        const base = entry ?? {
          condition, replaces: 'nothing: this ablation produced no entry', status: 'implementation-missing' as const,
          candidateId: null, candidateBundleId: null, sameDirectoryAsMethod: false,
          cost: { calls: 0, tokens: 0 }, counters: [{ name: 'built', value: 0 }],
        };
        return {
          ...base, score,
          vsEvolved: score === null || methodScore === null ? null : score - methodScore,
        };
      }),
    };

    const analysts = analystsBlock('deepening', executed.deepening.analysts);
    const consolidation = consolidationBlock('deepening', loaded.fixture.merge, 1, executed.deepening.consolidation);
    const evaluation = activation.block;
    const coverage = await scriptCoverage(loaded);
    const unregistered = executorUnit('rollout', 'deepening', 'frozen-s0', loaded.splits.test[0]);
    const absent = await wire.lookup(unregistered);
    const leakBefore = adapter.counts.leakage;
    const leaked = adapter.executorTools(loaded.splits.evolve[0]).read_file(`truth/${loaded.splits.evolve[0]}.json`);

    const promptVersions: IdentityPromptVersions = {
      draft: executed.creation.draftPromptVersion ?? 'implementation-missing',
      executor: EXECUTOR_PROMPT_VERSION,
      successAnalyst: SUCCESS_ANALYST_PROMPT_VERSION,
      errorAnalyst: ERROR_ANALYST_PROMPT_VERSION,
      merge: MERGE_PROMPT_VERSION,
    };
    const packs = await observePacks(promptVersions);
    issues.push(...packs.issues);

    const observed: Record<string, Record<string, unknown> | null> = {
      'fixture-hashes-verified': { drift: issues.filter((issue) => issue.code === 'TT2S1002').length },
      'splits-disjoint': { disjoint: loaded.splits.disjoint, overlapRefused: loaded.splits.overlapRefused },
      'oracle-reaches-ceiling': { score: deepening.ceiling, tasks: truths.length },
      'seeded-random-in-band': { inBand },
      'truth-read-refused-outside-evaluation': isRefusal(leaked)
        ? { code: leaked.code, refused: true, leakage: adapter.counts.leakage - leakBefore }
        : { code: 'none', refused: false, leakage: 0 },
      'missing-script-entry-counted': { counted: !absent.found, scriptMissing: absent.found ? 0 : 1 },
      'no-provider-request-possible': { calls },
      'immutable-skill-bundle-contract': contracts.bundle,
      'directory-patch-compiler-refusals': contracts.compiler,
      'labeled-rollout-envelope': {
        rollouts: executed.deepening.rollouts.length,
        reasoningCaptured: executed.deepening.reasoningCaptured,
      },
      'evolve-label-distribution': executed.deepening.labels,
      'analyst-isolation': {
        peerPatchesSeen: analysts.peerPatchesSeen,
        baseHashMismatches: analysts.baseHashMismatches,
      },
      'evaluator-proven-repair': {
        proven: analysts.roles.find((role) => role.role === 'error')?.patches ?? 0,
        excluded: analysts.roles.find((role) => role.role === 'error')?.excluded ?? 0,
      },
      'hierarchical-merge-plan': { levels: consolidation.levels, groups: consolidation.groups },
      'guarded-single-application': { applications: consolidation.applications },
      'held-out-activation': {
        candidates: evaluation.candidateBundleId === null ? 0 : 1,
        activations: evaluation.activations.activated,
      },
      'versioned-prompt-packs': { packs: packs.packs },
    };
    const probes: Probe[] = loaded.fixture.probes.map((registered) => {
      const value = observed[registered.id] ?? null;
      const matches = value !== null && JSON.stringify(value) === JSON.stringify(registered.expected);
      return {
        id: registered.id,
        capability: registered.capability,
        expected: registered.expected,
        observed: value,
        state: value === null ? 'implementation-missing' : matches ? 'pass' : 'fail',
        reason: value === null ? 'the mechanism this probe observes is unbuilt' : matches ? null : 'the observation differs from the registration',
      };
    });
    if (coverage.missing > 0) {
      issues.push({ code: 'TT2S1001', path: loaded.fixture.script, detail: `${coverage.missing} registered units have no scripted entry` });
    }

    const allRows = [...tables.deepening, ...tables.creation];
    const payload: Omit<Trace2skillReport, 'reportId'> = {
      instrument: 'trace2skill',
      version: 1,
      source: options.source ?? loaded.source,
      suite: { tangle: rootPackage.version, jaren: jarenPackage.version },
      fixtureId: loaded.fixtureId,
      registrationId: await registrationIdOf(loaded),
      splits: {
        evolve: loaded.splits.evolve.length,
        test: loaded.splits.test.length,
        evolveHash: loaded.splits.evolveHash,
        testHash: loaded.splits.testHash,
        disjoint: loaded.splits.disjoint,
        overlapRefused: loaded.splits.overlapRefused,
      },
      identity: {
        model: SCRIPTED_MODEL,
        promptVersions,
        toolManifestHash: adapter.toolManifestHash,
        budgets: {
          turns: loaded.fixture.budgets.turns, tokens: loaded.fixture.budgets.tokens, ms: loaded.fixture.budgets.ms,
        },
        concurrency: loaded.fixture.budgets.concurrency,
        seed: loaded.fixture.seed,
        evaluatorId: adapter.evaluatorId,
        merge: loaded.fixture.merge,
      },
      tables,
      analysts,
      consolidation,
      evaluation,
      ablations,
      oracle: {
        evaluatorId: adapter.evaluatorId,
        tasks: truths.length,
        ceiling: deepening.ceiling,
        randomPoolSize: deepening.poolSize,
        randomScore: deepening.draw.score,
        band,
        inBand,
      },
      probes,
      issues,
      failures: failureCounts(allRows, issues),
      limitations: LIMITATIONS,
      capabilities: reportCapabilities(allRows, probes),
      envelope: analyticEnvelope(allRows.map((row) => row.id)),
    };
    const report: Trace2skillReport = { ...payload, reportId: await canonicalSha256(payload as unknown as Record<string, unknown>) };
    const outcome = await validateTrace2SkillReport(report, loaded);
    if (!outcome.valid) throw new Error(`the skill-evolution report does not validate: ${outcome.errors.join('; ')}`);
    return report;
  } finally {
    globalThis.fetch = previous;
  }
}

/**
 * Schema, identity and recomputed-total validation of a report.
 *
 * The corpus binding is checked against `corpus` — the fixture the
 * report claims to be about, which defaults to the committed one. A
 * builder passes the fixture it actually used, so a deliberately
 * mutated registration is judged against itself rather than against
 * whatever happens to be on disk.
 */
export async function validateTrace2SkillReport(value: unknown, corpus?: LoadedFixture): Promise<{ valid: boolean, errors: string[] }> {
  const outcome = createTrace2SkillValidator()(value);
  if (!outcome.valid) return { valid: false, errors: describeErrors(outcome, 6) };
  const report = value as Trace2skillReport;
  const errors: string[] = [];
  const { reportId, ...payload } = report;
  if (reportId !== await canonicalSha256(payload as unknown as Record<string, unknown>)) errors.push('report identity');
  if (report.source.sha256 !== await canonicalSha256({ files: report.source.files })) errors.push('source identity');
  const loaded = corpus ?? await loadTrace2SkillFixture();
  if (report.fixtureId !== loaded.fixtureId) errors.push('fixture identity');
  if (report.registrationId !== await registrationIdOf(loaded)) errors.push('registration identity');
  if (report.identity.evaluatorId !== loaded.fixture.evaluator) errors.push('registered evaluator');
  if (report.identity.seed !== loaded.fixture.seed) errors.push('registered seed');
  if (JSON.stringify(report.identity.merge) !== JSON.stringify(loaded.fixture.merge)) errors.push('registered merge plan');
  if (JSON.stringify(report.probes.map((probe) => ({ id: probe.id, capability: probe.capability, expected: probe.expected })))
    !== JSON.stringify(loaded.fixture.probes)) errors.push('probe registration');
  const allRows = [...report.tables.deepening, ...report.tables.creation];
  for (const [prefix, rows] of [['deepening', report.tables.deepening], ['creation', report.tables.creation]] as const) {
    for (const row of rows) {
      if (!row.id.startsWith(`${prefix}:`)) errors.push(`row ${row.id} is in the wrong table`);
      const rebuilt = summarizeRow({
        id: row.id, condition: row.condition, status: row.status, reason: row.reason, skill: row.skill, tasks: row.tasks,
        excluded: row.counts.excluded, leakage: row.counts.leakage, withheld: row.counts.withheld,
        scriptMissing: row.counts.scriptMissing, calls: row.cost.calls, cached: row.cost.cached,
      });
      if (JSON.stringify({ ...rebuilt, deltas: row.deltas }) !== JSON.stringify(row)) errors.push(`row totals: ${row.id}`);
      if (row.status !== 'run' && row.reason === null) errors.push(`unrun row without a reason: ${row.id}`);
      if (row.status === 'run' && row.reason !== null) errors.push(`run row carrying a skip reason: ${row.id}`);
    }
    const baseline: Condition = prefix === 'deepening' ? 'frozen-s0' : 'draft-s0';
    if (JSON.stringify(resolveDeltas(rows, baseline)) !== JSON.stringify(rows)) errors.push(`${prefix} deltas`);
    // A table signs its deltas against its own starting directory, so that row
    // has to be there — and a candidate that never met the directory it claims
    // to improve on is a number without a comparison.
    const start = rows.find((row) => row.condition === baseline);
    if (start === undefined) errors.push(`${prefix} has no ${baseline} row`);
    else if (rows.some((row) => row.condition === 'evolved-s-star' && row.status === 'run') && start.status !== 'run') {
      errors.push(`${prefix} claims a candidate without running ${baseline}`);
    }
  }
  const errorRole = report.analysts.roles.find((role) => role.role === 'error');
  const isolation = report.probes.find((probe) => probe.id === 'analyst-isolation');
  const repair = report.probes.find((probe) => probe.id === 'evaluator-proven-repair');
  if (isolation?.observed !== undefined && isolation.observed !== null
    && JSON.stringify(isolation.observed) !== JSON.stringify({ peerPatchesSeen: report.analysts.peerPatchesSeen, baseHashMismatches: report.analysts.baseHashMismatches })) {
    errors.push('analyst isolation probe');
  }
  if (repair?.observed !== undefined && repair.observed !== null && errorRole !== undefined
    && JSON.stringify(repair.observed) !== JSON.stringify({ proven: errorRole.patches, excluded: errorRole.excluded })) {
    errors.push('evaluator-proven repair probe');
  }
  const tree = report.probes.find((probe) => probe.id === 'hierarchical-merge-plan');
  const application = report.probes.find((probe) => probe.id === 'guarded-single-application');
  if (tree?.observed !== undefined && tree.observed !== null
    && JSON.stringify(tree.observed) !== JSON.stringify({ levels: report.consolidation.levels, groups: report.consolidation.groups })) {
    errors.push('hierarchical merge plan probe');
  }
  if (application?.observed !== undefined && application.observed !== null
    && JSON.stringify(application.observed) !== JSON.stringify({ applications: report.consolidation.applications })) {
    errors.push('guarded single application probe');
  }
  // An application that staged nothing would be a directory nobody can read.
  if (report.consolidation.applications > 0 && report.consolidation.candidateId === null) {
    errors.push('an application staged no candidate');
  }
  const evaluation = report.evaluation;
  const activation = report.probes.find((probe) => probe.id === 'held-out-activation');
  if (activation?.observed !== undefined && activation.observed !== null
    && JSON.stringify(activation.observed) !== JSON.stringify({
      candidates: evaluation.candidateBundleId === null ? 0 : 1,
      activations: evaluation.activations.activated,
    })) {
    errors.push('held-out activation probe');
  }
  if (evaluation.eligible !== (evaluation.clauses.length === 0)) errors.push('eligibility without its clauses');
  if (evaluation.answered > evaluation.tasks) errors.push('more answers than held-out tasks');
  if (evaluation.activations.revision !== evaluation.activations.previousRevision + evaluation.activations.activated) {
    errors.push('head revision arithmetic');
  }
  // A directory becomes active because a held-out evaluation said so, and the
  // head then names that exact directory: anything else is a claim nobody made.
  if (evaluation.activations.activated === 1
    && (!evaluation.eligible || evaluation.activations.versionId !== evaluation.candidateBundleId)) {
    errors.push('an activation the evaluation did not authorize');
  }
  if (evaluation.activations.activated === 0 && evaluation.activations.versionId !== evaluation.activations.previousVersionId) {
    errors.push('a refused activation moved the head');
  }
  if (evaluation.candidateBundleId !== null && report.consolidation.bundleId !== evaluation.candidateBundleId) {
    errors.push('the evaluated directory is not the one the run staged');
  }
  if (report.consolidation.discarded !== report.consolidation.nodes.reduce((total, node) => total + node.withheld, 0)) {
    errors.push('withheld merge conflicts');
  }
  if (JSON.stringify(report.consolidation.nodes.map((node) => [node.level, node.groupIndex]))
    !== JSON.stringify([...report.consolidation.nodes].sort((a, b) => a.level - b.level || a.groupIndex - b.groupIndex).map((node) => [node.level, node.groupIndex]))) {
    errors.push('merge nodes out of tree order');
  }
  // An ablation's published score and delta are read back out of the table
  // row of the same condition, so a diagnostic cannot claim a number the
  // measured half does not carry.
  const ablationRows = report.tables[report.ablations.mode];
  const evolved = ablationRows.find((row) => row.condition === 'evolved-s-star');
  const methodScore = evolved?.status === 'run' ? evolved.metric.score : null;
  if (report.ablations.method.candidateBundleId !== report.consolidation.bundleId) errors.push('the ablations name a directory the run did not stage');
  if (report.ablations.method.levels !== report.consolidation.levels
    || report.ablations.method.groups !== report.consolidation.groups
    || report.ablations.method.withheld !== report.consolidation.discarded) {
    errors.push('the ablations restate the method differently from its own consolidation');
  }
  for (const entry of report.ablations.entries) {
    const row = ablationRows.find((candidate) => candidate.condition === entry.condition);
    if (row === undefined) { errors.push(`ablation without a row: ${entry.condition}`); continue; }
    if (row.status !== entry.status) errors.push(`ablation status: ${entry.condition}`);
    const score = row.status === 'run' ? row.metric.score : null;
    if (entry.score !== score) errors.push(`ablation score: ${entry.condition}`);
    const delta = score === null || methodScore === null ? null : score - methodScore;
    if (entry.vsEvolved !== delta) errors.push(`ablation delta: ${entry.condition}`);
    const same = entry.candidateBundleId !== null && entry.candidateBundleId === report.ablations.method.candidateBundleId;
    if (entry.sameDirectoryAsMethod !== same) errors.push(`ablation directory claim: ${entry.condition}`);
  }
  if (JSON.stringify(failureCounts(allRows, report.issues)) !== JSON.stringify(report.failures)) errors.push('hidden failures');
  // A published prompt version that is not the compiled pack's revision would
  // describe a run nobody can reproduce, so it is bound here rather than trusted.
  for (const [role, key] of PACK_ROLES) {
    if (report.identity.promptVersions[key] !== trace2SkillPrompt(role).revision) errors.push(`prompt artifact: ${role}`);
  }
  const packs = report.probes.find((probe) => probe.id === 'versioned-prompt-packs');
  if (packs?.observed !== undefined && packs.observed !== null) {
    const census = await observePacks(report.identity.promptVersions);
    if (JSON.stringify(packs.observed) !== JSON.stringify({ packs: census.packs })) errors.push('prompt pack census');
  }
  if (JSON.stringify(reportCapabilities(allRows, report.probes)) !== JSON.stringify(report.capabilities)) errors.push('forged capability');
  if (JSON.stringify(analyticEnvelope(allRows.map((row) => row.id))) !== JSON.stringify(report.envelope)) errors.push('identity envelope');
  for (const probe of report.probes) {
    if (probe.state === 'pass' && JSON.stringify(probe.expected) !== JSON.stringify(probe.observed)) errors.push(`false probe pass: ${probe.id}`);
  }
  if (report.oracle.ceiling !== 1) errors.push(`the oracle scores ${report.oracle.ceiling.toFixed(4)}, not 1`);
  if (!report.oracle.inBand) errors.push('the seeded control landed outside its analytic band');
  return { valid: errors.length === 0, errors };
}

/** Throw unless the report earned the named capability. */
export function requireCapability(report: Trace2skillReport, capability: string): void {
  if (!Object.hasOwn(report.capabilities, capability)) throw new Error(`unknown skill-evolution requirement: ${capability}`);
  if (!report.capabilities[capability as keyof Capabilities]) throw new Error(`skill-evolution capability unavailable: ${capability}`);
}

/**
 * Where a directory did worse than no directory, task by task. Published
 * whether or not there is anything in it: a comparison that prints only its
 * wins is an advertisement.
 */
export function heldOutRegressions(rows: readonly Row[], condition: Condition): Array<{ taskId: string, baseline: number, candidate: number }> {
  const baseline = rows.find((row) => row.condition === 'no-skill' && row.status === 'run');
  const measured = rows.find((row) => row.condition === condition && row.status === 'run');
  if (baseline === undefined || measured === undefined) return [];
  const scores = new Map(baseline.tasks.map((task) => [task.taskId, task.score]));
  return measured.tasks
    .filter((task) => (scores.get(task.taskId) ?? 0) > task.score)
    .map((task) => ({ taskId: task.taskId, baseline: scores.get(task.taskId) ?? 0, candidate: task.score }));
}

export function renderReport(report: Trace2skillReport): string {
  return JSON.stringify(report, null, 2) + '\n';
}

function rowTable(rows: readonly Row[]): string {
  return table({
    head: ['Row', 'Status', 'Skill', 'Tasks', 'Correct', 'Score', 'vs no skill', 'vs start', 'Turns', 'Tokens'],
    rows: rows.map((row) => [
      row.condition, row.status, row.skill === null ? '—' : row.skill.bundleId.slice(0, 12),
      row.tasks.length, row.metric.correct, score3(row.metric.score),
      row.deltas.vsNoSkill === null ? null : row.deltas.vsNoSkill.toFixed(3),
      row.deltas.vsS0 === null ? null : row.deltas.vsS0.toFixed(3),
      row.cost.turns, row.cost.tokens,
    ]),
  });
}

function countsTable(rows: readonly Row[]): string {
  return table({
    head: ['Row', 'Unanswered', 'Excluded', 'Failed', 'Leakage', 'Withheld', 'Script missing'],
    rows: rows.map((row) => [
      row.id, row.counts.unanswered, row.counts.excluded, row.counts.failed,
      row.counts.leakage, row.counts.withheld, row.counts.scriptMissing,
    ]),
  });
}

/** A twelve-character address, or an em dash where there is none. */
const short = (id: string | null): string => id === null ? '—' : id.slice(0, 12);

export function renderDocument(report: Trace2skillReport): string {
  const allRows = [...report.tables.deepening, ...report.tables.creation];
  const missing = allRows.filter((row) => row.status === 'implementation-missing');
  const unrun = allRows.filter((row) => row.status === 'not-run');
  return [
    '# Skill-evolution benchmark',
    '',
    'Generated by `npm run benchmark:trace2skill` over a Tangle-authored MIT fixture with a',
    'scripted model wire. Nothing here calls a provider: a counting network trap is installed',
    'before the first byte is read, and its zero is published as a probe.',
    '',
    '**Scripted rows measure fixture sensitivity and instrument mechanics, not model quality.**',
    'A scripted answer is registered data; it says whether the instrument can tell conditions',
    'apart, and it says nothing about whether a real model would answer the same way.',
    '',
    `Report identity: \`${report.reportId}\`. Fixture: \`${report.fixtureId}\`; registration \`${report.registrationId}\`;`,
    `source \`${report.source.sha256}\` over ${report.source.files.length} files. Suite ${report.suite.tangle}, Jaren ${report.suite.jaren}.`,
    '',
    '## The scorer, before any score',
    '',
    table({
      head: ['Control', 'Value'],
      rows: [
        ['held-out tasks', report.oracle.tasks],
        ['evaluator', report.oracle.evaluatorId],
        ['oracle ceiling', score3(report.oracle.ceiling)],
        ['answer pool', report.oracle.randomPoolSize],
        ['seeded control', score3(report.oracle.randomScore)],
        ['band', `${score3(report.oracle.band.low)} – ${score3(report.oracle.band.high)} (expectation ${score3(report.oracle.band.floor)})`],
        ['inside the band', report.oracle.inBand ? 'yes' : 'no'],
      ],
    }),
    '',
    `Splits: ${report.splits.evolve} evolve, ${report.splits.test} held out, disjoint \`${String(report.splits.disjoint)}\`,`,
    `${report.splits.overlapRefused} overlap refused. Evolve \`${report.splits.evolveHash.slice(0, 12)}\`, held out \`${report.splits.testHash.slice(0, 12)}\`.`,
    '',
    '## Deepening — from the human starting directory',
    '',
    rowTable(report.tables.deepening),
    '',
    '## Creation — from a trajectory-blind draft',
    '',
    rowTable(report.tables.creation),
    '',
    '## Where a starting directory loses',
    '',
    ...([['deepening', 'frozen-s0'], ['deepening', 'evolved-s-star'], ['creation', 'draft-s0'], ['creation', 'evolved-s-star']] as const).flatMap(([prefix, condition]) => {
      // A row that never ran has no comparison to publish. Printing "no task
      // scores lower" for it would be a claim about a mechanism nobody ran.
      const row = report.tables[prefix].find((entry) => entry.condition === condition);
      if (row === undefined || row.status !== 'run') {
        return [`- ${prefix}: \`${condition}\` did not run, so no comparison with no directory is made.`];
      }
      const losses = heldOutRegressions(report.tables[prefix], condition);
      return losses.length === 0
        ? [`- ${prefix}: no held-out task scores lower with \`${condition}\` than with no directory.`]
        : [`- ${prefix}: \`${condition}\` scores lower than no directory on ${losses.length} held-out task(s):`,
          ...losses.map((loss) => `  - \`${loss.taskId}\`: ${score3(loss.baseline)} without a directory, ${score3(loss.candidate)} with it.`)];
    }),
    '',
    '## Analysts — patches beside exclusions',
    '',
    `One independent analyst read each of the ${report.analysts.roles.reduce((total, role) => total + role.analyzed, 0)} \`${report.analysts.mode}\` evolve rollouts:`,
    'a single structured pass over a success, a bounded evaluator-backed repair over a failure. A patch is',
    'stored only where the host evaluator passed over a repair made in the sandbox, so the exclusions below',
    'are the honest other half of the yield rather than a silent shortfall.',
    '',
    table({
      head: ['Role', 'Analysed', 'Patches', 'Excluded', 'Calls', 'Tokens'],
      rows: report.analysts.roles.map((role) => [role.role, role.analyzed, role.patches, role.excluded, role.calls, role.tokens]),
    }),
    '',
    table({ head: ['Exclusion', 'Count'], rows: report.analysts.exclusions.map((exclusion) => [exclusion.reason, exclusion.count]) }),
    '',
    `Isolation counters — peer patches seen: ${report.analysts.peerPatchesSeen}; base-hash mismatches:`,
    `${report.analysts.baseHashMismatches}; units refused before any model call: ${report.analysts.refused}.`,
    '',
    '## Consolidation — one patch, applied once',
    '',
    `A ${report.consolidation.terminal} pool standing on ${report.consolidation.supportCount} trajectories was cut into groups`,
    `of at most ${report.consolidation.bMerge} over ${report.consolidation.levels} level(s). Every group merged against the frozen`,
    'directory and never against a directory a peer had edited, and the one surviving patch was applied',
    `${report.consolidation.applications} time(s) through the guarded editor: intermediate results are stored and never applied.`,
    '',
    table({
      head: ['Group', 'Level', 'Inputs', 'Kept', 'Folded', 'Withheld', 'Support'],
      rows: report.consolidation.nodes.map((node) => [
        `${node.level}-${node.groupIndex}`, node.level, node.inputs, node.unique, node.duplicates, node.withheld, node.supportCount,
      ]),
    }),
    '',
    table({ head: ['Decision', 'Count'], rows: report.consolidation.changelog.map((entry) => [entry.action, entry.count]) }),
    '',
    `Conflicts withheld by a merge group: ${report.consolidation.discarded}; hunks the compiler withheld from the applied`,
    `patch: ${report.consolidation.withheldHunks}; retained edits naming no trajectory: ${report.consolidation.unattributed};`,
    `groups refused before a call: ${report.consolidation.refused}.`,
    report.consolidation.candidateId === null
      ? '- No candidate was staged, so no evolved directory exists to score.'
      : `- Candidate \`${report.consolidation.candidateId.slice(0, 12)}\` stages directory \`${(report.consolidation.bundleId ?? '').slice(0, 12)}\``
        + ` from final patch \`${(report.consolidation.finalPatchId ?? '').slice(0, 12)}\`:`
        + ` ${report.consolidation.diffSummary?.filesAdded ?? 0} file(s) added, ${report.consolidation.diffSummary?.filesChanged ?? 0} changed,`
        + ` ${report.consolidation.diffSummary?.linesAdded ?? 0} line(s) added, ${report.consolidation.diffSummary?.linesRemoved ?? 0} removed.`,
    '',
    '## Held-out evaluation and activation',
    '',
    report.evaluation.evaluationId === null
      ? '- No candidate was evaluated, so no directory became eligible and no head moved.'
      : `Eligibility comes only from the held-out split. The gate is \`${report.evaluation.policy.primaryMetric}\` with a`
        + ` regression tolerance of ${report.evaluation.policy.regressionTolerance}, a coverage floor of`
        + ` ${report.evaluation.policy.minAnsweredCoverage} and a cost ceiling of`
        + ` ${report.evaluation.policy.costCeiling === null ? 'none' : String(report.evaluation.policy.costCeiling)};`
        + ` its identity is \`${(report.evaluation.policyVersion ?? '').slice(0, 12)}\`.`,
    '',
    table({
      head: ['Quantity', 'Value'],
      rows: [
        ['held-out tasks', report.evaluation.tasks],
        ['answered', report.evaluation.answered],
        ['mean delta vs the starting directory', report.evaluation.meanDelta === null ? null : report.evaluation.meanDelta.toFixed(3)],
        ['token delta', report.evaluation.costDelta],
        ['failed units', report.evaluation.failures],
        ['unanswered', report.evaluation.skips],
        ['leakage attempts', report.evaluation.leakage],
        ['eligible', report.evaluation.eligible ? 'yes' : 'no'],
      ],
    }),
    '',
    report.evaluation.clauses.length === 0
      ? '- The candidate failed no gate clause.'
      : `- The candidate failed ${report.evaluation.clauses.length} gate clause(s):`,
    ...report.evaluation.clauses.map((clause) => `  - \`${clause.clause}\` (${clause.code}): ${clause.detail}`),
    report.evaluation.regressions.length === 0
      ? '- No held-out task scores lower with the candidate than with the directory it replaces.'
      : `- The candidate scores lower than the directory it replaces on ${report.evaluation.regressions.length} held-out task(s):`,
    ...report.evaluation.regressions.map((loss) => `  - \`${loss.taskId}\`: ${score3(loss.baseline)} before, ${score3(loss.candidate)} after.`),
    '',
    `Driving the same run ${report.evaluation.drives} time(s) spent ${report.evaluation.resumedCalls} further call(s) and wrote`,
    `${report.evaluation.resumedWritten} further row(s); the resumed drive`,
    `${report.evaluation.candidateStable ? 'staged the same candidate identity' : 'did not reproduce the candidate identity'}.`,
    '',
    `Activation is a separate explicit call, never a stage: ${report.evaluation.activations.attempted} attempt(s),`,
    `${report.evaluation.activations.activated} applied and ${report.evaluation.activations.refused} refused, moving the head from`,
    `revision ${report.evaluation.activations.previousRevision} to ${report.evaluation.activations.revision}.`,
    '',
    table({
      head: ['Refused candidate', 'Code', 'Clause', 'Head unchanged', 'Prior readable'],
      rows: report.evaluation.refusals.map((refusal) => [
        refusal.scenario, refusal.code, refusal.clause,
        refusal.headUnchanged ? 'yes' : 'no', refusal.priorReadable ? 'yes' : 'no',
      ]),
    }),
    '',
    `${missing.length} of ${allRows.length} rows are unbuilt and ${unrun.length} are planned and deliberately not run. Either way the row`,
    'carries no tasks and no deltas rather than a zero, and its reason travels with it. The capability gates below are',
    'derived from the rows and the probes, never asserted.',
    '',
    ...(unrun.length === 0 ? [] : [
      '',
      table({ head: ['Not run', 'Why'], rows: unrun.map((row) => [row.id, row.reason ?? '']) }),
    ]),
    '',
    '## Ablations — the method with one part removed',
    '',
    'Each row below keeps the corpus, the frozen directory, the trajectories, the gate, the held-out split and the',
    'executor identity, and replaces exactly one part of the method. `vs method` is the signed held-out delta against',
    'the evolved directory: a positive number is an ablation that beat the method, and it is printed as it stands.',
    '',
    `The method itself: candidate \`${short(report.ablations.method.candidateId)}\`, directory \`${short(report.ablations.method.candidateBundleId)}\`,`,
    `${report.ablations.method.levels} merge level(s), ${report.ablations.method.groups} group(s), ${report.ablations.method.withheld} withheld conflict(s).`,
    '',
    table({
      head: ['Ablation', 'Status', 'Score', 'vs method', 'Same directory', 'Candidate', 'Calls', 'Tokens'],
      rows: report.ablations.entries.map((entry) => [
        entry.condition, entry.status, score3(entry.score),
        entry.vsEvolved === null ? null : entry.vsEvolved.toFixed(3),
        entry.sameDirectoryAsMethod ? 'yes' : 'no', short(entry.candidateId),
        entry.cost.calls, entry.cost.tokens,
      ]),
    }),
    '',
    ...report.ablations.entries.flatMap((entry) => [
      `- \`${entry.condition}\` replaces ${entry.replaces}.`,
      `  ${entry.counters.map((count) => `${count.name} ${count.value}`).join(', ')}.`,
    ]),
    '',
    ...(() => {
      const beat = report.ablations.entries.filter((entry) => entry.vsEvolved !== null && entry.vsEvolved > 0);
      const same = report.ablations.entries.filter((entry) => entry.sameDirectoryAsMethod).length;
      return beat.length === 0
        ? [`No ablation scores higher than the method on this corpus. ${same} of ${report.ablations.entries.length} reach the same directory it reaches,`,
          'so what separates them is cost and proof rather than a held-out number — which is exactly what a corpus of',
          'eight held-out tasks can resolve and no more.']
        : ['**An ablation beat the method here**, and the row stands as measured:',
          ...beat.map((entry) => `- \`${entry.condition}\` scores ${score3(entry.score)}, ${entry.vsEvolved?.toFixed(3)} against the evolved directory.`)];
    })(),
    '',
    '## Prompt packs',
    '',
    'Each role renders through one compiled pack, and the pack\'s revision IS the prompt version every',
    'idempotency key of that role names. A pack byte that moves moves the revision, which moves the key,',
    'which is why a resumed run cannot replay an answer to a question the pack no longer asks.',
    '',
    table({
      head: ['Role', 'Pack', 'Version', 'Revision'],
      rows: PACK_ROLES.map(([role, key]) => [
        role, trace2SkillPrompt(role).pack.meta.id, trace2SkillPrompt(role).pack.meta.version,
        `\`${report.identity.promptVersions[key].slice(0, 12)}\``,
      ]),
    }),
    '',
    'The salvaged packs the corpus keeps under `legacy-packs/` reproduce the retrieval baseline, not this method;',
    'they are registered fixture data and nothing compiles them into a package.',
    '',
    '## Counted failures',
    '',
    countsTable(allRows),
    '',
    table({ head: ['Reason', 'Count'], rows: report.failures.map((failure) => [failure.reason, failure.count]) }),
    '',
    '## Registered probes',
    '',
    table({
      head: ['Probe', 'Capability', 'State', 'Reason'],
      rows: report.probes.map((probe) => [probe.id, probe.capability, probe.state, probe.reason ?? 'the observation matched its registration']),
    }),
    '',
    '## Capabilities',
    '',
    table({
      head: ['Capability', 'Available'],
      rows: Object.entries(report.capabilities).map(([name, available]) => [name, available ? 'yes' : 'no']),
    }),
    '',
    '## Limitations',
    '',
    ...report.limitations.map((limitation) => `- ${limitation}`),
    '',
  ].join('\n');
}
