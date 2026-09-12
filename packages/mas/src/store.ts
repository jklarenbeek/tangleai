/**
 * The store-neutral MAS persistence contract — narrow methods, pure plans.
 *
 * `MasStore` is what the runtime executes against and what
 * `@tangleai/store` implements over the Jaren database. Every mutation
 * is a pure `plan*` decision (validated against the generated runtime
 * schemas, refusing with stable `TMAS2xxx` values) followed by one
 * adapter transaction that applies it atomically:
 * a node's terminal attempt, outbound messages, state revision, budget
 * snapshot and artifacts commit together under its semantic idempotency
 * key or not at all, and returning a stored completion on replay is
 * legal while a partial semantic commit is not.
 */

import { masIssue, type MasIssue } from './errors.ts';
import { validateRuntimeRecord } from './schema.ts';
import type {
  BoundedView, BudgetSpend, ContextRead, MasInteraction, MasMessage, MasNodeAttempt,
  MasRun, MasStateRevision, MasTraceArtifact, MasWorkflow, RuntimeError, ToolStep, UsageCounts,
} from './contracts.gen.ts';

// -- outcomes ----------------------------------------------------------------

export type StoreOutcome<T> = { ok: true, value: T } | { ok: false, issue: MasIssue };

export type ActivationOutcome =
  | { applied: true, activeVersion: string }
  | { applied: false, conflict: MasIssue };

export type BeginOutcome =
  | { kind: 'started', attempt: MasNodeAttempt }
  | { kind: 'completed', attempt: MasNodeAttempt, messages: MasMessage[] }
  | { kind: 'uncertain', attempt: MasNodeAttempt, issue: MasIssue }
  | { kind: 'refused', issue: MasIssue };

// -- plans -------------------------------------------------------------------

export interface CreateRunPlan {
  runId: string;
  workflowId: string;
  workflowVersionId: string;
  registryRevision: string;
  executableRevision: string;
  configRegistryRevision: string | null;
  profile: string;
  input: unknown;
  limits: Record<string, number>;
}

export interface BeginAttemptPlan {
  runId: string;
  /** The semantic idempotency key `<run>/<region>/<branch>/<iteration>/<node>`. */
  idempotencyKey: string;
  path: string;
  invocationId: string;
  kind: MasNodeAttempt['kind'];
  /** The claim epoch the worker holds; a stale claim refuses TMAS2005. */
  claimSeq: number;
}

export interface CompletionMessagePlan {
  edgeId: string;
  from: { path: string, port: string };
  to: { path: string, port: string };
  adapter: string;
  aggregation: MasMessage['aggregation'];
  index: number;
  payload: unknown;
}

export interface CommitCompletionPlan {
  /** Cumulative active run time from the shared account, atomically checkpointed. */
  activeMs?: number;
  runId: string;
  attemptId: string;
  claimSeq: number;
  output: unknown;
  messages: CompletionMessagePlan[];
  /** The next state value per touched namespace, or null when state is untouched. */
  state: { namespace: string, value: unknown, members: string[] } | null;
  spend: BudgetSpend;
  usage: UsageCounts;
  stopReason: string | null;
  transcript: BoundedView;
  toolSteps: ToolStep[];
  contextReads: ContextRead[];
  artifacts: Array<{ kind: MasTraceArtifact['kind'], state: MasTraceArtifact['state'], size: number, bytes: string | null }>;
  restored: boolean;
}

export interface FailAttemptPlan {
  activeMs?: number;
  runId: string;
  attemptId: string;
  claimSeq: number;
  status: 'failed' | 'aborted' | 'uncertain';
  error: RuntimeError;
  /** Actual incurred work retained atomically even when the node fails. */
  receipt?: Pick<CommitCompletionPlan, 'spend' | 'usage' | 'stopReason' | 'transcript' | 'toolSteps' | 'contextReads'>;
}

export interface TraceView {
  run: MasRun;
  attempts: MasNodeAttempt[];
  messages: MasMessage[];
  stateRevisions: MasStateRevision[];
  interactions: MasInteraction[];
  artifacts: MasTraceArtifact[];
}

