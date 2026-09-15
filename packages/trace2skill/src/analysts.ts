/**
 * One independent analyst per labeled trajectory.
 *
 * A rollout that answered correctly is read once, in a single structured
 * pass, for what it did that the directory does not yet say. A rollout that
 * failed gets a bounded agent over a repair sandbox instead, and may propose
 * a patch only after the host's own evaluator has passed over a repair made
 * inside that sandbox — an analyst's assertion that its fix works is not
 * evidence, and the asymmetry between the two roles is the method, not an
 * optimization.
 *
 * Every analyst sees exactly one rollout and the frozen directory. It never
 * sees a peer's patch, a mutated directory or another trajectory: an input
 * that names a patch id, or whose base hash is not the run's, is refused
 * before a single model call, and that refusal is a counted number rather
 * than a dropped unit. Exclusions are first-class rows with their spend,
 * because a run that hides the analyses it could not use cannot be read as a
 * measurement of how many it could.
 */
import { mapConcurrent } from '@jarenjs/core/async';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createAgent } from '@tangleai/agents';
import { createStructuredOutput } from '@tangleai/models/structured';
import { MasBudgetStop } from '@tangleai/mas';
import { trace2SkillIssue, trace2SkillRefuse, type Trace2SkillOutcome } from './errors.ts';
import { byPath, idempotencyKeyOf } from './identity.ts';
import { draftsOf } from './bundle.ts';
import { applyCompiled, compilePatch, guidanceLeakCheck, type FrozenSkill } from './patch.ts';
import { MINIMAL_SKILL_PROFILE, type SkillFormatProfile } from './format.ts';
import { createAnalystToolbox, createRepairSandbox, type AnalystProposal, type RepairSandbox, type RepairSandboxOptions } from './analyst-tools.ts';
import { ANALYST_EXCLUSIONS, SUCCESS_ANALYSIS_SCHEMA } from './schemas/analysis.ts';
import { trace2SkillPrompt } from './artifacts.ts';
import { renderTrace2SkillPrompt } from './prompts.ts';
import { meterClient } from './executor.ts';
import type { SkillChatClient } from './executor.ts';
import type { SkillSnapshot } from './bundle.ts';
import type { Trace2SkillTaskAdapter } from './adapter.ts';
import type { Trace2SkillStore } from './store.ts';
import type {
  AnalystExclusion, AnalystResult, AuthoredPatch, ErrorDiagnosis, EvolutionRun, SkillBundle,
  SkillPatch, Spend, SuccessAnalysis, TaskRollout, Trace2SkillIssue, Trace2SkillPromptArtifact,
} from './contracts.gen.ts';

/** The stage an analyst's idempotency key is scoped to. */
export const ANALYSIS_STAGE = 'analysis';
/** The compiled analyst packs' revisions, which are the prompt versions an analysis key names. */
export const SUCCESS_ANALYST_PROMPT_VERSION = trace2SkillPrompt('success-analyst').revision;
export const ERROR_ANALYST_PROMPT_VERSION = trace2SkillPrompt('error-analyst').revision;

const PLACEHOLDER_ID = '0'.repeat(64);
const DEFAULT_CONTEXT_CHARS = 24_000;
const NO_SPEND: Spend = Object.freeze({ calls: 0, tokens: 0, cost: null });

/** What one analyst is allowed to see. A peer's patch id here is a refusal, not a hint. */
export interface AnalystInput {
  rollout: TaskRollout;
  s0: SkillBundle;
  adapterId: string;
  /** Patches produced elsewhere in this run. Any member refuses the unit before a model call. */
  patchIds?: readonly string[];
}

export type AnalystRole = AnalystResult['role'];

