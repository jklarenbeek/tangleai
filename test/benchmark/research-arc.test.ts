import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stat, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deferredArcBenchRow, admitArcTopics, validateArcManifest, verifyArcLicenceBytes, arcResearchProject,
  type ArcSliceManifest } from '../../benchmark/lib/research-arc.ts';
import { loadTabularStatisticsFixture } from '../../benchmark/lib/research-tabular-fixture.ts';
import { researchBytesSha256 } from '../../benchmark/lib/research-fixture.ts';
const text = new TextEncoder().encode('Authored adapter conformance fixture; no external licence claim.');
const manifest: ArcSliceManifest = { source: 'authored-adapter-test', commit: 'a'.repeat(40),
  licence: { spdx: 'MIT', textSha256: researchBytesSha256(text), auditedBy: 'authored-test-only', auditedAt: '2026-01-01T00:00:00.000Z',
    terms: ['Synthetic test bytes only; no upstream audit.'] }, slice: { name: 'ml-core-25', topicIds: ['tabular-positive-effect'] },
  protocol: { judge: 'deterministic-contract-control', attempts: 1, selection: 'all' }, localOnly: ['fixture-test'] };
test('the deferred external row states manifest-unpinned and changes nothing on a second load', async () => {
  const first = await deferredArcBenchRow(); assert.equal(first.state, 'not-run'); assert.equal(first.reason, 'manifest-unpinned');
  assert.deepEqual(await deferredArcBenchRow(), first); assert.equal(first.modelCalls, 0); assert.equal(first.runnerInvocations, 0);
});
test('a malformed external manifest is a counted refusal value instead of a benchmark crash', async t => {
  const root = await mkdtemp(join(tmpdir(), 'arc-manifest-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'benchmark/fixtures/research/external'); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'arc-bench.manifest.json'), '{malformed');
  const result = await deferredArcBenchRow(root);
  assert.equal(result.state, 'not-run'); assert.equal(result.reason, 'manifest-unpinned');
  assert.equal(result.issues.length, 1); assert.equal(result.issues[0].code, 'TRSH2009');
  assert.equal(result.modelCalls, 0); assert.equal(result.runnerInvocations, 0);
});
test('missing upstream submodule is a stated skip, never an invented external measurement', async t => {
  let present = false;
  try { present = (await stat('benchmark/arc-bench')).isDirectory(); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
  const row = await deferredArcBenchRow(process.cwd(), manifest);
  if (!present) { assert.equal(row.reason, 'submodule-absent'); t.skip('submodule-absent'); return; }
  assert.equal(row.state, 'not-run'); assert.equal(row.runnerInvocations, 0);
});
test('unaudited manifests and substituted licence text are refused as TRSH2009', async () => {
  for (const value of [{ ...manifest, licence: { ...manifest.licence, auditedBy: '' } }, { ...manifest, licence: { spdx: 'MIT' } },
    { ...manifest, commit: 'moving-branch' }, { ...manifest, archiveSha256: 'b'.repeat(64) }]) {
    const result = validateArcManifest(value); assert.equal(result.valid, false);
    if (!result.valid) assert.equal(result.issues[0].code, 'TRSH2009');
  }
  assert.deepEqual(verifyArcLicenceBytes(manifest, text), []);
  assert.equal(verifyArcLicenceBytes(manifest, new TextEncoder().encode('substituted'))[0].code, 'TRSH2009');
});
test('schema-invalid upstream topics are counted without repair, while admitted contracts reproduce', async () => {
  const fixture = await loadTabularStatisticsFixture(), source = fixture.topics[0];
  const topic = { id: source.id, title: source.title, question: source.hypothesis.H1, taskFamily: source.taskFamily,
    contract: source.contract, plan: source.plan };
  const before = structuredClone(topic), first = await admitArcTopics(manifest, [topic]);
  assert.deepEqual(first.issues, []); assert.equal(first.topics.length, 1);
  assert.deepEqual(await admitArcTopics(manifest, [topic]), first); assert.deepEqual(topic, before);
  assert.equal(arcResearchProject(first.topics[0], 'tabular-statistics', '2026-01-01T00:00:00.000Z').id, source.contract.projectId);
  for (const invalid of [{ ...topic, unexpected: true }, { ...topic, question: 7 }, { ...topic, id: 'unknown' }]) {
    const saved = structuredClone(invalid), result = await admitArcTopics(manifest, [invalid]);
    assert.equal(result.topics.length, 0); assert.equal(result.issues.length, 1); assert.equal(result.issues[0].code, 'TRSH2009');
    assert.deepEqual(invalid, saved);
  }
});
test('external admission captures the manifest and topic batch before asynchronous hashing', async () => {
  const source = (await loadTabularStatisticsFixture()).topics[0], registration = structuredClone(manifest);
  const topic = { id: source.id, title: source.title, question: source.hypothesis.H1, taskFamily: source.taskFamily,
    contract: structuredClone(source.contract), plan: structuredClone(source.plan) };
  const pending = admitArcTopics(registration, [topic]);
  registration.protocol.attempts = 2; topic.question = 'replacement';
  const result = await pending;
  assert.deepEqual(result.issues, []); assert.equal(result.topics[0].question, source.hypothesis.H1);
});
