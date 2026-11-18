import assert from 'node:assert/strict';
import { it } from 'node:test';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { createMemoryResearchStore, planProjectCreate, researchValue } from '@tangleai/research';
import { createStagedArtifactRefiner } from '../../packages/research/src/refiner.ts';
import { project, attempt, manifest } from './fixtures.ts';

async function fixture(onRead?: () => Promise<void>, bounds: { maxPatchBytes?: number; maxArtifactBytes?: number } = {}) {
  const store = createMemoryResearchStore(), owner = project(); researchValue(await store.createProject(researchValue(planProjectCreate(owner))));
  const producing = await attempt(manifest()), original = { decision: 'approve', approvedManifestHash: 'a'.repeat(64), note: 'Original note.', actor: 'scripted' };
  const source = researchValue(await store.stageArtifact(new TextEncoder().encode(canonicalizeJson(original)), { projectId: owner.id,
    attempt: { projectId: owner.id, stage: producing.stage, attemptOrdinal: producing.attemptOrdinal, inputManifestHash: producing.inputManifestHash },
    mediaType: 'application/json', verification: 'pending', parents: [{ artifactId: owner.id, admissionId: null }] }));
  const editor = createStagedArtifactRefiner({ store: { ...store, async readArtifact(...args) { await onRead?.(); return store.readArtifact(...args); } }, projectId: owner.id, source: { artifactId: source.artifact.id, admissionId: source.id },
    attempt: { projectId: owner.id, stage: producing.stage, attemptOrdinal: producing.attemptOrdinal + 1, inputManifestHash: producing.inputManifestHash },
    schema: 'ResearchGateResponse', allowedPaths: ['/note'], ...bounds });
  return { store, owner, original, source, editor };
}
it('a guarded artifact edit creates a pending child, preserves old bytes and replays without another admission', async () => {
  const f = await fixture(), patch = [{ op: 'replace', path: '/note', value: 'Reviewed correction.' }];
  const before = researchValue(await f.store.snapshot(f.owner.id));
  const preview = researchValue(await f.editor.preview(patch)); assert.equal((preview.candidate as { note: string }).note, 'Reviewed correction.');
  assert.deepEqual(researchValue(await f.store.snapshot(f.owner.id)), before);
  const changed = researchValue(await f.editor.commit(patch));
  assert.notEqual(changed.artifact.id, f.source.artifact.id); assert.equal(changed.artifact.verification, 'pending');
  assert.deepEqual(changed.artifact.parentIds, [f.source.artifact.id]);
  assert.equal(new TextDecoder().decode(researchValue(await f.store.readArtifact(f.owner.id, f.source.id)).bytes), canonicalizeJson(f.original));
  const after = researchValue(await f.store.snapshot(f.owner.id)); assert.deepEqual(researchValue(await f.editor.commit(patch)), changed);
  assert.deepEqual(researchValue(await f.store.snapshot(f.owner.id)), after); assert.deepEqual(after!.committedAdmissionIds, []);
});
it('preview captures the proposed patch before asynchronous reads and classifies non-JSON proposals as invalid input', async () => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; }), f = await fixture(() => blocked);
  const patch = [{ op: 'replace', path: '/note', value: 'Captured correction.' }];
  const pending = f.editor.preview(patch); patch[0].value = 'Mutated during artifact read.'; release();
  assert.equal((researchValue(await pending).candidate as { note: string }).note, 'Captured correction.');
  const before = researchValue(await f.store.snapshot(f.owner.id));
  for (const input of [undefined, [{ op: 'replace', path: '/note', value: NaN }], [{ op: 'replace', path: '/note', value: () => 1 }]]) {
    for (const call of [f.editor.preview, f.editor.commit]) {
      const result = await call(input); assert.equal(result.valid, false);
      if (!result.valid) assert.equal(result.issues[0].code, 'TRSH1001');
    }
  }
  assert.deepEqual(researchValue(await f.store.snapshot(f.owner.id)), before);
});
it('the editor refuses foreign reads, pointer escapes and schema-invalid candidates without writing', async () => {
  const f = await fixture(), before = researchValue(await f.store.snapshot(f.owner.id));
  for (const patch of [
    [{ op: 'replace', path: '/approvedManifestHash', value: 'b'.repeat(64) }],
    [{ op: 'copy', from: '/approvedManifestHash', path: '/note' }],
    [{ op: 'replace', path: '/note', value: 42 }],
    [{ op: 'replace', path: '', value: f.original }],
    [{ op: 'add', path: '/note/__proto__', value: {} }],
    [{ op: 'replace', path: '/noteworthy', value: 'prefix escape' }],
  ]) {
    const result = await f.editor.commit(patch); assert.equal(result.valid, false, JSON.stringify(patch));
    assert.deepEqual(researchValue(await f.store.snapshot(f.owner.id)), before);
  }
});
it('the patch and artifact budgets count canonical UTF-8 bytes exactly, at the budget and one over', async () => {
  const bytes = (value: unknown) => new TextEncoder().encode(canonicalizeJson(value)).length;
  const patch = (note: string) => [{ op: 'replace', path: '/note', value: note }];
  const issue = (result: { valid: boolean; issues?: Array<{ code: string; path: string }> }) => result.valid ? null : [result.issues![0].code, result.issues![0].path];
  const note = 'é'.repeat(300) + '\u{1F600}'.repeat(20);
  const patched = await fixture(undefined, { maxPatchBytes: bytes(patch(note)) });
  assert.equal((await patched.editor.preview(patch(note))).valid, true, 'a patch of exactly its budget is admitted');
  assert.deepEqual(issue(await patched.editor.preview(patch(note + 'a'))), ['TRSH1006', '/patch']);
  const probe = await fixture(), candidate = { ...probe.original, note };
  const edited = await fixture(undefined, { maxArtifactBytes: bytes(candidate) });
  assert.equal((await edited.editor.preview(patch(note))).valid, true, 'an artifact of exactly its budget is admitted');
  assert.deepEqual(issue(await edited.editor.preview(patch(note + 'a'))), ['TRSH1006', '/candidate']);
  // the measured value is canonical text, always a string: a lone surrogate or a value that is not JSON is refused before it is measured
  for (const value of ['\uD800', 42]) {
    const refused = await patched.editor.preview(patch(value as string));
    assert.equal(refused.valid, false); assert.notEqual(refused.valid || refused.issues[0].code, 'TRSH1006');
    assert.doesNotMatch(JSON.stringify(refused), /utf8ByteLength/);
  }
});
