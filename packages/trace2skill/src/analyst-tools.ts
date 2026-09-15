/**
 * The repair sandbox and the surface an error analyst reaches through it.
 *
 * A failed trajectory is diagnosed against an in-memory overlay of what it
 * produced: the answer can be rewritten there and the host's REAL evaluator
 * run over the rewrite, so a repair is a recorded verdict rather than a
 * claim. Nothing in here runs a process, a shell or a file system — the
 * repair edits data, and isolated execution belongs to a host that owns a
 * sandbox. The stored rollout and the frozen directory are read-only on
 * every path; the overlay is discarded with the unit and refuses every call
 * afterwards, so one analyst's repair can never reach another's evidence.
 *
 * Ground truth is reachable here and only here, because a post-failure
 * repair is one of the two scopes the adapter admits. Every refusal the
 * host returns is counted rather than swallowed: an analyst that lost a
 * tool is a number in the run, not a silent exclusion.
 */
import { createToolbox } from '@tangleai/agents';
import { trace2SkillRefuse, type Trace2SkillOutcome } from './errors.ts';
import { ERROR_PROPOSAL_SCHEMA } from './schemas/analysis.ts';
import type { SkillAnalystTools } from './adapter.ts';
import type { SkillSnapshot } from './bundle.ts';
import type { AuthoredPatch, ErrorDiagnosis, RolloutStep, TaskEvaluation, TaskRollout, Trace2SkillIssue } from './contracts.gen.ts';

/** A repair is proven when the host's evaluator scores the rewritten output. */
export const REPAIR_PASSES = (evaluation: TaskEvaluation): boolean => evaluation.score >= 1;

export interface RepairAttempt {
  /** One-based, so a diagnosis can cite the attempt that passed. */
  attempt: number;
  answer: string;
  edited: boolean;
  evaluation: TaskEvaluation;
  passed: boolean;
}

export interface RepairSandboxOptions {
  /** Resolves a rollout artifact's bytes. A rollout with artifacts and no resolver is unsupported. */
  artifacts?: (address: string) => Trace2SkillOutcome<string>;
  /** Steps one `trace_read` may return, so an unbounded read cannot fill the window. */
  maxTraceSteps?: number;
}

export interface RepairSandbox {
  /** The overlay's answer. It starts as what the rollout produced. */
  readonly answer: string;
  /** Whether `edit` has been called, which is what separates a repair from a mislabel. */
  readonly edited: boolean;
  readonly attempts: readonly RepairAttempt[];
  /** The untouched output already passed: the label, not the directory, is wrong. */
  readonly alreadyCorrect: boolean;
  /** Host tools that answered with a refusal instead of a value. */
  readonly toolFailures: number;
  readonly issues: readonly Trace2SkillIssue[];
  edit(answer: string): Trace2SkillOutcome<string>;
  evaluate(): Trace2SkillOutcome<RepairAttempt>;
  truth(): Trace2SkillOutcome<string>;
  artifact(address: string): Trace2SkillOutcome<string>;
  trace(from: number, to: number): Trace2SkillOutcome<RolloutStep[]>;
  /** Drop the overlay. Every later call refuses, so a unit cannot outlive itself. */
  discard(): void;
}

const DEFAULT_TRACE_STEPS = 32;

/**
 * One overlay over one failed rollout. Refuses before any model call when the
 * rollout's outputs cannot be exposed, because a diagnosis written without
 * the evidence it names is not a diagnosis.
 */