export interface AnalystDeps {
  store: Trace2SkillStore;
  adapter: Trace2SkillTaskAdapter;
  /** The run's client, already wrapped by its shared budget account, or one bound per unit. */
  client: SkillChatClient | ((input: AnalystInput) => SkillChatClient);
  /** The frozen directory every analyst reads and none of them edits. */
  snapshot: SkillSnapshot;
  /** Registered answers and other task-instance facts reusable guidance may not carry. */
  forbidden?: readonly string[];
  /** What the answer depends on besides the prompt: the resolved model configuration. */
  modelIdentity: string;
  attempt?: number;
  maxRepairs?: number;
  maxToolRounds?: number;
  /** The window the stored trajectory must fit in before it is analysed at all. */
  contextChars?: number;
  profile?: SkillFormatProfile;
  artifacts?: RepairSandboxOptions['artifacts'];
  /** The compiled packs the two roles render through; the defaults are the published ones. */
  prompts?: { success?: Trace2SkillPromptArtifact, error?: Trace2SkillPromptArtifact };
  promptVersions?: { success?: string, error?: string };
  now?: () => number;
  /** The run's orchestration log; one coarse entry per unit. */
  trajectory?: { add(entry: unknown): unknown };
}

export interface AnalystUnit {
  rolloutId: string;
  taskId: string;
  role: AnalystRole;
  attempt: number;
  idempotencyKey: string;
  result: AnalystResult | null;
  patch: SkillPatch | null;
  /** True when the stored analysis answered and no call was made. */
  reused: boolean;
  calls: number;
  issues: Trace2SkillIssue[];
}

export interface AnalystRoleCounts { analyzed: number, patches: number, excluded: number, calls: number, tokens: number }

export interface AnalystCounts {
  success: AnalystRoleCounts;
  error: AnalystRoleCounts;
  /** Every reason a patch was not emitted, including the ones no unit reached. */
  exclusions: Record<AnalystExclusion, number>;
  refused: number;
  peerPatchesSeen: number;
  baseHashMismatches: number;
  reused: number;
  written: number;
  calls: number;
  tokens: number;
}

export interface AnalystFanOut {
  units: AnalystUnit[];
  results: AnalystResult[];
  patches: SkillPatch[];
  counts: AnalystCounts;
  issues: Trace2SkillIssue[];
}

const emptyRole = (): AnalystRoleCounts => ({ analyzed: 0, patches: 0, excluded: 0, calls: 0, tokens: 0 });
const emptyExclusions = (): Record<AnalystExclusion, number> =>
  Object.fromEntries(ANALYST_EXCLUSIONS.map(reason => [reason, 0])) as Record<AnalystExclusion, number>;

/** A success rollout is read for what worked; anything else is a failure to diagnose. */
export const analystRoleOf = (rollout: TaskRollout): AnalystRole => rollout.label === 'success' ? 'success' : 'error';

/** The inputs one fan-out analyses: one rollout each, the frozen directory, and nothing else. */
export function analystInputsOf(rollouts: readonly TaskRollout[], s0: SkillBundle, adapterId: string): AnalystInput[] {
  return [...rollouts]
    .sort((left, right) => byPath(left.taskId, right.taskId) || byPath(left.id, right.id))
    .map(rollout => ({ rollout, s0, adapterId }));
}

/** The stored trajectory as an analyst reads it. No summary, no bounded view: the record itself. */
export function renderRolloutEvidence(rollout: TaskRollout): string {
  const lines = [
    `Task: ${rollout.taskId}`,
    `Stop reason: ${rollout.stopReason}`,
    `Turns: ${rollout.spend.calls}`,
    '',
    'Transcript:',
    ...rollout.messages.map(message => `- ${message.role}: ${message.content}`),
  ];
  if (rollout.reasoning.length > 0) {
    lines.push('', 'Reasoning, per turn:', ...rollout.reasoning.map(entry => `- turn ${entry.turn}: ${entry.text}`));
  }
  lines.push('', 'Steps:', ...rollout.steps.map((step, index) =>
    `- [${index}] turn ${step.turn} ${step.name}(${step.arguments}) -> ${step.result}`));
  lines.push('', `Final answer: ${rollout.finalAnswer}`,
    `Evaluation: score ${rollout.evaluation.score} (${rollout.evaluation.detail})`, `Label: ${rollout.label}`);
  return lines.join('\n');
}

/** How much of the trajectory fits a window when it is cut at a step boundary. */
export function stepsWithin(rollout: TaskRollout, contextChars: number): number {
  let fits = rollout.steps.length;
  while (fits > 0 && renderRolloutEvidence({ ...rollout, steps: rollout.steps.slice(0, fits) }).length > contextChars) fits--;
  return fits;
}

