import { it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createMemoryResearchStore, planProjectCreate } from '@tangleai/research';
import { checked, project, attempt, manifest } from './fixtures.ts';
import { researchStoreSuite, memoryHarness } from './store-harness.ts';
researchStoreSuite('memory research transactions', memoryHarness);
it('byte views from another JavaScript realm retain their exact content address', async () => {
  const store = createMemoryResearchStore(), created = checked(planProjectCreate(project()));
  assert.ok((await store.createProject(created)).ok);
  const row = await attempt(manifest()), descriptor = { projectId: row.projectId,
    attempt: { projectId: row.projectId, stage: row.stage, attemptOrdinal: row.attemptOrdinal, inputManifestHash: row.inputManifestHash },
    mediaType: 'text/plain', verification: 'verified' as const, parents: [{ artifactId: row.projectId, admissionId: null }] };
  const admitted = await store.stageArtifact(vm.runInNewContext('new Uint8Array([97, 98, 99])'), descriptor);
  assert.ok(admitted.ok, JSON.stringify(admitted));
  assert.equal(admitted.value.artifact.id, 'art-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal((await store.stageArtifact(new Uint16Array([97, 98, 99]) as never, descriptor)).ok, false);
});