export function createRepairSandbox(
  rollout: TaskRollout,
  tools: SkillAnalystTools,
  options: RepairSandboxOptions = {},
): Trace2SkillOutcome<RepairSandbox> {
  if (rollout.artifacts.length > 0 && options.artifacts === undefined) {
    return trace2SkillRefuse<RepairSandbox>('TT2S1013', `/rollouts/${rollout.id}/artifacts`,
      `the rollout carries ${rollout.artifacts.length} artifact(s) the host exposes no reader for`);
  }
  const maxSteps = options.maxTraceSteps ?? DEFAULT_TRACE_STEPS;
  const attempts: RepairAttempt[] = [];
  const issues: Trace2SkillIssue[] = [];
  let answer = rollout.finalAnswer;
  let edited = false;
  let alreadyCorrect = false;
  let toolFailures = 0;
  let live = true;

  const gone = <T>(at: string): Trace2SkillOutcome<T> =>
    trace2SkillRefuse<T>('TT2S1007', at, 'the repair sandbox of this unit was discarded');
  const lost = <T>(outcome: Trace2SkillOutcome<T>): Trace2SkillOutcome<T> => {
    if (!outcome.valid) { toolFailures++; issues.push(...outcome.issues); }
    return outcome;
  };

  const sandbox: RepairSandbox = {
    get answer() { return answer; },
    get edited() { return edited; },
    get attempts() { return attempts; },
    get alreadyCorrect() { return alreadyCorrect; },
    get toolFailures() { return toolFailures; },
    get issues() { return issues; },
    edit(next: string): Trace2SkillOutcome<string> {
      if (!live) return gone<string>('/repair/output_edit');
      answer = tools.output_edit(next);
      edited = true;
      return { valid: true, value: answer };
    },
    evaluate(): Trace2SkillOutcome<RepairAttempt> {
      if (!live) return gone<RepairAttempt>('/repair/evaluate');
      const verdict = lost(tools.evaluate(answer));
      if (!verdict.valid) return { valid: false, issues: [...verdict.issues] };
      const attempt: RepairAttempt = {
        attempt: attempts.length + 1, answer, edited,
        evaluation: verdict.value, passed: REPAIR_PASSES(verdict.value),
      };
      // A first verdict over an unedited overlay is a statement about the
      // label, not about the directory: nothing was repaired to produce it.
      if (attempts.length === 0 && !edited && attempt.passed) alreadyCorrect = true;
      attempts.push(attempt);
      return { valid: true, value: attempt };
    },
    truth(): Trace2SkillOutcome<string> {
      if (!live) return gone<string>('/repair/truth_read');
      return lost(tools.truth_read());
    },
    artifact(address: string): Trace2SkillOutcome<string> {
      if (!live) return gone<string>('/repair/artifact_read');
      const known = rollout.artifacts.some(artifact => artifact.address === address || artifact.name === address);
      if (!known) return lost(trace2SkillRefuse<string>('TT2S1001', `/repair/artifacts/${address}`, `the rollout carries no artifact ${address}`));
      return lost(options.artifacts!(address));
    },
    trace(from: number, to: number): Trace2SkillOutcome<RolloutStep[]> {
      if (!live) return gone<RolloutStep[]>('/repair/trace_read');
      const start = Number.isFinite(from) ? Math.max(0, Math.trunc(from)) : 0;
      const end = Number.isFinite(to) ? Math.min(rollout.steps.length, Math.trunc(to)) : rollout.steps.length;
      if (end <= start) return { valid: true, value: [] };
      return { valid: true, value: rollout.steps.slice(start, Math.min(end, start + maxSteps)).map(step => ({ ...step })) };
    },
    discard() { live = false; },
  };
  return { valid: true, value: sandbox };
}

const RANGE_SCHEMA = Object.freeze({
  type: 'object',
  required: ['from', 'to'],
  additionalProperties: false,
  properties: { from: { type: 'integer', minimum: 0 }, to: { type: 'integer', minimum: 0 } },
});

const ADDRESS_SCHEMA = Object.freeze({
  type: 'object',
  required: ['address'],
  additionalProperties: false,
  properties: { address: { type: 'string', minLength: 1, maxLength: 512 } },
});

const PATH_SCHEMA = Object.freeze({
  type: 'object',
  required: ['path'],
  additionalProperties: false,
  properties: { path: { type: 'string', minLength: 1, maxLength: 512 } },
});

const ANSWER_SCHEMA = Object.freeze({
  type: 'object',
  required: ['answer'],
  additionalProperties: false,
  properties: { answer: { type: 'string' } },
});

const NO_INPUT_SCHEMA = Object.freeze({ type: 'object', additionalProperties: false, properties: {} });

export interface AnalystProposal { patch: AuthoredPatch, diagnosis: ErrorDiagnosis }