/** Reusable guidance may not carry a task-instance fact; every text a patch would write is checked. */
function leakCheck(patch: AuthoredPatch, forbidden: readonly string[]): Trace2SkillOutcome<null> {
  const texts = [patch.reasoning, ...patch.operations.map(operation => operation.path)];
  for (const text of texts) {
    const leak = guidanceLeakCheck(text, forbidden);
    if (!leak.valid) return leak;
  }
  return { valid: true, value: null };
}

/**
 * The gate both roles are held to, synchronous so it can run inside a
 * structured repair round and inside a terminal tool call alike: the patch
 * compiles against the frozen directory with nothing withheld, the result is
 * a valid directory, and the guidance carries no task-instance fact.
 */
export function gateAuthoredPatch(
  frozen: FrozenSkill,
  authored: AuthoredPatch,
  forbidden: readonly string[],
  profile: SkillFormatProfile,
): Trace2SkillOutcome<null> {
  const leak = leakCheck(authored, forbidden);
  if (!leak.valid) return leak;
  const compiled = compilePatch(frozen, {
    id: PLACEHOLDER_ID, runId: PLACEHOLDER_ID, baseHash: frozen.bundle.id,
    sourceRolloutIds: [], sourcePatchIds: [], supportCount: 1,
    reasoning: authored.reasoning, operations: [...authored.operations], changelog: [],
    validation: { state: 'pending', issues: [] },
  }, { forbidden, profile });
  if (!compiled.valid) return { valid: false, issues: [...compiled.issues] };
  if (compiled.value.withheld.length > 0) {
    return trace2SkillRefuse<null>('TT2S1004', '/operations',
      `${compiled.value.withheld.length} hunk(s) of this proposal are withheld against the frozen directory`);
  }
  const applied = applyCompiled(frozen.files, compiled.value, profile);
  if (!applied.valid) return { valid: false, issues: [...applied.issues] };
  return { valid: true, value: null };
}

/**
 * Seal an authored patch: identity, run, frozen base and provenance are the
 * dispatcher's to write, never the role's to claim. Published because a host
 * that supplies its own analyst role still owes a patch addressed exactly the
 * way this fan-out addresses one.
 */
export async function sealAuthoredPatch(run: EvolutionRun, rollout: TaskRollout, authored: AuthoredPatch): Promise<SkillPatch> {
  const payload = {
    runId: run.id, baseHash: run.s0Hash, sourceRolloutIds: [rollout.id], sourcePatchIds: [],
    supportCount: 1, reasoning: authored.reasoning, operations: [...authored.operations],
    changelog: [] as string[], validation: { state: 'compiled' as const, issues: [] },
  };
  return { id: await canonicalSha256(payload), ...payload };
}

interface RoleOutcome {
  status: AnalystResult['status'];
  exclusion: AnalystExclusion | null;
  diagnosis: string;
  repair: AnalystResult['repair'];
  patch: SkillPatch | null;
  spend: Spend;
  issues: Trace2SkillIssue[];
  /**
   * The shared run budget stopped this unit. It is a refusal of the run, not a
   * verdict on the trajectory: nothing is stored under the unit's key, so a
   * resumed run with room left retries it instead of replaying a stop.
   */
  stopped?: boolean;
}

const excludedAs = (exclusion: AnalystExclusion, detail: string, spend: Spend, issues: Trace2SkillIssue[] = []): RoleOutcome => ({
  status: 'excluded', exclusion,
  diagnosis: JSON.stringify({ exclusion, detail, codes: issues.map(issue => issue.code) }),
  repair: null, patch: null, spend, issues,
});

/** The run's own ceiling, which keeps its spend and leaves the unit retryable. */
const stoppedByRun = (cause: MasBudgetStop, spend: Spend, at: string): RoleOutcome => ({
  status: 'excluded', exclusion: null, diagnosis: '', repair: null, patch: null, spend, stopped: true,
  issues: [trace2SkillIssue('TT2S1009', at, `the run budget stopped this analysis (${cause.reason})`, cause)],
});

