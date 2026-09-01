/**
 * The partition/lower plan: complete frozen region trees for every
 * registered positive fixture, deterministic executable revisions,
 * suite-pen-authored documents that all compile, and a Jaren compile
 * refusal adapted into TMAS1011 with its exact cause retained as data.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createMasConfigCatalog,
  createMasRegistrySnapshot,
  planMasWorkflow,
  validateMasWorkflow,
  type MasWorkflowPlan,
  type ValidatedMasWorkflow,
} from '@tangleai/mas';

const manifest = JSON.parse(await readFile('benchmark/fixtures/mas/manifest.json', 'utf8')) as {
  registry: { path: string },
  configCatalog: { path: string },
  positive: Array<{ id: string, path: string }>,
};
const snapshotOutcome = await createMasRegistrySnapshot(JSON.parse(await readFile(manifest.registry.path, 'utf8')));
const catalogOutcome = await createMasConfigCatalog(JSON.parse(await readFile(manifest.configCatalog.path, 'utf8')));
assert.ok(snapshotOutcome.valid && catalogOutcome.valid);
const snapshot = snapshotOutcome.value;
const catalog = catalogOutcome.value;

async function planOf(path: string): Promise<MasWorkflowPlan> {
  const { workflow } = JSON.parse(await readFile(path, 'utf8')) as { workflow: Record<string, unknown> };
  const validated = await validateMasWorkflow(workflow, snapshot, catalog);
  assert.ok(validated.valid);
  const plan = await planMasWorkflow(validated.value);
  assert.ok(plan.valid, JSON.stringify(!plan.valid ? plan.issues[0] : null));
  return plan.value;
}

describe('every positive fixture lowers to a complete frozen plan', () => {
  it('produces region trees whose documents are pen-emitted jaren-dag/jaren-fsm', async () => {
    const kinds = new Map<string, string[]>();
    for (const entry of manifest.positive) {
      const plan = await planOf(entry.path);
      kinds.set(entry.id, plan.regions.map((region) => region.kind));
      for (const document of Object.values(plan.documents)) {
        const doc = document as { $dag?: string, $fsm?: string };
        assert.ok(doc.$dag === '0.1' || doc.$fsm === '0.1', `${entry.id}: every lowered document is a jaren flow document`);
      }
      assert.ok(Object.isFrozen(plan), `${entry.id} plan frozen`);
      assert.ok(Object.isFrozen(plan.regions), `${entry.id} regions frozen`);
    }
    assert.deepEqual(kinds.get('sequential'), ['dag']);
    assert.deepEqual(kinds.get('switch-one'), ['fsm-switch']);
    assert.deepEqual(kinds.get('loop-three'), ['fsm-loop']);
    assert.deepEqual(kinds.get('interaction'), ['dag', 'interaction-wait', 'dag']);
    assert.deepEqual(kinds.get('nested-state'), ['subgraph', 'dag']);
  });

  it('checkpoints every lowered agent/task node and never sends a cycle to compileDag', async () => {
    const plan = await planOf('benchmark/fixtures/mas/positive/weekly-report-manual.json');
    const dag = plan.documents.dag0 as { nodes: Record<string, { kind: string, checkpoint?: boolean, run?: string }> };
    const tasks = Object.values(dag.nodes).filter((node) => node.kind === 'task');
    assert.equal(tasks.length, 4);
    for (const node of tasks) {
      assert.equal(node.checkpoint, true, `${node.run} opts into the suite checkpoint`);
    }
  });

  it('is deterministic: two plans over the same validated workflow share one executable revision', async () => {
    const first = await planOf('benchmark/fixtures/mas/positive/switch-many.json');
    const second = await planOf('benchmark/fixtures/mas/positive/switch-many.json');
    assert.equal(first.executableRevision, second.executableRevision);
    const fanRegion = first.regions.find((region) => region.kind === 'fsm-switch');
    assert.ok(fanRegion !== undefined && fanRegion.kind === 'fsm-switch');
    assert.deepEqual(fanRegion.branches.map((branch) => branch.id), ['alpha', 'beta', 'gamma'], 'branch declaration order is preserved');
  });

  it('keeps loop bodies and graph children as subplans with their own executable revisions', async () => {
    const loop = await planOf('benchmark/fixtures/mas/positive/loop-three.json');
    assert.ok(loop.subplans['loop-body'] !== undefined);
    assert.match(loop.subplans['loop-body'].executableRevision, /^[0-9a-f]{64}$/);
    const nested = await planOf('benchmark/fixtures/mas/positive/nested-state.json');
    assert.ok(nested.subplans['child-state-body'] !== undefined);
    const subgraphRegion = nested.regions.find((region) => region.kind === 'subgraph');
    assert.ok(subgraphRegion !== undefined && subgraphRegion.kind === 'subgraph');
    assert.equal(subgraphRegion.childExecutableRevision, nested.subplans['child-state-body'].executableRevision);
  });
});

describe('a broken lowered document is TMAS1011 with its Jaren cause retained', () => {
  it('adapts the suite compile refusal as data', async () => {
    // Bypass validation deliberately: a task invocation with no input port
    // lowers to a consumer with no inbound edge, which compileDag refuses
    // as JF0015 — the adapter must surface that exact cause.
    const broken = {
      workflow: {
        nodes: [{
          id: 'orphan',
          kind: 'task',
          input: { ports: {} },
          output: { ports: { out: { schema: { type: 'string' } } } },
          statePull: [],
          statePush: [],
          limits: null,
          handler: 'scripted',
          effect: 'pure',
        }],
        control: [],
        messages: [],
        entry: [],
        exit: [],
      },
      versionId: 'f'.repeat(64),
      registryRevision: snapshot.revision,
      configCatalogRevision: catalog.revision,
      subgraphs: new Map(),
    } as unknown as ValidatedMasWorkflow;
    const plan = await planMasWorkflow(broken);
    assert.equal(plan.valid, false);
    assert.ok(!plan.valid);
    assert.equal(plan.issues[0].code, 'TMAS1011');
    assert.equal(plan.issues[0].cause?.code, 'JF0015', 'the exact Jaren cause code is data');
    assert.ok((plan.issues[0].cause?.docPath ?? '').length > 0, 'the Jaren docPath rides along');
  });
});
