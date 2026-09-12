/* eslint-disable no-console */
/**
 * The public consumer smoke — only documented package entry points.
 *
 * Proves the runtime is consumable exactly as a downstream campaign
 * would consume it: import `@tangleai/mas` and `@tangleai/store` (no
 * `/src`, test helper or attic path), author a small Tangle-authored
 * collaboration workflow imperatively, validate it against a registry
 * snapshot and CONFIG catalog, lower it, store and activate it, run it
 * through the public durable host over a temporary SQLite FILE with the
 * suite job worker, pause on a typed interaction, respond and resume
 * through the outbox reconciler, read the complete public trace, and
 * project the topology through the public Mermaid helper. Exits 0 only
 * when every step held. `--live` opts into the configured model and writes
 * a credential-free JSON result; the default stays scripted and keyless.
 */

import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatClient } from '@tangleai/models/client';
import jaren from '@jarenjs/flow/package.json' with { type: 'json' };
import { readAiEnv } from '../benchmark/lib/ai-env.ts';
import { parseArgs } from '../benchmark/lib/args.ts';

import {
  agentInvocation,
  createMasConfigCatalog,
  createMasRegistrySnapshot,
  compileMasRuntime,
  defineMasWorkflow,
  interactionIdOf,
  interactionInvocation,
  masMessage,
  masRevisionOf,
  planMasWorkflow,
  projectMasPlan,
  taskInvocation,
  validateMasWorkflow,
  type JsonSchema,
  type MasChatCompletion,
} from '@tangleai/mas';
import {
  createMasSegmentWorker,
  createMasStore,
  enqueueMasSegment,
  ensurePendingMasSegments,
  openTangleDb,
} from '@tangleai/store';

const STR: JsonSchema = { type: 'string' };
const args = parseArgs(process.argv.slice(2), { flags: ['live'], values: [] });
const env = args.flags.has('live') ? readAiEnv() : null;
if (env !== null && !env.live) throw new Error(env.reason ?? 'The live smoke requires a configured provider');
const liveClient = env === null ? null : createChatClient({
  provider: env.provider, model: env.model, baseUrl: env.baseUrl ?? undefined,
  apiKey: env.apiKey ?? undefined,
});
let calls = 0;
let drafted = '';
const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: 'object', required: Object.keys(properties), properties, additionalProperties: false,
});

// -- a Tangle-authored collaboration: drafter agent -> reviewer pause -> apply
const instructions = 'Draft one paragraph from the brief and answer with only the paragraph.';
const registryDocument = {
  $masRegistry: '0.1',
  registryId: 'consumer-smoke',
  roles: [{ id: 'drafter', title: 'drafter', instructions, instructionsRevision: await masRevisionOf(instructions), capabilities: [] }],
  handlers: [{ id: 'apply', title: 'apply the decision', effect: 'pure', idempotency: 'not-required' }],
  tools: [],
  messageAdapters: [
    { id: 'json-schema', version: '0.1' },
    { id: 'markdown-sections', version: '0.1' },
    { id: 'plain', version: '0.1' },
  ],
  contextAdapters: [],
  templates: [],
  subgraphs: [],
};
const snapshotOutcome = await createMasRegistrySnapshot(registryDocument);
assert.ok(snapshotOutcome.valid, 'the registry snapshot validates');
const snapshot = snapshotOutcome.value;
const catalogOutcome = await createMasConfigCatalog({ profiles: ['default'], tools: [], contexts: [] });
assert.ok(catalogOutcome.valid);
const catalog = catalogOutcome.value;

const decision = obj({ verdict: STR });
const workflow = await defineMasWorkflow({
  workflowId: 'consumer-collab',
  title: 'Consumer collaboration smoke',
  description: 'One drafting agent, one typed review pause, one applying task — the smallest composed collaboration.',
  author: 'consumer-smoke',
  input: obj({ brief: STR }),
  output: obj({ outcome: decision }),
  entry: [{ port: 'brief', to: { node: 'drafter', port: 'brief' } }],
  exit: [{ port: 'outcome', from: { node: 'apply', port: 'out' } }],
  nodes: [
    agentInvocation({
      id: 'drafter', role: 'drafter', profile: 'default',
      instructionsRevision: snapshot.document.roles[0].instructionsRevision,
      messageAdapter: 'plain',
      input: { brief: STR }, output: { draft: STR },
    }),
    interactionInvocation({
      id: 'review',
      input: { draft: STR }, output: { decision },
      prompt: STR, response: decision,
    }),
    taskInvocation({
      id: 'apply', handler: 'apply',
      input: { decision }, output: { out: decision },
    }),
  ],
  messages: [
    masMessage(['drafter', 'draft'], ['review', 'draft'], { adapter: 'plain' }),
    masMessage(['review', 'decision'], ['apply', 'decision']),
  ],
  registryRevision: snapshot.revision,
  configRegistryRevision: catalog.revision,
  profile: 'default',
});

const validated = await validateMasWorkflow(workflow, snapshot, catalog);
assert.ok(validated.valid, `the composed workflow validates: ${JSON.stringify(!validated.valid ? validated.issues[0] : null)}`);
const plan = await planMasWorkflow(validated.value);
assert.ok(plan.valid, 'the workflow lowers to a complete plan');