/** One structured pass over one successful trajectory. */
async function runSuccessAnalyst(
  run: EvolutionRun, input: AnalystInput, deps: AnalystDeps,
  frozen: FrozenSkill, forbidden: readonly string[], profile: SkillFormatProfile,
  artifact: Trace2SkillPromptArtifact,
): Promise<RoleOutcome> {
  const { rollout } = input;
  const contextChars = deps.contextChars ?? DEFAULT_CONTEXT_CHARS;
  const evidence = renderRolloutEvidence(rollout);
  if (evidence.length > contextChars) {
    const fits = stepsWithin(rollout, contextChars);
    return excludedAs('unsupported-artifacts',
      `the stored trajectory is ${evidence.length} characters against a ${contextChars} character window; ${fits} of ${rollout.steps.length} steps fit at a step boundary`,
      NO_SPEND);
  }
  const rendered = renderTrace2SkillPrompt(artifact, { evidence });
  if (!rendered.valid) return excludedAs('exhausted', 'the analyst prompt did not render', NO_SPEND, [...rendered.issues]);
  const wire = meterClient(typeof deps.client === 'function' ? deps.client(input) : deps.client);
  const gateIssues: Trace2SkillIssue[] = [];
  const analyst = createStructuredOutput({
    client: wire.client,
    schema: SUCCESS_ANALYSIS_SCHEMA,
    name: 'success_analysis',
    maxRepairs: deps.maxRepairs ?? 1,
    // Synchronous by construction: the compiler, the format validator and the
    // leak check a stored patch meets, so a repair round is told exactly what
    // the run would refuse.
    gate: (value: unknown) => {
      const patch = (value as SuccessAnalysis).patch;
      if (patch === null || patch === undefined) return true;
      const gated = gateAuthoredPatch(frozen, patch, forbidden, profile);
      if (gated.valid) return true;
      gateIssues.push(...gated.issues);
      return { valid: false, errors: gated.issues.map(issue => ({ instancePath: '/patch', keyword: issue.code, message: issue.detail })) };
    },
  });

  let generated;
  try {
    generated = await analyst.generate([
      { role: 'system', content: rendered.value.system },
      { role: 'user', content: rendered.value.user },
    ]);
  }
  catch (cause) {
    if (!(cause instanceof MasBudgetStop)) throw cause;
    return stoppedByRun(cause, wire.spend(), `/rollouts/${rollout.id}`);
  }
  const spend = wire.spend();
  if (generated.value === undefined) {
    const issues = gateIssues.length > 0 ? [gateIssues[gateIssues.length - 1]] : [trace2SkillIssue('TT2S1001', '/patch',
      (generated.errors ?? []).map((error: { message?: unknown }) => String(error.message ?? 'invalid')).slice(0, 2).join('; ') || 'the analysis does not validate')];
    return excludedAs('exhausted', `${generated.attempts} attempt(s) produced nothing the run would store`, spend, issues);
  }
  const analysis = generated.value as SuccessAnalysis;
  if (analysis.patch === null) {
    return excludedAs('already-correct', 'the trajectory needed nothing the directory does not already say', spend);
  }
  return {
    status: 'patch', exclusion: null,
    diagnosis: JSON.stringify({ patterns: analysis.patterns, reasoning: analysis.reasoning }),
    repair: null, patch: await sealAuthoredPatch(run, rollout, analysis.patch), spend, issues: [],
  };
}

