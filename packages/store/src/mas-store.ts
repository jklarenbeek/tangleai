/**
 * The MAS store adapter — one transaction per semantic commit.
 *
 * Implements `@tangleai/mas`'s `MasStore` over the Jaren database:
 * immutable content-addressed puts (a same-byte put changes nothing, a
 * mutated value under a stale address refuses `TMAS2001`), workflow and
 * template activation as compare-and-swap head rows, run records with a
 * worker claim epoch (`TMAS2005` for a zombie's stale commit), and node
 * completion as ONE transaction writing the terminal attempt, outbound
 * messages, next state revision, budget snapshot and artifact rows —
 * all or nothing, exactly D6. Every record validates against the
 * generated runtime contracts before it is written; persistence never
 * invents a shape. Semantic idempotency: `beginNodeAttempt` returns the
 * stored completion for a key it has already committed and refuses an
 * uncertain attempt rather than repeating external work.
 */

import { equalsJson } from '@jarenjs/core/object';
import { JarenValidator } from '@jarenjs/validate';
import {
  masIssue,
  masWorkflowVersionIdOf,
  planInteractionTransition,
  planNodeCompletion,
  planRunTransition,
  validateRuntimeRecord,
  validateWorkflowShape,
  type ActivationOutcome,
  type BeginAttemptPlan,
  type BeginOutcome,
  type CommitCompletionPlan,
  type CreateRunPlan,
  type FailAttemptPlan,
  type MasInteraction,
  type MasIssue,
  type MasMessage,
  type MasNodeAttempt,
  type MasRun,
  type MasStateRevision,
  type MasStore,
  type MasTraceArtifact,
  type MasWorkflow,
  type RunCommand,
  type StoreOutcome,
  type TraceView,
} from '@tangleai/mas';

import type { TransactionStore } from '@jarenjs/db';
import type { TangleDb } from './db.ts';
import { asRows } from './memory-store.ts';

export interface MasStoreOptions {
  /** Injected clock; deterministic ticks under conformance. */
  now?: () => string;
  /**
   * Test-only probe invoked between the writes of one completion
   * transaction; a throwing probe proves rollback leaves nothing.
   */
  applyProbe?: (step: string) => void;
}

interface HeadRow {
  id: string;
  activeVersion: string | null;
  archived: boolean;
  revision: number;
}

/** Predicates and ordering reach the suite planner before rows cross the host boundary. */
const matching = (fields: Record<string, unknown>, order = 'id') => ({
  $for: { r: '$[*]' },
  $where: { $and: Object.entries(fields).map(([field, value]) => ({ $eq: [`$r.${field}`, { $const: value }] })) },
  $orderby: `$r.${order}`, $return: '$r',
});

/** A refusal raised after a write inside a transaction: rolls everything back, then answers as a value. */
class MasRollback extends Error {
  outcome: unknown;
  constructor(outcome: unknown) {
    super('mas transaction rollback');
    this.outcome = outcome;
  }
}