// -- the public durable host over a temporary SQLite file
const path = join(await mkdtemp(join(tmpdir(), 'mas-consumer-')), 'consumer.db');
const clock = { value: 1_000_000 };
const db = await openTangleDb({ path, jobs: { now: () => clock.value, random: () => 0.5 } });
let worker: ReturnType<typeof createMasSegmentWorker> | undefined;
try {
  let tick = 0;
  const store = createMasStore(db, { now: () => `tick-${String(tick++).padStart(4, '0')}` });
  assert.ok((await store.putWorkflowVersion(validated.value.workflow)).ok, 'the immutable version stores');
  const activation = await store.activateWorkflow(workflow.workflowId, workflow.versionId, null);
  assert.ok(activation.applied, 'activation applies by compare-and-swap');

  const created = await store.createRun({
    runId: 'consumer-run',
    workflowId: workflow.workflowId,
    workflowVersionId: workflow.versionId,
    registryRevision: snapshot.revision,
    executableRevision: plan.value.executableRevision,
    configRegistryRevision: catalog.revision,
    profile: 'default',
    input: { brief: 'Launch plan: finish staging checks Monday, then release Tuesday. Summarize this plan.' },
    limits: { calls: 8 },
  });
  assert.ok(created.ok);

  const runtime = compileMasRuntime(validated.value, plan.value, snapshot, {
    store,
    taskHandlers: { apply: async ({ value }) => ({ out: (value as { decision: unknown }).decision }) },
    toolBindings: {},
    contextProviders: {},
    clientFor: () => ({
      endpoint: { provider: env?.provider ?? 'scripted' },
      complete: async (request): Promise<MasChatCompletion> => {
        calls += 1;
        assert.ok(calls <= Math.min(8, env?.maxCalls ?? 8), 'the smoke stays within its call ceiling');
        const result: MasChatCompletion = liveClient === null ? {
          message: { content: 'The launch plan in one paragraph.' },
          finishReason: 'stop',
          usage: { prompt_tokens: 5, completion_tokens: 7 },
        } : await liveClient.complete({ ...(request as object), signal: AbortSignal.timeout(60_000) });
        drafted = String(result.message?.content ?? '');
        assert.ok(drafted.trim().length > 0, 'the drafting agent returns content');
        return result;
      },
    }),
    now: () => `tick-${String(tick++).padStart(4, '0')}`,
    clock: () => clock.value,
    deadlineFor: () => 'tick-9999',
  });
  assert.ok(runtime.valid, 'the host bindings compile');

  const segments: Array<{ resolve: () => void, promise: Promise<void> }> = [];
  const segmentDone = (): { resolve: () => void, promise: Promise<void> } => {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => { resolve = res; });
    const entry = { resolve, promise };
    segments.push(entry);
    return entry;
  };
  const first = segmentDone();
  const second = segmentDone();
  let completedSegments = 0;
  worker = createMasSegmentWorker(db, store, {
    executableRevisions: [plan.value.executableRevision],
    execute: async (segment) => {
      await runtime.value.executeSegment(segment);
      segments[completedSegments].resolve();
      completedSegments += 1;
    },
    concurrency: 1,
    pollInterval: 5,
    owner: 'consumer-worker',
  });
  worker.start();

  await enqueueMasSegment(db, {
    runId: 'consumer-run', segment: 0,
    workflowVersionId: workflow.versionId,
    registryRevision: snapshot.revision,
    executableRevision: plan.value.executableRevision,
  });
  await first.promise;

  const waiting = await store.getRun('consumer-run');
  assert.equal(waiting?.status, 'waiting_for_input', 'the run pauses durably; no worker holds it');
  const interactionId = interactionIdOf('consumer-run', 'review');
  const interaction = await store.getInteraction(interactionId);
  assert.equal(interaction?.prompt, drafted, 'the typed prompt is the actual drafted content');

  const responded = await store.respondInteraction(interactionId, { verdict: 'approved' }, interaction?.revision ?? 0, 'consumer-key');
  assert.ok(responded.ok, 'one typed response is accepted');
  const reconciled = await ensurePendingMasSegments(db, store);
  assert.equal(reconciled.enqueued, 1, 'the outbox reconciler enqueues the reserved resume segment');
  await second.promise;

  const run = await store.getRun('consumer-run');
  assert.equal(run?.status, 'completed');
  assert.deepEqual(run?.output, { outcome: { verdict: 'approved' } }, 'the typed response reached the workflow output');

  const trace = await store.readTrace('consumer-run');
  assert.ok(trace !== undefined);
  assert.deepEqual(
    trace.attempts.filter((attempt) => attempt.status === 'completed').map((attempt) => attempt.invocationId).sort(),
    ['apply', 'drafter', 'review'],
    'the public trace carries every completed attempt',
  );
  assert.equal(trace.messages.length >= 2, true, 'ordered messages are readable');

  const projection = projectMasPlan(plan.value);
  assert.ok(projection.regions.some((region) => region.mermaid.startsWith('flowchart')), 'the public Mermaid helper projects the topology');
  assert.equal(projection.executableRevision, plan.value.executableRevision);

  if (env === null) {
    console.log('mas consumer smoke: composed run, typed pause/resume, trace read and Mermaid projection all hold over the public durable host');
    console.log(`  workflow ${workflow.versionId.slice(0, 12)}…, executable ${plan.value.executableRevision.slice(0, 12)}…, spend ${JSON.stringify(run?.budget.spent)}`);
  } else {
    console.log(JSON.stringify({
      ok: true, measuredAt: new Date().toISOString(), jaren: jaren.version,
      provider: env.provider, model: env.model, calls,
      workflowVersion: workflow.versionId, executableRevision: plan.value.executableRevision,
      spent: run?.budget.spent, completedSegments, status: run?.status,
      completedInvocations: trace.attempts.filter((attempt) => attempt.status === 'completed').map((attempt) => attempt.invocationId),
      typedPauseResume: true, projectedTopology: true,
    }));
  }
} finally {
  await worker?.stop();
  await db.close();
}