/** The terminal state of one repair loop, read from what the sandbox recorded and never from a claim. */
function resolveRepair(
  sandbox: RepairSandbox, proposal: AnalystProposal | null, issues: Trace2SkillIssue[],
): { exclusion: AnalystExclusion, detail: string, issues: Trace2SkillIssue[] } | { proven: true, proposal: AnalystProposal } {
  if (sandbox.alreadyCorrect) {
    return { exclusion: 'already-correct', detail: 'the untouched output passed the evaluator, so the label and not the directory is wrong', issues: [] };
  }
  const last = sandbox.attempts[sandbox.attempts.length - 1];
  const cited = proposal === null ? undefined : sandbox.attempts.find(attempt => attempt.attempt === proposal.diagnosis.evaluation);
  const proven = proposal !== null && last !== undefined && last.passed && cited !== undefined && cited.passed;
  // A host tool that refused is why there is no proof; blaming the analyst for
  // a proof it was never allowed to attempt would hide the host's failure.
  if (!proven && sandbox.toolFailures > 0) {
    return { exclusion: 'tool-failure', detail: `${sandbox.toolFailures} host tool call(s) refused during the repair`, issues: [...sandbox.issues] };
  }
  if (proposal === null) {
    return { exclusion: 'exhausted', detail: `the loop ended after ${sandbox.attempts.length} evaluation(s) without a proposal`, issues };
  }
  if (!proven) {
    return {
      exclusion: 'evaluator-disagrees',
      detail: last === undefined
        ? 'the proposal claims a repair no evaluation was run over'
        : `the proposal cites evaluation ${proposal.diagnosis.evaluation} and the last recorded verdict scored ${last.evaluation.score}`,
      issues: [trace2SkillIssue('TT2S1011', '/repair/evaluate',
        'a patch is stored only when the host evaluator passed over the repaired output')],
    };
  }
  const diagnosis = proposal.diagnosis;
  if (diagnosis.failingStepIndexes.length === 0 || diagnosis.mismatch.trim() === ''
    || diagnosis.repair.trim() === '' || diagnosis.generalization.trim() === '') {
    return {
      exclusion: 'no-causal-explanation',
      detail: 'the repair passed and the proposal names no failing span, mismatch, repair or generalization',
      issues: [],
    };
  }
  return { proven: true, proposal };
}

/** A bounded agent over one repair sandbox, allowed to propose only what the evaluator accepted. */
async function runErrorAnalyst(
  run: EvolutionRun, input: AnalystInput, deps: AnalystDeps,
  frozen: FrozenSkill, forbidden: readonly string[], profile: SkillFormatProfile,
  artifact: Trace2SkillPromptArtifact,
): Promise<RoleOutcome> {
  const { rollout } = input;
  const opened = createRepairSandbox(rollout, deps.adapter.analystTools(rollout.taskId), {
    ...(deps.artifacts === undefined ? {} : { artifacts: deps.artifacts }),
  });
  if (!opened.valid) {
    return excludedAs('unsupported-artifacts', opened.issues[0].detail, NO_SPEND, [...opened.issues]);
  }
  const rendered = renderTrace2SkillPrompt(artifact, { evidence: renderRolloutEvidence(input.rollout) });
  if (!rendered.valid) {
    opened.value.discard();
    return excludedAs('exhausted', 'the analyst prompt did not render', NO_SPEND, [...rendered.issues]);
  }
  const sandbox = opened.value;
  const issues: Trace2SkillIssue[] = [];
  let proposal: AnalystProposal | null = null;
  const toolbox = createAnalystToolbox({
    sandbox, rollout, snapshot: deps.snapshot,
    propose(candidate: AnalystProposal): Trace2SkillOutcome<null> {
      const gated = gateAuthoredPatch(frozen, candidate.patch, forbidden, profile);
      // A refused proposal goes back as a tool error: the analyst may spend
      // another round on it, and the reason it was refused stays counted.
      if (!gated.valid) { issues.push(...gated.issues); return gated; }
      proposal = candidate;
      return { valid: true, value: null };
    },
  });

  const wire = meterClient(typeof deps.client === 'function' ? deps.client(input) : deps.client);
  const agent = createAgent({
    client: wire.client, toolbox, system: rendered.value.system,
    maxToolRounds: deps.maxToolRounds ?? run.budgets.turns,
    budget: { turns: run.budgets.turns, tokens: run.budgets.tokens, ms: run.budgets.ms },
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });
  let stopReason = 'stop';
  try {
    const result = await agent.send([{ role: 'user', content: rendered.value.user }]);
    stopReason = String(result.stopReason);
  }
  catch (cause) {
    sandbox.discard();
    if (!(cause instanceof MasBudgetStop)) throw cause;
    const stopped = agent.spend();
    return stoppedByRun(cause, { calls: stopped.turns, tokens: stopped.tokens, cost: null }, `/rollouts/${rollout.id}`);
  }
  const spent = agent.spend();
  const spend: Spend = { calls: spent.turns, tokens: spent.tokens, cost: null };
  const resolved = resolveRepair(sandbox, proposal, issues);
  const attempts = sandbox.attempts.length;
  const last = sandbox.attempts[attempts - 1];
  sandbox.discard();

  if (!('proven' in resolved)) {
    return excludedAs(resolved.exclusion, `${resolved.detail} (${stopReason})`, spend, [...issues, ...resolved.issues]);
  }
  const accepted = resolved.proposal;
  const diagnosis: ErrorDiagnosis = accepted.diagnosis;
  return {
    status: 'patch', exclusion: null,
    diagnosis: JSON.stringify(diagnosis),
    repair: { attempts, evaluation: last.evaluation },
    patch: await sealAuthoredPatch(run, rollout, accepted.patch), spend, issues,
  };
}

