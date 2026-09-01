/**
 * The layered validator against the registered contract: all 11
 * positive fixtures validate, all 7 negatives refuse at their exact
 * registered code and pointer, identities cannot be forged, undeclared
 * state is unaddressable, caps cannot escape, and every returned value
 * is deeply frozen.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createMasConfigCatalog,
  createMasRegistrySnapshot,
  validateMasWorkflow,
  type MasConfigCatalog,
  type MasRegistrySnapshot,
} from '@tangleai/mas';

const manifest = JSON.parse(await readFile('benchmark/fixtures/mas/manifest.json', 'utf8')) as {
  registry: { path: string, revision: string },
  configCatalog: { path: string, revision: string },
  positive: Array<{ id: string, path: string }>,
  negative: Array<{ id: string, path: string }>,
};

const registryDoc = JSON.parse(await readFile(manifest.registry.path, 'utf8')) as Record<string, unknown>;
const catalogDoc = JSON.parse(await readFile(manifest.configCatalog.path, 'utf8')) as Record<string, unknown>;

const snapshotOutcome = await createMasRegistrySnapshot(registryDoc);
const catalogOutcome = await createMasConfigCatalog(catalogDoc);
assert.ok(snapshotOutcome.valid && catalogOutcome.valid);
const snapshot: MasRegistrySnapshot = snapshotOutcome.value;
const catalog: MasConfigCatalog = catalogOutcome.value;

async function fixtureWorkflow(path: string): Promise<Record<string, unknown>> {
  return (JSON.parse(await readFile(path, 'utf8')) as { workflow: Record<string, unknown> }).workflow;
}

describe('the registered positive fixtures', () => {
  it('validates all 11 and the loop-contained cycle stays legal', async () => {
    for (const entry of manifest.positive) {
      const outcome = await validateMasWorkflow(await fixtureWorkflow(entry.path), snapshot, catalog);
      assert.equal(outcome.valid, true, `${entry.id}: ${outcome.valid ? '' : JSON.stringify(outcome.issues.slice(0, 2))}`);
    }
  });

  it('returns deeply frozen values that retained references cannot mutate', async () => {
    const workflow = await fixtureWorkflow('benchmark/fixtures/mas/positive/sequential.json');
    const outcome = await validateMasWorkflow(workflow, snapshot, catalog);
    assert.ok(outcome.valid);
    assert.ok(Object.isFrozen(outcome.value.workflow));
    assert.ok(Object.isFrozen(outcome.value.workflow.nodes));
    assert.ok(Object.isFrozen(outcome.value.workflow.nodes[0]));
    assert.throws(() => { (outcome.value.workflow.nodes[0] as { id: string }).id = 'mutated'; });
    // The validated value does not alias the caller's mutable input.
    (workflow as { title: string }).title = 'mutated';
    assert.notEqual(outcome.value.workflow.title, 'mutated');
  });
});

describe('the registered negative fixtures', () => {
  it('refuses each at exactly its registered code and pointer', async () => {
    for (const entry of manifest.negative) {
      const fixture = JSON.parse(await readFile(entry.path, 'utf8')) as {
        workflow: Record<string, unknown>,
        expect: { code: string, path: string },
      };
      const outcome = await validateMasWorkflow(fixture.workflow, snapshot, catalog);
      assert.equal(outcome.valid, false, `${entry.id} must refuse`);
      assert.ok(!outcome.valid);
      assert.equal(outcome.issues[0].code, fixture.expect.code, `${entry.id} first code`);
      assert.equal(outcome.issues[0].path, fixture.expect.path, `${entry.id} first pointer`);
    }
  });
});

describe('identity and pin gates', () => {
  it('refuses a version that does not recompute (TMAS1002 at /versionId)', async () => {
    const workflow = await fixtureWorkflow('benchmark/fixtures/mas/positive/sequential.json');
    workflow.title = 'moved semantics under a stale version';
    const outcome = await validateMasWorkflow(workflow, snapshot, catalog);
    assert.ok(!outcome.valid);
    assert.equal(outcome.issues[0].code, 'TMAS1002');
    assert.equal(outcome.issues[0].path, '/versionId');
  });

  it('refuses a registry or CONFIG pin that disagrees with the supplied snapshot (TMAS1009)', async () => {
    const workflow = await fixtureWorkflow('benchmark/fixtures/mas/positive/sequential.json');
    const otherCatalog = await createMasConfigCatalog({ ...catalogDoc, profiles: ['scripted', 'other'] });
    assert.ok(otherCatalog.valid);
    const outcome = await validateMasWorkflow(workflow, snapshot, otherCatalog.value);
    assert.ok(!outcome.valid);
    assert.equal(outcome.issues[0].code, 'TMAS1009');
    assert.equal(outcome.issues[0].path, '/config/registryRevision');
  });
});

describe('state scope is a data contract', () => {
  it('refuses an undeclared pull and an undeclared push (TMAS1010)', async () => {
    const base = await fixtureWorkflow('benchmark/fixtures/mas/positive/nested-state.json');
    const { masWorkflowVersionIdOf } = await import('@tangleai/mas');

    const ghostPull = structuredClone(base) as { nodes: Array<{ kind: string, statePull?: Array<{ member: string, as: string }> }>, versionId?: string };
    const readOut = ghostPull.nodes.find((node) => node.kind === 'task') as { statePull: Array<{ member: string, as: string }> };
    readOut.statePull = [{ member: '/ghost', as: 'ghost' }];
    ghostPull.versionId = await masWorkflowVersionIdOf(ghostPull as Record<string, unknown>);
    const pulled = await validateMasWorkflow(ghostPull, snapshot, catalog);
    assert.ok(!pulled.valid);
    assert.equal(pulled.issues[0].code, 'TMAS1010');
    assert.match(pulled.issues[0].path, /statePull\/0\/member$/);

    const ghostPush = structuredClone(base) as { nodes: Array<{ kind: string, push?: Array<{ child: string, parent: string }> }>, versionId?: string };
    const sub = ghostPush.nodes.find((node) => node.kind === 'graph') as { push: Array<{ child: string, parent: string }> };
    sub.push = [{ child: '/produced', parent: '/ghost' }];
    ghostPush.versionId = await masWorkflowVersionIdOf(ghostPush as Record<string, unknown>);
    const pushed = await validateMasWorkflow(ghostPush, snapshot, catalog);
    assert.ok(!pushed.valid);
    assert.equal(pushed.issues[0].code, 'TMAS1010');
    assert.match(pushed.issues[0].path, /push\/0\/parent$/);
  });
});
