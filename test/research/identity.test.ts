import assert from 'node:assert/strict';
import { it } from 'node:test';
import { researchArtifactIdOf, researchRevisionOf, inputManifestHashOf } from '@tangleai/research';

it('research artifacts address exact bytes and snapshot a sliced input before hashing', async () => {
  const bytes = new TextEncoder().encode('abc');
  const expected = 'art-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  assert.equal(await researchArtifactIdOf(bytes), expected);
  assert.equal(await researchArtifactIdOf(bytes.slice()), expected);
  const storage = new Uint8Array([0, 97, 98, 99, 0]);
  const pending = researchArtifactIdOf(storage.subarray(1, 4));
  storage.fill(0);
  assert.equal(await pending, expected);
  assert.notEqual(await researchArtifactIdOf(new TextEncoder().encode('abd')), expected);
});

it('research revisions are canonical and input manifests use the same identity owner', async () => {
  assert.equal(await researchRevisionOf({ x: 1, y: [2, 3] }), await researchRevisionOf({ y: [2, 3], x: 1 }));
  const manifest = {
    projectId: 'identity-project', stage: 'DISCOVERY' as const, inputs: [],
    promptRevision: 'a'.repeat(64), runIdentityId: 'b'.repeat(64), toolVersions: [],
    evaluator: { id: 'fixture', version: '1' }, reservation: { calls: 0, tokens: 0, ms: 0, physical: 0 },
  };
  assert.equal(await inputManifestHashOf(manifest), await researchRevisionOf(manifest));
  assert.notEqual(await inputManifestHashOf({ ...manifest, promptRevision: 'c'.repeat(64) }), await inputManifestHashOf(manifest));
});