/**
 * The one analyst fan-out: one unit per input, ordered by task id rather than
 * by whoever finished first, each addressed by a key over everything that
 * changes its answer so a resumed run reuses exactly what it already paid for.
 */
export async function dispatchAnalysts(run: EvolutionRun, inputs: readonly AnalystInput[], deps: AnalystDeps): Promise<AnalystFanOut> {
  const attempt = deps.attempt ?? 1;
  const profile = deps.profile ?? MINIMAL_SKILL_PROFILE;
  const frozen: FrozenSkill = { bundle: deps.snapshot.bundle, files: draftsOf(deps.snapshot.files) };
  const ordered = [...inputs].sort((left, right) =>
    byPath(left.rollout.taskId, right.rollout.taskId) || byPath(left.rollout.id, right.rollout.id));
  const stored = await deps.store.listBy(run.id, 'analyses');
  const known = new Map(stored.map(result => [result.idempotencyKey, result]));
  // A replayed unit has to hand back the proposal it produced, or a resumed
  // run would consolidate an empty pool and call it a merge.
  const storedPatches = new Map((await deps.store.listBy(run.id, 'patches')).map(patch => [patch.id, patch]));
  const counts: AnalystCounts = {
    success: emptyRole(), error: emptyRole(), exclusions: emptyExclusions(),
    refused: 0, peerPatchesSeen: 0, baseHashMismatches: 0, reused: 0, written: 0, calls: 0, tokens: 0,
  };

  const worker = async (input: AnalystInput): Promise<AnalystUnit> => {
    const issues: Trace2SkillIssue[] = [];
    const role = analystRoleOf(input.rollout);
    const artifact = role === 'success'
      ? deps.prompts?.success ?? trace2SkillPrompt('success-analyst')
      : deps.prompts?.error ?? trace2SkillPrompt('error-analyst');
    const promptVersion = (role === 'success' ? deps.promptVersions?.success : deps.promptVersions?.error) ?? artifact.revision;
    const key = await idempotencyKeyOf({
      runId: run.id, stage: ANALYSIS_STAGE, unit: input.rollout.id, attempt,
      inputHashes: [run.s0Hash, deps.adapter.toolManifestHash], identityId: deps.modelIdentity, promptVersion,
    });
    const unit: AnalystUnit = {
      rolloutId: input.rollout.id, taskId: input.rollout.taskId, role, attempt,
      idempotencyKey: key, result: null, patch: null, reused: false, calls: 0, issues,
    };
    const replay = known.get(key);
    if (replay !== undefined) {
      deps.trajectory?.add({ kind: 'analysis', taskId: input.rollout.taskId, role, analysisId: replay.id, status: replay.status, spend: replay.spend, reused: true });
      const patch = replay.patchId === null ? null : storedPatches.get(replay.patchId) ?? null;
      if (replay.patchId !== null && patch === null) {
        issues.push(trace2SkillIssue('TT2S1012', `/analyses/${input.rollout.taskId}/patchId`,
          'the stored result names a proposal the store does not hold'));
      }
      return { ...unit, result: replay, patch, reused: true };
    }

    // Isolation, before anything is spent: an analyst that can see a peer's
    // patch or another directory is not an independent analyst.
    if (input.patchIds !== undefined && input.patchIds.length > 0) {
      counts.peerPatchesSeen++;
      issues.push(trace2SkillIssue('TT2S1007', `/analyses/${input.rollout.taskId}/patchIds`,
        `the analyst input names ${input.patchIds.length} peer patch id(s)`));
      return unit;
    }
    if (input.s0.id !== run.s0Hash || input.rollout.s0Hash !== run.s0Hash) {
      counts.baseHashMismatches++;
      issues.push(trace2SkillIssue('TT2S1007', `/analyses/${input.rollout.taskId}/s0Hash`,
        `the run pins ${run.s0Hash.slice(0, 12)}… and this unit names ${(input.s0.id === run.s0Hash ? input.rollout.s0Hash : input.s0.id).slice(0, 12)}…`));
      return unit;
    }
    if (input.adapterId !== deps.adapter.id) {
      issues.push(trace2SkillIssue('TT2S1013', `/analyses/${input.rollout.taskId}/adapterId`,
        `the unit names adapter ${input.adapterId} and the run holds ${deps.adapter.id}`));
      return unit;
    }

    const forbidden = [input.rollout.taskId, ...(deps.forbidden ?? [])];
    const prepared = deps.adapter.prepare(input.rollout.taskId);
    if (prepared.valid) forbidden.push(...prepared.value.inputs.map(file => file.path));

    const outcome = role === 'success'
      ? await runSuccessAnalyst(run, input, deps, frozen, forbidden, profile, artifact)
      : await runErrorAnalyst(run, input, deps, frozen, forbidden, profile, artifact);
    issues.push(...outcome.issues);
    unit.calls = outcome.spend.calls;
    if (outcome.stopped === true) {
      deps.trajectory?.add({ kind: 'analysis', taskId: input.rollout.taskId, role, analysisId: null, status: 'refused', spend: outcome.spend, reused: false });
      return unit;
    }

    if (outcome.patch !== null) {
      const written = await deps.store.putPatch(outcome.patch);
      if (!written.valid) {
        issues.push(trace2SkillIssue('TT2S1002', `/patches/${outcome.patch.id}`, 'the proposed patch met an immutable address holding other bytes', written.issues[0]));
        return unit;
      }
    }
    const result: AnalystResult = {
      id: key, runId: run.id, role, rolloutId: input.rollout.id, s0Hash: run.s0Hash,
      status: outcome.status, exclusion: outcome.exclusion, diagnosis: outcome.diagnosis,
      repair: outcome.repair, patchId: outcome.patch === null ? null : outcome.patch.id,
      spend: outcome.spend, idempotencyKey: key,
    };
    const written = await deps.store.putAnalysis(result);
    if (!written.valid) {
      issues.push(trace2SkillIssue('TT2S1007', `/analyses/${key}`, 'a second result was written for one idempotency key', written.issues[0]));
      return unit;
    }
    deps.trajectory?.add({ kind: 'analysis', taskId: input.rollout.taskId, role, analysisId: result.id, status: result.status, spend: result.spend, reused: false });
    return { ...unit, result: written.value, patch: outcome.patch };
  };

  const units = await mapConcurrent(ordered, run.concurrency, worker);
  const issues: Trace2SkillIssue[] = [];
  const results: AnalystResult[] = [];
  const patches: SkillPatch[] = [];
  for (const unit of units) {
    counts.calls += unit.calls;
    issues.push(...unit.issues);
    if (unit.result === null) { counts.refused++; continue; }
    results.push(unit.result);
    if (unit.patch !== null) patches.push(unit.patch);
    if (unit.reused) counts.reused++; else counts.written++;
    counts.tokens += unit.result.spend.tokens;
    const role = counts[unit.result.role];
    role.analyzed++;
    role.calls += unit.result.spend.calls;
    role.tokens += unit.result.spend.tokens;
    if (unit.result.status === 'patch') role.patches++;
    else {
      role.excluded++;
      if (unit.result.exclusion !== null) counts.exclusions[unit.result.exclusion]++;
    }
  }
  return { units, results, patches, counts, issues };
}
