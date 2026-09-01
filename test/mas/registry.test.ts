/**
 * Registry snapshots are immutable validated capability data with set
 * semantics per section, plus the package import census: one canonical
 * hash path, one validator factory, and no local DAG/FSM/query/patch
 * engine or attic import anywhere under packages/mas/src.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

import { createMasRegistrySnapshot } from '@tangleai/mas';

const manifest = JSON.parse(await readFile('benchmark/fixtures/mas/manifest.json', 'utf8')) as {
  registry: { path: string, revision: string },
};
const registryDoc = JSON.parse(await readFile(manifest.registry.path, 'utf8')) as Record<string, unknown>;
const snapshotOutcome = await createMasRegistrySnapshot(registryDoc);
assert.ok(snapshotOutcome.valid);
const snapshot = snapshotOutcome.value;

describe('the registry snapshot', () => {
  it('recomputes the manifest revision and canonicalizes shuffled section order', async () => {
    assert.equal(snapshot.revision, manifest.registry.revision);
    const shuffled = structuredClone(registryDoc) as { roles: unknown[], contextAdapters: unknown[] };
    shuffled.roles.reverse();
    shuffled.contextAdapters.reverse();
    const reordered = await createMasRegistrySnapshot(shuffled);
    assert.ok(reordered.valid);
    assert.equal(reordered.value.revision, snapshot.revision, 'section order is set semantics; the canonical order is by id');
    assert.deepEqual(
      reordered.value.document.roles.map((role) => role.id),
      snapshot.document.roles.map((role) => role.id),
    );
  });

  it('refuses a tampered instructions revision (TMAS1002) and an embedded subgraph that does not recompute', async () => {
    const tampered = structuredClone(registryDoc) as { roles: Array<{ instructions: string }> };
    tampered.roles[0].instructions = 'changed instructions under a stale revision';
    const outcome = await createMasRegistrySnapshot(tampered);
    assert.ok(!outcome.valid);
    assert.equal(outcome.issues[0].code, 'TMAS1002');
    assert.match(outcome.issues[0].path, /^\/roles\/0/);

    const mutated = structuredClone(registryDoc) as { subgraphs: Array<{ workflow: { title: string } }> };
    mutated.subgraphs[0].workflow.title = 'moved child bytes';
    const child = await createMasRegistrySnapshot(mutated);
    assert.ok(!child.valid);
    assert.equal(child.issues[0].code, 'TMAS1002');
    assert.match(child.issues[0].path, /^\/subgraphs\/0/);
  });

  it('is deeply frozen — capability data, never mutable references', () => {
    assert.ok(Object.isFrozen(snapshot.document));
    assert.ok(Object.isFrozen(snapshot.document.roles[0]));
    assert.throws(() => { (snapshot.document.roles[0] as { id: string }).id = 'mutated'; });
  });
});

describe('the package import census', () => {
  it('uses the published suite and contains no local engine twin or attic import', async () => {
    const sources: string[] = [];
    for (const name of await readdir('packages/mas/src')) {
      if (name.endsWith('.ts')) sources.push(`packages/mas/src/${name}`);
    }
    let all = '';
    for (const path of sources) all += await readFile(path, 'utf8');
    for (const wanted of [
      "from '@jarenjs/flow'", "from '@jarenjs/linq/flow'", "from '@jarenjs/json/canonical'",
      "from '@jarenjs/json/query'", "from '@jarenjs/validate'", "from '@jarenjs/core/object'",
    ]) {
      assert.ok(all.includes(wanted), `the package imports ${wanted}`);
    }
    const canonicalImports = all.split("from '@jarenjs/json/canonical'").length - 1;
    assert.equal(canonicalImports, 1, 'one canonical hash path (identity.ts)');
    const validatorConstructions = all.split('new JarenValidator').length - 1;
    assert.equal(validatorConstructions, 1, 'one schema validator factory (schema.ts)');
    for (const [name, forbidden] of [
      ['an attic import', /docs\/attic/],
      ['a local scheduler', /kahn|topoSort|readyQueue/i],
      ['a clock reading', /\bDate\.now\b|\bnew Date\b/],
      ['runtime randomness', /\bMath\.random\b/],
      ['a network reach', /\bfetch\s*\(/],
      ['a local FSM stepper', /function\s+step\s*\(|stepFsm/],
      ['a hand-rolled sha', /createHash\s*\(/],
    ] as Array<[string, RegExp]>) {
      assert.equal(forbidden.test(all), false, `packages/mas/src contains ${name}`);
    }
  });

  it('declares only Tangle and JarenJS dependencies', async () => {
    const pkg = JSON.parse(await readFile('packages/mas/package.json', 'utf8')) as { dependencies: Record<string, string> };
    for (const name of Object.keys(pkg.dependencies)) {
      assert.match(name, /^@(jarenjs|tangleai)\//, `${name} is inside the boundary`);
    }
  });
});