export interface AnalystToolboxOptions {
  sandbox: RepairSandbox;
  rollout: TaskRollout;
  /** The frozen directory, read-only: an analyst reads it and never edits it. */
  snapshot: SkillSnapshot;
  /** The terminal call. A refusal here goes back to the model as a tool error. */
  propose(proposal: AnalystProposal): Trace2SkillOutcome<null>;
  toolbox?: ReturnType<typeof createToolbox>;
}

const refusal = (outcome: { valid: false, issues: Trace2SkillIssue[] }): { error: string, code: string } =>
  ({ error: outcome.issues[0].detail, code: outcome.issues[0].code });

/** The post-failure surface, registered once so every error analyst has the same one. */
export function createAnalystToolbox(options: AnalystToolboxOptions): ReturnType<typeof createToolbox> {
  const { sandbox, rollout, snapshot } = options;
  const toolbox = options.toolbox ?? createToolbox();
  const pages = new Map(snapshot.files.map(file => [file.path, file]));

  toolbox.add({
    name: 'trace_read',
    description: 'Read a half-open range of the failed trajectory\'s tool steps, each with the turn that made it.',
    inputSchema: RANGE_SCHEMA,
    execute: ({ from, to }: { from: number, to: number }) => {
      const read = sandbox.trace(from, to);
      return read.valid ? { from, to, total: rollout.steps.length, steps: read.value } : refusal(read);
    },
  });
  toolbox.add({
    name: 'artifact_read',
    description: 'Read one artifact the failed trajectory produced, by its recorded address.',
    inputSchema: ADDRESS_SCHEMA,
    execute: ({ address }: { address: string }) => {
      const read = sandbox.artifact(address);
      return read.valid ? { address, content: read.value } : refusal(read);
    },
  });
  toolbox.add({
    name: 'truth_read',
    description: 'Read the registered answer of the failed task. Reachable inside this repair and nowhere else.',
    inputSchema: NO_INPUT_SCHEMA,
    execute: () => {
      const read = sandbox.truth();
      return read.valid ? { answer: read.value } : refusal(read);
    },
  });
  toolbox.add({
    name: 'skill_read',
    description: 'Read one file of the frozen skill directory. The directory is read-only here.',
    inputSchema: PATH_SCHEMA,
    execute: ({ path }: { path: string }) => {
      const page = pages.get(path);
      if (page === undefined) return { error: `the skill directory carries no ${path}`, code: 'TT2S1005' };
      if (page.content === null) return { path, mediaType: page.mediaType, encoding: page.encoding, size: page.size, sha256: page.sha256 };
      return { path, content: page.content };
    },
  });
  toolbox.add({
    name: 'output_edit',
    description: 'Rewrite the failed answer inside the in-memory overlay. Nothing durable is written.',
    inputSchema: ANSWER_SCHEMA,
    execute: ({ answer }: { answer: string }) => {
      const edit = sandbox.edit(answer);
      return edit.valid ? { answer: edit.value } : refusal(edit);
    },
  });
  toolbox.add({
    name: 'evaluate',
    description: 'Run the host evaluator over the overlay as it stands and record its verdict.',
    inputSchema: NO_INPUT_SCHEMA,
    execute: () => {
      const verdict = sandbox.evaluate();
      if (!verdict.valid) return refusal(verdict);
      const { attempt, evaluation, passed } = verdict.value;
      return { attempt, pass: passed, score: evaluation.score, detail: evaluation.detail };
    },
  });
  toolbox.add({
    name: 'propose',
    description: 'Propose the directory patch this failure justifies, with the diagnosis that explains it. Call it once the evaluator has passed over the repaired output.',
    inputSchema: ERROR_PROPOSAL_SCHEMA,
    execute: (proposal: AnalystProposal) => {
      const accepted = options.propose(proposal);
      return accepted.valid ? { accepted: true } : refusal(accepted);
    },
  });
  return toolbox;
}

/** The tool names an error analyst is given, in registration order. */
export const ANALYST_TOOL_NAMES: readonly string[] = Object.freeze([
  'trace_read', 'artifact_read', 'truth_read', 'skill_read', 'output_edit', 'evaluate', 'propose',
]) as readonly string[];