export function createMasStore(db: TangleDb, options: MasStoreOptions = {}): MasStore {
  const now = options.now ?? (() => new Date().toISOString());
  const probe = options.applyProbe ?? (() => undefined);

  const refuse = <T>(code: MasIssue['code'], path: string, detail: string): StoreOutcome<T> =>
    ({ ok: false, issue: masIssue(code, path, detail) });

  /** Run one transaction; a MasRollback aborts every write and returns its outcome. */
  async function atomically<T>(fn: (txn: TransactionStore) => Promise<T>): Promise<T> {
    try {
      return await db.transaction(fn);
    } catch (error) {
      if (error instanceof MasRollback) return error.outcome as T;
      throw error;
    }
  }

  async function putImmutable<T>(collection: string, key: string, value: unknown, keyMember: string): Promise<StoreOutcome<T>> {
    return atomically(async (txn) => {
      const handle = txn.collection<Record<string, unknown>>(collection);
      const existing = await handle.get(key);
      if (existing !== undefined) {
        if (!equalsJson(existing, value)) {
          return refuse<T>('TMAS2001', `/${keyMember}`, `'${key.slice(0, 12)}…' is immutable; a different value cannot reuse its address`);
        }
        return { ok: true, value: { [keyMember]: key } as T };
      }
      await handle.put(value as Record<string, unknown>);
      return { ok: true, value: { [keyMember]: key } as T };
    });
  }

  async function activateHead(collection: string, id: string, nextVersion: string, expectedActiveVersion: string | null, versionsCollection: string): Promise<ActivationOutcome> {
    return atomically(async (txn) => {
      const version = await txn.collection<Record<string, unknown>>(versionsCollection).get(nextVersion);
      if (version === undefined) {
        return { applied: false as const, conflict: masIssue('TMAS2001', '/activeVersion', `'${nextVersion.slice(0, 12)}…' names no stored immutable version`) };
      }
      const heads = txn.collection<HeadRow>(collection);
      const current = await heads.get(id);
      const active = current?.activeVersion ?? null;
      if (active !== expectedActiveVersion) {
        return {
          applied: false as const,
          conflict: masIssue('TMAS2001', '/activeVersion', `the expected active version does not hold (expected ${expectedActiveVersion === null ? 'none' : `${expectedActiveVersion.slice(0, 12)}…`}, found ${active === null ? 'none' : `${active.slice(0, 12)}…`})`),
        };
      }
      await heads.put({
        id,
        activeVersion: nextVersion,
        archived: current?.archived ?? false,
        revision: (current?.revision ?? 0) + 1,
      });
      return { applied: true as const, activeVersion: nextVersion };
    });
  }

  const runs = () => db.collection<MasRun>('mas_runs');
  const attempts = () => db.collection<MasNodeAttempt>('mas_node_attempts');

  async function readRun(txn: TransactionStore, runId: string): Promise<MasRun | undefined> {
    return txn.collection<MasRun>('mas_runs').get(runId);
  }

  async function writeRun(txn: TransactionStore, run: MasRun): Promise<StoreOutcome<MasRun>> {
    const next = { ...run, revision: run.revision + 1, updatedAt: now() };
    const outcome = validateRuntimeRecord('masRun', next);
    if (!outcome.valid) {
      return refuse('TMAS2004', `/run${outcome.issues[0]?.path ?? ''}`, `the run record does not validate: ${outcome.issues[0]?.detail ?? ''}`);
    }
    await txn.collection<MasRun>('mas_runs').put(next);
    return { ok: true, value: next };
  }

  const responseValidators = new Map<string, (value: unknown) => { valid: boolean }>();
  function responseValidator(schema: unknown, key: string): (value: unknown) => { valid: boolean } {
    let validate = responseValidators.get(key);
    if (validate === undefined) {
      const validator = new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' });
      validate = validator.compile(schema as Record<string, unknown>) as (value: unknown) => { valid: boolean };
      responseValidators.set(key, validate);
    }
    return validate;
  }

  return {
    async putWorkflowVersion(workflow: MasWorkflow) {
      const shape = validateWorkflowShape(workflow);
      if (!shape.valid) {
        return refuse('TMAS2004', shape.issues[0]?.path ?? '', `the workflow does not validate: ${shape.issues[0]?.detail ?? ''}`);
      }
      const recomputed = await masWorkflowVersionIdOf(workflow as unknown as Record<string, unknown>);
      if (recomputed !== workflow.versionId) {
        return refuse('TMAS2001', '/versionId', 'the workflow does not hash to its claimed version; a mutated document cannot be stored under a stale address');
      }
      return putImmutable('mas_workflow_versions', workflow.versionId, workflow, 'versionId');
    },

    async getWorkflowVersion(versionId) {
      const row = await db.collection<MasWorkflow>('mas_workflow_versions').get(versionId);
      return row === undefined ? undefined : structuredClone(row);
    },

    async putRegistrySnapshot(document, revision) {
      return putImmutable('mas_registry_snapshots', revision, { revision, document }, 'revision');
    },

    async getRegistrySnapshot(revision) {
      const row = await db.collection<{ revision: string, document: Record<string, unknown> }>('mas_registry_snapshots').get(revision);
      return row === undefined ? undefined : structuredClone(row.document);
    },

    async putTemplateVersion(template, versionId, templateId) {
      return putImmutable('mas_template_versions', versionId, { versionId, templateId, template }, 'versionId');
    },

    async getTemplateVersion(versionId) {
      const row = await db.collection<{ versionId: string, template: Record<string, unknown> }>('mas_template_versions').get(versionId);
      return row === undefined ? undefined : structuredClone(row.template);
    },

    activateWorkflow(workflowId, nextVersion, expectedActiveVersion) {
      return activateHead('mas_workflows', workflowId, nextVersion, expectedActiveVersion, 'mas_workflow_versions');
    },

    async getActiveWorkflow(workflowId) {
      const row = await db.collection<HeadRow>('mas_workflows').get(workflowId);
      return row === undefined ? undefined : { workflowId: row.id, activeVersion: row.activeVersion };
    },

    activateTemplate(templateId, nextVersion, expectedActiveVersion) {
      return activateHead('mas_templates', templateId, nextVersion, expectedActiveVersion, 'mas_template_versions');
    },

    async createRun(plan: CreateRunPlan) {
      return atomically(async (txn) => {
        const existing = await readRun(txn, plan.runId);
        if (existing !== undefined) {
          return refuse<MasRun>('TMAS2001', '/id', `run '${plan.runId}' already exists`);
        }
        const tick = now();
        const run: MasRun = {
          id: plan.runId,
          workflowId: plan.workflowId,
          workflowVersionId: plan.workflowVersionId,
          registryRevision: plan.registryRevision,
          executableRevision: plan.executableRevision,
          configRegistryRevision: plan.configRegistryRevision,
          profile: plan.profile,
          status: 'queued',
          revision: 0,
          segment: 0,
          claim: { owner: null, seq: 0 },
          traceSeq: 0,
          jobId: null,
          input: plan.input,
          output: null,
          failure: null,
          fsm: {},
          budget: { limits: plan.limits, spent: { turns: 0, tokens: 0, ms: 0 } },
          createdAt: tick,
          updatedAt: tick,
        };
        const outcome = validateRuntimeRecord('masRun', run);
        if (!outcome.valid) {
          return refuse<MasRun>('TMAS2004', `/run${outcome.issues[0]?.path ?? ''}`, `the run record does not validate: ${outcome.issues[0]?.detail ?? ''}`);
        }
        await txn.collection<MasRun>('mas_runs').put(run);
        return { ok: true as const, value: run };
      });
    },

    async getRun(runId) {
      const row = await runs().get(runId);
      return row === undefined ? undefined : structuredClone(row);
    },

    async claimRunSegment(runId, owner) {
      return atomically(async (txn) => {
        const run = await readRun(txn, runId);
        if (run === undefined) return refuse<MasRun>('TMAS2002', '/id', `run '${runId}' does not exist`);
        let status = run.status;
        if (status === 'queued') {
          const transition = planRunTransition(status, { kind: 'start' });
          if (!transition.ok) return { ok: false as const, issue: transition.issue };
          status = transition.status;
        } else if (status !== 'running') {
          return refuse<MasRun>('TMAS2003', '/status', `a segment cannot be claimed while the run is '${status}'`);
        }
        return writeRun(txn, {
          ...run,
          status,
          claim: { owner, seq: run.claim.seq + 1 },
        });
      });
    },

    async transitionRun(runId, command: RunCommand) {
      return atomically(async (txn) => {
        const run = await readRun(txn, runId);
        if (run === undefined) return refuse<MasRun>('TMAS2002', '/id', `run '${runId}' does not exist`);
        const transition = planRunTransition(run.status, command);
        if (!transition.ok) return { ok: false as const, issue: transition.issue };
        const next: MasRun = { ...run, status: transition.status };
        if (command.kind === 'complete') next.output = command.output;
        if (command.kind === 'fail') next.failure = command.failure;
        if (command.kind === 'queue-segment') next.segment = run.segment + 1;
        return writeRun(txn, next);
      });
    },

    async putRunFsm(runId, controlId, snapshot) {
      return atomically(async (txn) => {
        const run = await readRun(txn, runId);
        if (run === undefined) return refuse<MasRun>('TMAS2002', '/id', `run '${runId}' does not exist`);
        return writeRun(txn, { ...run, fsm: { ...run.fsm, [controlId]: snapshot } });
      });
    },

    async beginNodeAttempt(plan: BeginAttemptPlan): Promise<BeginOutcome> {
      return atomically(async (txn) => {
        const run = await readRun(txn, plan.runId);
        if (run === undefined) {
          return { kind: 'refused' as const, issue: masIssue('TMAS2002', '/id', `run '${plan.runId}' does not exist`) };
        }
        if (plan.claimSeq !== run.claim.seq) {
          return { kind: 'refused' as const, issue: masIssue('TMAS2005', '/claim', `the claim epoch moved (held ${plan.claimSeq}, current ${run.claim.seq}); the lease was lost`) };
        }
        const handle = txn.collection<MasNodeAttempt>('mas_node_attempts');
        const rows = asRows(await handle.execute<MasNodeAttempt>(matching({ runId: plan.runId, idempotencyKey: plan.idempotencyKey })));
        const latest = rows.at(-1);
        if (latest !== undefined && latest.status === 'completed') {
          const messages = asRows(await txn.collection<MasMessage>('mas_messages').execute<MasMessage>(matching({ runId: plan.runId, 'from.path': latest.path }, 'seq')));
          return { kind: 'completed' as const, attempt: structuredClone(latest), messages: structuredClone(messages) };
        }
        if (latest !== undefined && latest.status === 'uncertain') {
          return {
            kind: 'uncertain' as const,
            attempt: structuredClone(latest),
            issue: masIssue('TMAS2006', '/status', `'${plan.idempotencyKey}' has an external success with no durable outcome; automatic repetition is refused until operator resolution`),
          };
        }
        if (latest !== undefined && latest.status === 'running') {
          // A previous incarnation crashed after beginning; its claim epoch is
          // gone, so the stale row is closed as aborted before a new attempt.
          await handle.put({ ...latest, status: 'aborted', finishedAt: now() });
        }
        const seq = run.traceSeq + 1;
        const attempt: MasNodeAttempt = {
          id: `${plan.runId}:a:${String(seq).padStart(6, '0')}`,
          runId: plan.runId,
          seq,
          path: plan.path,
          invocationId: plan.invocationId,
          kind: plan.kind,
          attempt: (latest?.attempt ?? 0) + 1,
          status: 'running',
          idempotencyKey: plan.idempotencyKey,
          output: null,
          error: null,
          usage: { calls: 0, toolCalls: 0, contextReads: 0, promptTokens: 0, completionTokens: 0 },
          spend: { turns: 0, tokens: 0, ms: 0 },
          stopReason: null,
          transcript: { state: 'not-run', text: null, size: 0, artifact: null },
          toolSteps: [],
          contextReads: [],
          restored: false,
          startedAt: now(),
          finishedAt: null,
        };
        const outcome = validateRuntimeRecord('masNodeAttempt', attempt);
        if (!outcome.valid) {
          throw new MasRollback({ kind: 'refused' as const, issue: masIssue('TMAS2004', `/attempt${outcome.issues[0]?.path ?? ''}`, outcome.issues[0]?.detail ?? 'the attempt does not validate') });
        }
        await handle.put(attempt);
        const written = await writeRun(txn, { ...run, traceSeq: seq });
        if (!written.ok) throw new MasRollback({ kind: 'refused' as const, issue: written.issue });
        return { kind: 'started' as const, attempt: structuredClone(attempt) };
      });
    },

    async commitNodeCompletion(plan: CommitCompletionPlan) {
      return atomically(async (txn) => {
        const run = await readRun(txn, plan.runId);
        if (run === undefined) return refuse<never>('TMAS2002', '/id', `run '${plan.runId}' does not exist`);
        if (plan.claimSeq !== run.claim.seq) {
          return refuse<never>('TMAS2005', '/claim', `the claim epoch moved (held ${plan.claimSeq}, current ${run.claim.seq}); a lost lease cannot commit a completion`);
        }
        const handle = txn.collection<MasNodeAttempt>('mas_node_attempts');
        const current = await handle.get(plan.attemptId);
        if (current === undefined) return refuse<never>('TMAS2003', '/attemptId', `attempt '${plan.attemptId}' does not exist`);
        if (current.status === 'completed') {
          if (equalsJson(current.output, plan.output)) {
            const messages = asRows(await txn.collection<MasMessage>('mas_messages').execute<MasMessage>(matching({ runId: plan.runId, 'from.path': current.path }, 'seq')));
            return { ok: true as const, value: { attempt: structuredClone(current), messages: structuredClone(messages), stateRevision: null } };
          }
          return refuse<never>('TMAS2001', '/output', 'a different payload cannot re-commit under an already committed idempotency key');
        }
        const stateRows = plan.state === null ? [] : asRows(await txn.collection<MasStateRevision>('mas_state_revisions').execute<MasStateRevision>(matching({ runId: plan.runId, namespace: plan.state.namespace }, 'seq')));
        const planned = planNodeCompletion(current, plan, {
          nextSeq: run.traceSeq + 1,
          now: now(),
          stateParent: stateRows.at(-1)?.id ?? null,
        });
        if (!planned.ok) return { ok: false as const, issue: planned.issue };

        probe('attempt');
        await handle.put(planned.value.attempt);
        probe('messages');
        for (const message of planned.value.messages) {
          await txn.collection<MasMessage>('mas_messages').put(message);
        }
        probe('state');
        if (planned.value.stateRevision !== null) {
          await txn.collection<MasStateRevision>('mas_state_revisions').put(planned.value.stateRevision);
        }
        probe('artifacts');
        for (const artifact of planned.value.artifacts) {
          await txn.collection<MasTraceArtifact>('mas_trace_artifacts').put(artifact);
        }
        probe('budget');
        const spent = run.budget.spent;
        const written = await writeRun(txn, {
          ...run,
          traceSeq: run.traceSeq + planned.value.messages.length + (planned.value.stateRevision === null ? 0 : 1) + planned.value.artifacts.length,
          budget: {
            limits: run.budget.limits,
            spent: {
              turns: spent.turns + plan.spend.turns,
              tokens: spent.tokens + plan.spend.tokens,
              ms: spent.ms + plan.spend.ms,
            },
          },
        });
        if (!written.ok) throw new MasRollback({ ok: false as const, issue: written.issue });
        return {
          ok: true as const,
          value: {
            attempt: structuredClone(planned.value.attempt),
            messages: structuredClone(planned.value.messages),
            stateRevision: planned.value.stateRevision === null ? null : structuredClone(planned.value.stateRevision),
          },
        };
      });
    },

    async failNodeAttempt(plan: FailAttemptPlan) {
      return atomically(async (txn) => {
        const run = await readRun(txn, plan.runId);
        if (run === undefined) return refuse<MasNodeAttempt>('TMAS2002', '/id', `run '${plan.runId}' does not exist`);
        if (plan.claimSeq !== run.claim.seq) {
          return refuse<MasNodeAttempt>('TMAS2005', '/claim', 'the claim epoch moved; a lost lease cannot fail an attempt');
        }
        const handle = txn.collection<MasNodeAttempt>('mas_node_attempts');
        const current = await handle.get(plan.attemptId);
        if (current === undefined) return refuse<MasNodeAttempt>('TMAS2003', '/attemptId', `attempt '${plan.attemptId}' does not exist`);
        if (current.status !== 'running') {
          return refuse<MasNodeAttempt>('TMAS2003', '/status', `only a running attempt can move to '${plan.status}'; '${plan.attemptId}' is '${current.status}'`);
        }
        const next: MasNodeAttempt = { ...current, status: plan.status, error: plan.error, finishedAt: now() };
        const outcome = validateRuntimeRecord('masNodeAttempt', next);
        if (!outcome.valid) {
          return refuse<MasNodeAttempt>('TMAS2004', `/attempt${outcome.issues[0]?.path ?? ''}`, outcome.issues[0]?.detail ?? '');
        }
        await handle.put(next);
        return { ok: true as const, value: structuredClone(next) };
      });
    },

    async createInteraction(plan) {
      return atomically(async (txn) => {
        const run = await readRun(txn, plan.runId);
        if (run === undefined) return refuse<MasInteraction>('TMAS2002', '/id', `run '${plan.runId}' does not exist`);
        const id = `${plan.runId}:i:${plan.node}`;
        const handle = txn.collection<MasInteraction>('mas_interactions');
        const existing = await handle.get(id);
        if (existing !== undefined) return { ok: true as const, value: structuredClone(existing) };
        const interaction: MasInteraction = {
          id,
          runId: plan.runId,
          node: plan.node,
          path: plan.path,
          status: 'waiting',
          revision: 0,
          prompt: plan.prompt,
          responseSchema: plan.responseSchema,
          expiry: plan.expiry,
          response: null,
          responseKey: null,
          segment: plan.segment,
          resumeSegment: null,
          requestedAt: now(),
          resolvedAt: null,
        };
        const outcome = validateRuntimeRecord('masInteraction', interaction);
        if (!outcome.valid) {
          return refuse<MasInteraction>('TMAS2004', `/interaction${outcome.issues[0]?.path ?? ''}`, outcome.issues[0]?.detail ?? '');
        }
        await handle.put(interaction);
        return { ok: true as const, value: structuredClone(interaction) };
      });
    },

    async getInteraction(id) {
      const row = await db.collection<MasInteraction>('mas_interactions').get(id);
      return row === undefined ? undefined : structuredClone(row);
    },

    async respondInteraction(id, response, expectedRevision, responseKey) {
      return atomically(async (txn) => {
        const handle = txn.collection<MasInteraction>('mas_interactions');
        const current = await handle.get(id);
        if (current === undefined) return refuse<MasInteraction>('TMAS2007', '/id', `interaction '${id}' does not exist`);
        if (current.status === 'responded' && current.responseKey === responseKey) {
          return { ok: true as const, value: structuredClone(current) };
        }
        const transition = planInteractionTransition(current.status as 'waiting', 'responded');
        if (!transition.ok) return { ok: false as const, issue: transition.issue };
        if (current.revision !== expectedRevision) {
          return refuse<MasInteraction>('TMAS2007', '/revision', `the interaction moved (expected revision ${expectedRevision}, found ${current.revision}); a conflicting second response is refused`);
        }
        if (current.expiry !== null && now() > current.expiry.deadline) {
          const expired: MasInteraction = { ...current, status: 'expired', revision: current.revision + 1, resolvedAt: now() };
          await handle.put(expired);
          return refuse<MasInteraction>('TMAS2007', '/expiry', 'the interaction expired before the response arrived');
        }
        const validate = responseValidator(current.responseSchema, id);
        if (!validate(response).valid) {
          return refuse<MasInteraction>('TMAS2007', '/response', 'the response does not validate against the stored response schema');
        }
        const run = await readRun(txn, current.runId);
        if (run === undefined) return refuse<MasInteraction>('TMAS2002', '/runId', `run '${current.runId}' does not exist`);
        const runTransition = planRunTransition(run.status, { kind: 'resume-pending' });
        if (!runTransition.ok) return { ok: false as const, issue: runTransition.issue };
        const next: MasInteraction = {
          ...current,
          status: 'responded',
          revision: current.revision + 1,
          response,
          responseKey,
          resumeSegment: run.segment + 1,
          resolvedAt: now(),
        };
        const outcome = validateRuntimeRecord('masInteraction', next);
        if (!outcome.valid) {
          return refuse<MasInteraction>('TMAS2004', `/interaction${outcome.issues[0]?.path ?? ''}`, outcome.issues[0]?.detail ?? '');
        }
        await handle.put(next);
        const written = await writeRun(txn, { ...run, status: runTransition.status });
        if (!written.ok) throw new MasRollback({ ok: false as const, issue: written.issue });
        return { ok: true as const, value: structuredClone(next) };
      });
    },

    async resolveInteraction(id, status, expectedRevision) {
      return atomically(async (txn) => {
        const handle = txn.collection<MasInteraction>('mas_interactions');
        const current = await handle.get(id);
        if (current === undefined) return refuse<MasInteraction>('TMAS2007', '/id', `interaction '${id}' does not exist`);
        const transition = planInteractionTransition(current.status as 'waiting', status);
        if (!transition.ok) return { ok: false as const, issue: transition.issue };
        if (current.revision !== expectedRevision) {
          return refuse<MasInteraction>('TMAS2007', '/revision', 'the interaction moved under this resolution');
        }
        const next: MasInteraction = { ...current, status, revision: current.revision + 1, resolvedAt: now() };
        await handle.put(next);
        return { ok: true as const, value: structuredClone(next) };
      });
    },

    async listResumePendingRuns() {
      const rows = asRows(await db.collection<MasRun>('mas_runs').execute<MasRun>(matching({ status: 'resume_pending' })));
      return rows.map((row) => structuredClone(row));
    },

    async latestState(runId, namespace) {
      const rows = asRows(await db.collection<MasStateRevision>('mas_state_revisions').execute<MasStateRevision>(matching({ runId, namespace })));
      const latest = rows.at(-1);
      return latest === undefined ? undefined : { id: latest.id, value: structuredClone(latest.value) };
    },

    async readTrace(runId) {
      const run = await runs().get(runId);
      if (run === undefined) return undefined;
      const view: TraceView = {
        run: structuredClone(run),
        attempts: asRows(await attempts().execute<MasNodeAttempt>(matching({ runId }))).map((row) => structuredClone(row)),
        messages: asRows(await db.collection<MasMessage>('mas_messages').execute<MasMessage>(matching({ runId }))).map((row) => structuredClone(row)),
        stateRevisions: asRows(await db.collection<MasStateRevision>('mas_state_revisions').execute<MasStateRevision>(matching({ runId }))).map((row) => structuredClone(row)),
        interactions: asRows(await db.collection<MasInteraction>('mas_interactions').execute<MasInteraction>(matching({ runId }))).map((row) => structuredClone(row)),
        artifacts: asRows(await db.collection<MasTraceArtifact>('mas_trace_artifacts').execute<MasTraceArtifact>(matching({ runId }))).map((row) => structuredClone(row)),
      };
      return view;
    },
  };
}
