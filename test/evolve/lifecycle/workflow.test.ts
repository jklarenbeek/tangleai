/**
 * The lifecycle version, and the shape rule it exists to keep.
 *
 * The load-bearing assertion is not that the graph validates — it is that
 * every stage which reaches a process is a task PAIRED with a wait. A
 * segment handler holds no job lease, so a node that spawned would be
 * refused by the effect fence at run time rather than here; this test
 * makes the rule structural instead, where it can be read.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateMasWorkflow, planMasWorkflow, createMasRegistrySnapshot, createMasConfigCatalog,
} from '@tangleai/mas';

import {
  buildEvolveLifecycle, EVOLVE_WORKFLOW_ID,
} from '@tangleai/evolve/lifecycle';
import { evolveRegistryDocument, EVOLVE_HANDLERS, EVOLVE_EFFECT_STAGES } from '@tangleai/evolve/lifecycle';

const EXPERIMENT_MS = 600000;

async function authored() {
  const registry = await createMasRegistrySnapshot(evolveRegistryDocument());
  assert.ok(registry.valid, 'the handler registry is a valid registry document');
  const catalog = await createMasConfigCatalog({ profiles: ['evolve'], tools: [], contexts: [] });
  assert.ok(catalog.valid);
  const workflow = await buildEvolveLifecycle({
    experimentMs: EXPERIMENT_MS,
    registryRevision: registry.value.revision,
    configRegistryRevision: catalog.value.revision,
    profile: 'evolve',
  });
  return { registry: registry.value, catalog: catalog.value, workflow };
}

describe('the experiment lifecycle version', () => {
  it('validates and lowers against its own handler registry', async () => {
    const { registry, catalog, workflow } = await authored();
    const validated = await validateMasWorkflow(workflow, registry, catalog);
    assert.ok(validated.valid, validated.valid ? '' : JSON.stringify(validated.issues, null, 1));
    const plan = await planMasWorkflow(validated.value);
    assert.ok(plan.valid, plan.valid ? '' : JSON.stringify(plan.issues, null, 1));
    assert.equal(workflow.workflowId, EVOLVE_WORKFLOW_ID);
  });

  it('authors the same version twice — no clock, no random source', async () => {
    const first = await authored();
    const second = await authored();
    assert.equal(first.workflow.versionId, second.workflow.versionId,
      'the version id is a function of the authored bytes alone');
    assert.notEqual(first.workflow.versionId, '0'.repeat(64), 'it was actually computed');
  });

  it('pairs every effectful stage with a wait, so no node can spawn', async () => {
    const { workflow } = await authored();
    const byId = new Map(workflow.nodes.map(node => [node.id, node]));

    for (const stage of EVOLVE_EFFECT_STAGES) {
      const dispatch = byId.get(stage);
      const wait = byId.get('await-' + stage);
      const fold = byId.get('read-' + stage);
      assert.ok(dispatch && wait && fold, `${stage} has all three of its nodes`);
      assert.equal(dispatch.kind, 'task');
      assert.equal((dispatch as { effect?: string }).effect, 'effectful',
        `${stage} dispatches an effect`);
      assert.equal(wait.kind, 'interaction', `${stage} waits rather than running`);
      assert.equal((fold as { effect?: string }).effect, 'read',
        `${stage} reads its settlement back without touching a job`);
    }
  });

  it('declares no handler that both spawns and runs inside a segment', async () => {
    const { workflow } = await authored();
    const registered = new Map(EVOLVE_HANDLERS.map(one => [one.id, one]));
    for (const node of workflow.nodes) {
      if (node.kind !== 'task') continue;
      const handler = registered.get((node as { handler: string }).handler);
      assert.ok(handler, `${node.id} names a registered handler`);
      assert.equal((node as { effect?: string }).effect, handler.effect,
        `${node.id} and its handler agree on what it may touch`);
      // The rule, stated where it can be checked: an effectful task is
      // always one of the dispatches, and a dispatch never runs the work —
      // it writes the intent and enqueues.
      if (handler.effect === 'effectful') {
        assert.ok(node.id === 'record' || (EVOLVE_EFFECT_STAGES as readonly string[]).includes(node.id),
          `${node.id} is a dispatch or the outcome record, not an ad-hoc effect`);
      }
    }
  });

  it('carries the registered ceiling as a cap, and calls no model', async () => {
    const { workflow } = await authored();
    assert.equal(workflow.limits.ms, EXPERIMENT_MS, 'the experiment ceiling is the workflow cap');
    const agents = workflow.nodes.filter(node => node.kind === 'agent');
    assert.deepEqual(agents, [], 'nothing in the lifecycle talks to a model');
  });

  it('routes the single rerun inside the flake branch that owns it', async () => {
    const { workflow } = await authored();
    const flake = workflow.nodes.find(node => node.id === 'flake');
    assert.ok(flake && flake.kind === 'switch');
    const branches = (flake as { branches: Array<{ id: string, nodes: string[], result: { node: string, port: string } }> }).branches;
    const rerun = branches.find(one => one.id === 'rerun');
    assert.ok(rerun, 'red earns exactly one rerun branch');
    // A branch OWNS its nodes and has ONE result port, so the rerun's
    // readback has to be inside the branch: only the envelope leaves.
    assert.deepEqual(rerun.nodes, ['gate-rerun', 'await-gate-rerun', 'read-gate-rerun']);
    assert.equal(rerun.result.node, 'read-gate-rerun');
    assert.equal(branches.length, 2, 'red reruns; everything else does not');
  });

  it('has no seal node, because sealing the base spawns git', async () => {
    const { workflow } = await authored();
    const ids = workflow.nodes.map(node => node.id);
    assert.ok(!ids.some(id => id.includes('seal')),
      'the base seal belongs to the worker that runs the base batch, not to a segment');
    // It still has to happen, and it still has to bracket the base batch:
    // that is the measure-base operation's job, and its settlement says
    // whether the seal held.
    assert.ok(ids.includes('measure-base') && ids.includes('read-measure-base'));
  });
});
