/**
 * Topology projection: derived from the canonical/lowered documents
 * through the suite's JSLT stylesheets and Mermaid renderer,
 * deterministic for one executable revision, moving when topology
 * moves, with nested graphs exposed as expandable metadata.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createMasConfigCatalog,
  createMasRegistrySnapshot,
  planMasWorkflow,
  projectMasPlan,
  validateMasWorkflow,
} from '@tangleai/mas';

const manifest = JSON.parse(await readFile('benchmark/fixtures/mas/manifest.json', 'utf8')) as { registry: { path: string }, configCatalog: { path: string } };
const snapshotOutcome = await createMasRegistrySnapshot(JSON.parse(await readFile(manifest.registry.path, 'utf8')));
const catalogOutcome = await createMasConfigCatalog(JSON.parse(await readFile(manifest.configCatalog.path, 'utf8')));
assert.ok(snapshotOutcome.valid && catalogOutcome.valid);
const snapshot = snapshotOutcome.value;
const catalog = catalogOutcome.value;

async function planOf(path: string) {
  const { workflow } = JSON.parse(await readFile(path, 'utf8')) as { workflow: Record<string, unknown> };
  const validated = await validateMasWorkflow(workflow, snapshot, catalog);
  assert.ok(validated.valid);
  const plan = await planMasWorkflow(validated.value);
  assert.ok(plan.valid);
  return plan.value;
}

describe('the plan projection', () => {
  it('is deterministic for one executable revision and moves when topology moves', async () => {
    const sequential = await planOf('benchmark/fixtures/mas/positive/sequential.json');
    const first = projectMasPlan(sequential);
    const second = projectMasPlan(sequential);
    assert.deepEqual(first, second, 'one revision, one projection');
    assert.equal(first.executableRevision, sequential.executableRevision);

    const fanout = await planOf('benchmark/fixtures/mas/positive/fanout-fanin.json');
    assert.notEqual(
      JSON.stringify(projectMasPlan(fanout).regions),
      JSON.stringify(first.regions),
      'a different topology projects different text',
    );
  });

  it('projects dag regions as flowcharts and control machines as state diagrams', async () => {
    const switchPlan = await planOf('benchmark/fixtures/mas/positive/switch-one.json');
    const projection = projectMasPlan(switchPlan);
    const machine = projection.regions.find((region) => region.kind === 'fsm-switch');
    assert.ok(machine !== undefined && machine.mermaid.startsWith('stateDiagram'), 'the switch machine is a state diagram');
    assert.ok(machine.mermaid.includes('run-high') && machine.mermaid.includes('run-low'), 'branch states are visible');
    const branch = projection.regions.find((region) => region.regionId.includes('branch:high'));
    assert.ok(branch !== undefined && branch.mermaid.startsWith('flowchart'), 'branch regions are flowcharts');
  });

  it('exposes nested graphs as expandable metadata into their child plans', async () => {
    const nested = await planOf('benchmark/fixtures/mas/positive/nested-state.json');
    const projection = projectMasPlan(nested);
    const dag = projection.regions.find((region) => region.kind === 'dag');
    assert.ok(dag !== undefined);
    assert.deepEqual(dag.expandable.map((entry) => entry.subgraph), ['child-state-body']);
    assert.equal(dag.expandable[0].childExecutableRevision, projection.subplans['child-state-body'].executableRevision);
    assert.ok(projection.subplans['child-state-body'].regions[0].mermaid.startsWith('flowchart'), 'the child plan projects its own inner nodes');
  });
});
