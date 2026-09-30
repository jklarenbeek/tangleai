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
  buildEvolveLifecycle, EVOLVE_WORKFLOW_ID, EVOLVE_ENVELOPE_SCHEMA,
} from '@tangleai/evolve/lifecycle';
import { evolveRegistryDocument, EVOLVE_HANDLERS, EVOLVE_EFFECT_STAGES } from '@tangleai/evolve/lifecycle';

const EXPERIMENT_MS = 600000;

async function authored() {
  const registry = await createMasRegistrySnapshot(await evolveRegistryDocument());
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
    const { workflow, registry } = await authored();
    const nodes = [...workflow.nodes, ...[...registry.subgraphs.values()].flatMap(one => one.nodes)];
    const byId = new Map(nodes.map(node => [node.id, node]));

    for (const stage of EVOLVE_EFFECT_STAGES) {
      const dispatch = byId.get(stage);
      const wait = byId.get('await-' + stage);
      const fold = byId.get('read-' + stage);
      assert.ok(dispatch && wait && fold, `${stage} has all three of its nodes`);
      assert.equal(dispatch.kind, 'task');
      assert.equal((dispatch as { effect?: string }).effect, 'effectful',
        `${stage} dispatches an effect`);
      assert.equal(wait.kind, 'interaction', `${stage} waits rather than running`);
      assert.equal((fold as { effect?: string }).effect, 'effectful',
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
        assert.ok(node.id === 'record' || node.id === 'read-fitness' || (EVOLVE_EFFECT_STAGES as readonly string[]).includes(node.id),
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

  it('keeps every wait inside a graph and every branch free of interactions', async () => {
    const { workflow, registry } = await authored();
    assert.equal(workflow.nodes.filter(node => node.kind === 'interaction').length, 0);
    const validated = await validateMasWorkflow(workflow, registry, (await authored()).catalog);
    assert.ok(validated.valid);
    for (const stage of EVOLVE_EFFECT_STAGES) {
      const route = workflow.nodes.find(node => node.id === stage + '-route');
      assert.ok(route?.kind === 'switch');
      const graph = workflow.nodes.find(node => node.id === 'effect-' + stage);
      assert.ok(graph?.kind === 'graph');
      const child = validated.value.subgraphs.get(graph.subgraph);
      assert.ok(child);
      assert.deepEqual(child.workflow.nodes.filter(node => node.kind === 'interaction').map(node => node.id), ['await-' + stage]);
    }
    for (const route of workflow.nodes.filter(node => node.kind === 'switch')) {
      for (const branch of route.branches) {
        for (const id of branch.nodes) assert.notEqual(workflow.nodes.find(node => node.id === id)?.kind, 'interaction');
      }
    }
    assert.ok(!workflow.nodes.some(node => node.id.includes('settle') || node.id.includes('seal')));
  });

  it('declares an envelope schema the first envelope actually validates against', async () => {
    // The members an experiment has not reached yet are `null`, not absent.
    // A schema that named them `string` and `object` refused the very
    // envelope every run is created with — and refused it at `propose`, in
    // the first segment, where nothing had happened yet to explain it.
    const properties = EVOLVE_ENVELOPE_SCHEMA.properties as Record<string, { type: unknown }>;
    for (const member of ['decision', 'gate', 'rerun', 'fitness']) {
      assert.ok(Array.isArray(properties[member].type) && (properties[member].type as string[]).includes('null'),
        `${member} is null until the stage that sets it runs, and the schema has to say so`);
    }
  });

});