// -- the store ---------------------------------------------------------------

export interface MasStore {
  // immutable versions
  putWorkflowVersion(workflow: MasWorkflow): Promise<StoreOutcome<{ versionId: string }>>;
  getWorkflowVersion(versionId: string): Promise<MasWorkflow | undefined>;
  putRegistrySnapshot(document: Record<string, unknown>, revision: string): Promise<StoreOutcome<{ revision: string }>>;
  getRegistrySnapshot(revision: string): Promise<Record<string, unknown> | undefined>;
  putTemplateVersion(template: Record<string, unknown>, versionId: string, templateId: string): Promise<StoreOutcome<{ versionId: string }>>;
  getTemplateVersion(versionId: string): Promise<Record<string, unknown> | undefined>;

  // activation — compare-and-swap heads
  activateWorkflow(workflowId: string, nextVersion: string, expectedActiveVersion: string | null): Promise<ActivationOutcome>;
  getActiveWorkflow(workflowId: string): Promise<{ workflowId: string, activeVersion: string | null } | undefined>;
  activateTemplate(templateId: string, nextVersion: string, expectedActiveVersion: string | null): Promise<ActivationOutcome>;

  // runs
  createRun(plan: CreateRunPlan): Promise<StoreOutcome<MasRun>>;
  getRun(runId: string): Promise<MasRun | undefined>;
  /** Claim (or reclaim) the run's current segment for one worker epoch. */
  claimRunSegment(runId: string, owner: string): Promise<StoreOutcome<MasRun>>;
  transitionRun(runId: string, command: import('./runtime-state.ts').RunCommand): Promise<StoreOutcome<MasRun>>;
  /** Persist control FSM snapshots/host context under the run, atomically. */
  putRunFsm(runId: string, controlId: string, snapshot: unknown): Promise<StoreOutcome<MasRun>>;

  // semantic node lifecycle
  beginNodeAttempt(plan: BeginAttemptPlan): Promise<BeginOutcome>;
  commitNodeCompletion(plan: CommitCompletionPlan): Promise<StoreOutcome<{ attempt: MasNodeAttempt, messages: MasMessage[], stateRevision: MasStateRevision | null }>>;
  failNodeAttempt(plan: FailAttemptPlan): Promise<StoreOutcome<MasNodeAttempt>>;

  // interactions (typed wait/resume arrives with the control order; the
  // store contract is fixed here so persistence never invents it)
  createInteraction(plan: {
    runId: string, node: string, path: string, prompt: unknown,
    responseSchema: Record<string, unknown> | boolean, expiry: { afterMs: number, deadline: string } | null, segment: number,
  }): Promise<StoreOutcome<MasInteraction>>;
  getInteraction(id: string): Promise<MasInteraction | undefined>;
  respondInteraction(id: string, response: unknown, expectedRevision: number, responseKey: string): Promise<StoreOutcome<MasInteraction>>;
  resolveInteraction(id: string, status: 'cancelled' | 'expired', expectedRevision: number): Promise<StoreOutcome<MasInteraction>>;

  /** The latest committed state revision of one namespace, or undefined before any push. */
  latestState(runId: string, namespace: string): Promise<{ id: string, value: unknown } | undefined>;

  /** Runs whose typed response is accepted but whose resume segment is not yet queued. */
  listResumePendingRuns(): Promise<MasRun[]>;

  // trace
  readTrace(runId: string): Promise<TraceView | undefined>;
}

// -- pure completion planning ------------------------------------------------

export interface PlannedCompletion {
  attempt: MasNodeAttempt;
  messages: MasMessage[];
  stateRevision: MasStateRevision | null;
  artifacts: MasTraceArtifact[];
}

/**
 * Assemble and validate every record a completion commits, from the
 * current attempt row and the next sequence base. Pure: the adapter
 * supplies current state and applies the outcome in one transaction.
 */
