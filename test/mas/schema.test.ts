/**
 * The MAS schema family is the closed runtime truth: it accepts exactly
 * the intended six-kind union, refuses unknown members, kinds and
 * secret-shaped values as TMAS1001 at the exact pointer, and the
 * runtime record shapes exist for persistence to consume rather than
 * invent.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  validateWorkflowShape,
  validateRegistryShape,
  validateRuntimeRecord,
} from '@tangleai/mas';

const manifest = JSON.parse(await readFile('benchmark/fixtures/mas/manifest.json', 'utf8')) as {
  registry: { path: string },
  positive: Array<{ id: string, path: string }>,
  negative: Array<{ id: string, path: string }>,
};
const sequential = JSON.parse(await readFile('benchmark/fixtures/mas/positive/sequential.json', 'utf8')) as { workflow: Record<string, unknown> };

describe('the workflow schema', () => {
  it('accepts every registered fixture workflow shape', async () => {
    for (const entry of [...manifest.positive, ...manifest.negative]) {
      const fixture = JSON.parse(await readFile(entry.path, 'utf8')) as { workflow: unknown };
      const outcome = validateWorkflowShape(fixture.workflow);
      assert.equal(outcome.valid, true, `${entry.id}: ${outcome.valid ? '' : JSON.stringify(outcome.issues[0])}`);
    }
  });

  it('refuses an unknown member as TMAS1001 at the exact pointer', () => {
    const stray = structuredClone(sequential.workflow);
    (stray as { stray?: boolean }).stray = true;
    const outcome = validateWorkflowShape(stray);
    assert.equal(outcome.valid, false);
    assert.ok(!outcome.valid && outcome.issues.some((issue) => issue.code === 'TMAS1001' && issue.path === '/stray'
      && issue.detail.includes("'stray'")));
  });

  it('refuses a secret-shaped member: a credential has no representable member', () => {
    const leaky = structuredClone(sequential.workflow) as { nodes: Array<Record<string, unknown>> };
    leaky.nodes[0].apiKey = 'sk-x';
    const outcome = validateWorkflowShape(leaky);
    assert.equal(outcome.valid, false);
    assert.ok(!outcome.valid && outcome.issues.some((issue) => issue.code === 'TMAS1001' && issue.path === '/nodes/0/apiKey'
      && issue.detail.includes("'apiKey'")));
  });

  it('refuses an unknown node kind — the union is closed', () => {
    const alien = structuredClone(sequential.workflow) as { nodes: Array<Record<string, unknown>> };
    alien.nodes[0].kind = 'daemon';
    assert.equal(validateWorkflowShape(alien).valid, false);
  });

  it('refuses a null select through the decidable oneOf, and accepts a query document', () => {
    const withSelect = structuredClone(sequential.workflow) as { messages: Array<{ select: unknown }> };
    withSelect.messages[0].select = '$.value';
    assert.equal(validateWorkflowShape(withSelect).valid, true, 'a path select is accepted');
  });
});

describe('the registry schema', () => {
  it('accepts the fixture registry and refuses a secret member', async () => {
    const registry = JSON.parse(await readFile(manifest.registry.path, 'utf8')) as Record<string, unknown>;
    assert.equal(validateRegistryShape(registry).valid, true);
    const leaky = structuredClone(registry) as { roles: Array<Record<string, unknown>> };
    leaky.roles[0].token = 'secret';
    const outcome = validateRegistryShape(leaky);
    assert.equal(outcome.valid, false);
    assert.ok(!outcome.valid && outcome.issues.some((issue) => issue.path === '/roles/0/token'));
  });

  it('refuses duplicate section ids through $query', async () => {
    const registry = JSON.parse(await readFile(manifest.registry.path, 'utf8')) as { handlers: unknown[] };
    const doubled = structuredClone(registry);
    doubled.handlers.push(structuredClone(doubled.handlers[0]));
    assert.equal(validateRegistryShape(doubled).valid, false);
  });
});

describe('the runtime record shapes', () => {
  it('validates a run record and refuses an invented member', () => {
    const run = {
      id: 'run-1',
      workflowId: 'wf-sequential',
      workflowVersionId: 'a'.repeat(64),
      registryRevision: 'b'.repeat(64),
      executableRevision: 'c'.repeat(64),
      configRegistryRevision: null,
      profile: 'scripted',
      status: 'running',
      revision: 0,
      segment: 0,
      claim: { owner: null, seq: 0 },
      traceSeq: 0,
      jobId: null,
      input: { text: 'hello' },
      output: null,
      failure: null,
      fsm: {},
      budget: { limits: {}, spent: { turns: 0, tokens: 0, ms: 0 } },
      createdAt: 'tick-1',
      updatedAt: 'tick-1',
    };
    assert.equal(validateRuntimeRecord('masRun', run).valid, true);
    assert.equal(validateRuntimeRecord('masRun', { ...run, secretKey: 'x' }).valid, false, 'persistence cannot invent a member');
    assert.equal(validateRuntimeRecord('masRun', { ...run, status: 'daydreaming' }).valid, false, 'the status vocabulary is closed');
  });

  it('validates an attempt with explicit bounded-view absence states', () => {
    const attempt = {
      id: 'run-1:a:000001',
      runId: 'run-1',
      seq: 1,
      path: 'first',
      invocationId: 'first',
      kind: 'task',
      attempt: 1,
      status: 'completed',
      idempotencyKey: 'run-1/dag0//1/first',
      output: { value: 'hello' },
      error: null,
      usage: { calls: 0, toolCalls: 0, contextReads: 0, promptTokens: 0, completionTokens: 0 },
      spend: { turns: 0, tokens: 0, ms: 0 },
      stopReason: null,
      transcript: { state: 'not-configured', text: null, size: 0, artifact: null },
      toolSteps: [],
      contextReads: [],
      restored: false,
      startedAt: 'tick-1',
      finishedAt: 'tick-2',
    };
    assert.equal(validateRuntimeRecord('masNodeAttempt', attempt).valid, true);
    const vague = structuredClone(attempt) as Record<string, unknown>;
    (vague.transcript as { state: string }).state = 'missing';
    assert.equal(validateRuntimeRecord('masNodeAttempt', vague).valid, false, 'an absence must be one of the declared states');
  });
});
