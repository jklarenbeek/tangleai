/**
 * The pure runtime-state layer: identity derivations, exhaustive
 * legal/illegal lifecycle transitions and completion planning with
 * validation refusals as TMAS2xxx values.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  attemptIdOf,
  checkpointNamespaceOf,
  interactionIdOf,
  invocationPathOf,
  masJobKindOf,
  messageIdOf,
  planAttemptTransition,
  planInteractionTransition,
  planNodeCompletion,
  planRunTransition,
  segmentJobIdOf,
  semanticKeyOf,
  type MasNodeAttempt,
  type RunCommand,
} from '@tangleai/mas';

describe('identities and sequencing', () => {
  it('derives the semantic key, paths, namespaces and segment ids', () => {
    assert.equal(
      semanticKeyOf({ runId: 'r1', region: 'dag0', branch: '', iteration: 0, node: 'first' }),
      'r1/dag0//0/first',
    );
    assert.equal(invocationPathOf({ branch: '', iteration: 0, node: 'first' }), 'first');
    assert.equal(invocationPathOf({ prefix: 'refine', branch: '', iteration: 2, node: 'bump' }), 'refine/2/bump');
    assert.equal(checkpointNamespaceOf({ region: 'loop:refine', branch: '', iteration: 3 }), 'loop:refine//3');
    assert.equal(segmentJobIdOf('run-9', 1), 'run-9:0001');
    assert.equal(masJobKindOf('a'.repeat(64)), `mas:${'a'.repeat(64)}`);
    assert.equal(interactionIdOf('run-9', 'approve'), 'run-9:i:approve');
  });

  it('record ids sort by construction — the trace order is the id order', () => {
    const ids = [attemptIdOf('r', 2), messageIdOf('r', 10), attemptIdOf('r', 1), messageIdOf('r', 3)];
    const attempts = ids.filter((id) => id.includes(':a:')).sort();
    assert.deepEqual(attempts, ['r:a:000001', 'r:a:000002']);
    const messages = ids.filter((id) => id.includes(':m:')).sort();
    assert.deepEqual(messages, ['r:m:000003', 'r:m:000010']);
  });
});

describe('the run lifecycle is exhaustive', () => {
  const statuses = ['queued', 'running', 'waiting_for_input', 'resume_pending', 'completed', 'failed', 'cancelled'] as const;
  const commands: RunCommand[] = [
    { kind: 'start' },
    { kind: 'complete', output: {} },
    { kind: 'fail', failure: { node: null, error: { code: 'TMAS2003', detail: 'x', cause: null } } },
    { kind: 'wait' },
    { kind: 'resume-pending' },
    { kind: 'queue-segment' },
    { kind: 'cancel' },
  ];
  const legal = new Set([
    'queued:start', 'queued:fail', 'queued:cancel',
    'running:complete', 'running:fail', 'running:wait', 'running:cancel',
    'waiting_for_input:resume-pending', 'waiting_for_input:cancel',
    'resume_pending:queue-segment', 'resume_pending:fail', 'resume_pending:cancel',
  ]);

  it('accepts exactly the legal transitions and refuses the rest as TMAS2003', () => {
    for (const status of statuses) {
      for (const command of commands) {
        const outcome = planRunTransition(status, command);
        const key = `${status}:${command.kind}`;
        if (legal.has(key)) {
          assert.ok(outcome.ok, `${key} is legal`);
        } else {
          assert.ok(!outcome.ok, `${key} must refuse`);
          assert.equal(outcome.issue.code, 'TMAS2003');
        }
      }
    }
  });

  it('terminal attempt and interaction states accept nothing further', () => {
    assert.ok(planAttemptTransition('running', 'completed').ok);
    assert.ok(planAttemptTransition('uncertain', 'completed').ok, 'operator resolution completes an uncertain attempt');
    assert.ok(!planAttemptTransition('completed', 'running').ok);
    assert.ok(!planAttemptTransition('completed', 'failed').ok);
    assert.ok(planInteractionTransition('waiting', 'responded').ok);
    const resolved = planInteractionTransition('responded', 'cancelled');
    assert.ok(!resolved.ok);
    assert.equal(resolved.issue.code, 'TMAS2007');
  });
});

describe('completion planning', () => {
  const running: MasNodeAttempt = {
    id: 'r1:a:000001',
    runId: 'r1',
    seq: 1,
    path: 'first',
    invocationId: 'first',
    kind: 'task',
    attempt: 1,
    status: 'running',
    idempotencyKey: 'r1/dag0//0/first',
    output: null,
    error: null,
    usage: { calls: 0, toolCalls: 0, contextReads: 0, promptTokens: 0, completionTokens: 0 },
    spend: { turns: 0, tokens: 0, ms: 0 },
    stopReason: null,
    transcript: { state: 'not-run', text: null, size: 0, artifact: null },
    toolSteps: [],
    contextReads: [],
    restored: false,
    startedAt: 't1',
    finishedAt: null,
  };
  const plan = {
    runId: 'r1',
    attemptId: 'r1:a:000001',
    claimSeq: 1,
    output: { value: 'v' },
    messages: [{
      edgeId: 'first-second',
      from: { path: 'first', port: 'value' },
      to: { path: 'second', port: 'value' },
      adapter: 'json-schema',
      aggregation: 'one' as const,
      index: 0,
      payload: 'v',
    }],
    state: null,
    spend: { turns: 0, tokens: 0, ms: 0 },
    usage: { calls: 0, toolCalls: 0, contextReads: 0, promptTokens: 0, completionTokens: 0 },
    stopReason: null,
    transcript: { state: 'not-configured' as const, text: null, size: 0, artifact: null },
    toolSteps: [],
    contextReads: [],
    artifacts: [],
    restored: false,
  };

  it('assembles validated attempt/message records with derived sequenced ids', () => {
    const outcome = planNodeCompletion(running, plan, { nextSeq: 2, now: 't2', stateParent: null });
    assert.ok(outcome.ok);
    assert.equal(outcome.value.attempt.status, 'completed');
    assert.equal(outcome.value.messages[0].id, 'r1:m:000002');
    assert.equal(outcome.value.messages[0].seq, 2);
  });

  it('refuses a completion over a non-running attempt (TMAS2003) and an invalid record (TMAS2004)', () => {
    const done = { ...running, status: 'completed' as const };
    const again = planNodeCompletion(done, plan, { nextSeq: 2, now: 't2', stateParent: null });
    assert.ok(!again.ok);
    assert.equal(again.issue.code, 'TMAS2003');

    const badMessage = { ...plan, messages: [{ ...plan.messages[0], adapter: 'NOT A NAME' }] };
    const refused = planNodeCompletion(running, badMessage, { nextSeq: 2, now: 't2', stateParent: null });
    assert.ok(!refused.ok);
    assert.equal(refused.issue.code, 'TMAS2004');
    assert.match(refused.issue.path, /^\/messages\/0/);
  });
});