export function planNodeCompletion(
  current: MasNodeAttempt,
  plan: CommitCompletionPlan,
  context: {
    nextSeq: number,
    now: string,
    stateParent: string | null,
  },
): { ok: true, value: PlannedCompletion } | { ok: false, issue: MasIssue } {
  if (current.status !== 'running') {
    return { ok: false, issue: masIssue('TMAS2003', '/status', `only a running attempt completes; '${current.id}' is '${current.status}'`) };
  }
  let seq = context.nextSeq;
  const attempt: MasNodeAttempt = {
    ...current,
    status: 'completed',
    output: plan.output,
    error: null,
    usage: plan.usage,
    spend: plan.spend,
    stopReason: plan.stopReason,
    transcript: plan.transcript,
    toolSteps: plan.toolSteps,
    contextReads: plan.contextReads,
    restored: plan.restored,
    finishedAt: context.now,
  };
  const attemptOutcome = validateRuntimeRecord('masNodeAttempt', attempt);
  if (!attemptOutcome.valid) {
    return { ok: false, issue: masIssue('TMAS2004', `/attempt${attemptOutcome.issues[0]?.path ?? ''}`, `the terminal attempt does not validate: ${attemptOutcome.issues[0]?.detail ?? ''}`) };
  }

  const messages: MasMessage[] = [];
  for (const [index, planned] of plan.messages.entries()) {
    const message: MasMessage = {
      id: messageIdAt(plan.runId, seq),
      runId: plan.runId,
      seq,
      edgeId: planned.edgeId,
      from: planned.from,
      to: planned.to,
      adapter: planned.adapter,
      aggregation: planned.aggregation,
      index: planned.index,
      payload: planned.payload,
      payloadState: 'retained',
      artifact: null,
      at: context.now,
    };
    seq += 1;
    const outcome = validateRuntimeRecord('masMessage', message);
    if (!outcome.valid) {
      return { ok: false, issue: masIssue('TMAS2004', `/messages/${index}${outcome.issues[0]?.path ?? ''}`, `an outbound message does not validate: ${outcome.issues[0]?.detail ?? ''}`) };
    }
    messages.push(message);
  }

  let stateRevision: MasStateRevision | null = null;
  if (plan.state !== null) {
    stateRevision = {
      id: stateIdAt(plan.runId, seq),
      runId: plan.runId,
      seq,
      namespace: plan.state.namespace,
      parent: context.stateParent,
      value: plan.state.value,
      provenance: { path: current.path, members: plan.state.members },
      at: context.now,
    };
    seq += 1;
    const outcome = validateRuntimeRecord('masStateRevision', stateRevision);
    if (!outcome.valid) {
      return { ok: false, issue: masIssue('TMAS2004', `/state${outcome.issues[0]?.path ?? ''}`, `the state revision does not validate: ${outcome.issues[0]?.detail ?? ''}`) };
    }
  }

  const artifacts: MasTraceArtifact[] = [];
  for (const [index, planned] of plan.artifacts.entries()) {
    const artifact: MasTraceArtifact = {
      id: artifactIdAt(plan.runId, seq),
      runId: plan.runId,
      kind: planned.kind,
      state: planned.state,
      size: planned.size,
      bytes: planned.bytes,
      at: context.now,
    };
    seq += 1;
    const outcome = validateRuntimeRecord('masTraceArtifact', artifact);
    if (!outcome.valid) {
      return { ok: false, issue: masIssue('TMAS2004', `/artifacts/${index}`, `a trace artifact does not validate: ${outcome.issues[0]?.detail ?? ''}`) };
    }
    artifacts.push(artifact);
  }

  return { ok: true, value: { attempt, messages, stateRevision, artifacts } };
}

const pad6 = (value: number): string => String(value).padStart(6, '0');
const messageIdAt = (runId: string, seq: number): string => `${runId}:m:${pad6(seq)}`;
const stateIdAt = (runId: string, seq: number): string => `${runId}:s:${pad6(seq)}`;
const artifactIdAt = (runId: string, seq: number): string => `${runId}:t:${pad6(seq)}`;
