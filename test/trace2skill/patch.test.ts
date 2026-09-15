/**
 * The directory compiler against the committed patch pool: every registered
 * document earns the code it was authored to earn, the frozen directory is
 * byte-identical after every refusal, and no input ordering changes the
 * compilation or the withholding decision.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { applyCompiled, compilePatch, draftsOf, guidanceLeakCheck, resolveAnchor,
  type FrozenSkill, type SkillFileDraft } from '@tangleai/trace2skill';
import { fixturePatch, forbiddenTerms, operationsOf, patchOf, readFrozenSkill, readPatchDocuments } from './fixture.ts';

const frozenSkill = await readFrozenSkill();
const forbidden = await forbiddenTerms();
const documents = await readPatchDocuments();
const frozen: FrozenSkill = { bundle: frozenSkill.bundle, files: draftsOf(frozenSkill.files) };
const bytesOf = (files: readonly SkillFileDraft[]) => files.map(file => `${file.path} ${file.content}`).join('');
const OVERLAPPING = ['overlap-a', 'overlap-b'];

/** The registered code, whether the refusal comes from compiling or from applying. */
function drive(patch: Parameters<typeof compilePatch>[1]) {
  const compiled = compilePatch(frozen, patch, { forbidden });
  if (!compiled.valid) return { code: compiled.issues[0].code, hunks: 0, withheld: 0 };
  const applied = applyCompiled(frozen.files, compiled.value);
  const withheld = compiled.value.withheld.length;
  if (!applied.valid) return { code: applied.issues[0].code, hunks: compiled.value.hunks.length, withheld };
  return { code: withheld ? compiled.value.issues[0].code : null, hunks: compiled.value.hunks.length, withheld };
}

it('every registered patch earns its code and leaves the frozen directory byte-identical', async () => {
  const before = bytesOf(frozen.files);
  let refused = 0, withheldDocuments = 0;
  for (const [id, document] of documents) {
    if (OVERLAPPING.includes(id)) { refused++; withheldDocuments++; continue; }
    const result = drive(await fixturePatch(document, frozen.bundle.id));
    assert.equal(result.code, document.expectedCode, `${id} expected ${document.expectedCode} and got ${result.code}`);
    if (result.code) refused++;
    assert.equal(bytesOf(frozen.files), before, `${id} moved the frozen directory`);
  }
  assert.equal(documents.size, 13);
  assert.equal(refused, 8, 'the registered refusal census');
  assert.equal(withheldDocuments, 2, 'the registered withholding census');
  assert.equal([...documents.values()].filter(document => document.withheld).length, 2);
});

it('overlapping edits to one section withhold exactly one hunk and report both sides', async () => {
  const [a, b] = await Promise.all(OVERLAPPING.map(id => fixturePatch(documents.get(id)!, frozen.bundle.id)));
  const merged = await patchOf({ baseHash: frozen.bundle.id, sourcePatchIds: OVERLAPPING, supportCount: 2,
    operations: [...a.operations, ...b.operations] });
  const compiled = compilePatch(frozen, merged, { forbidden });
  assert.ok(compiled.valid);
  assert.equal(compiled.value.hunks.length, 1);
  assert.equal(compiled.value.withheld.length, 1);
  assert.equal(compiled.value.issues[0].code, 'TT2S1004');
  assert.equal(documents.get('overlap-a')!.expectedCode, 'TT2S1004');
  const [withheld] = compiled.value.withheld;
  assert.ok(withheld.conflict, 'the report names the surviving operation');
  assert.equal(withheld.conflict.path, withheld.hunk.path);
  assert.ok(compiled.value.hunks[0].replacement.includes('A weight in kilograms converts to pounds'), 'the earlier operation in canonical order survives');
  assert.ok(withheld.hunk.replacement.includes('Report a pound weight to one decimal'));
});

it('shuffled operation order compiles to the same hunks and the same withholding decisions', async () => {
  for (const [pool, hunks, withheld] of [[['redundant-a', 'units-a'], 3, 0], [OVERLAPPING, 1, 1]] as const) {
    const operations = pool.flatMap(id => operationsOf(documents.get(id)!));
    const forward = compilePatch(frozen, await patchOf({ baseHash: frozen.bundle.id, operations }), { forbidden });
    assert.ok(forward.valid, pool.join('+'));
    assert.equal(forward.value.hunks.length, hunks);
    assert.equal(forward.value.withheld.length, withheld);
    const orderings = [...operations.keys()].map(rotation => [...operations.slice(rotation), ...operations.slice(0, rotation)]);
    orderings.push([...operations].reverse());
    for (const shuffled of orderings) {
      const again = compilePatch(frozen, await patchOf({ baseHash: frozen.bundle.id, operations: shuffled }), { forbidden });
      assert.ok(again.valid);
      assert.deepEqual(again.value.hunks, forward.value.hunks);
      assert.deepEqual(again.value.withheld.map(entry => entry.hunk.replacement), forward.value.withheld.map(entry => entry.hunk.replacement));
    }
  }
});

it('an anchor that occurs twice is refused rather than guessed at', async () => {
  const twice = compilePatch(frozen, await patchOf({ baseHash: frozen.bundle.id, operations: [
    { op: 'insert_after', path: 'SKILL.md', group: 'g', anchor: 'the header', content: '- extra' },
  ] }), { forbidden });
  assert.ok(!twice.valid);
  assert.equal(twice.issues[0].code, 'TT2S1004');
  assert.match(twice.issues[0].detail, /more than once/);
  const missing = resolveAnchor('one\ntwo\n', 'three', 'SKILL.md');
  assert.ok(!missing.valid);
  assert.equal(missing.issues[0].code, 'TT2S1004');
  const found = resolveAnchor('one\ntwo\nthree\n', 'two', 'SKILL.md');
  assert.ok(found.valid);
  assert.deepEqual(found.value, { startLine: 1, endLine: 2 });
});

it('a stale base hash refuses before any anchor is read', async () => {
  const stale = compilePatch(frozen, await fixturePatch(documents.get('stale-base')!, frozen.bundle.id), { forbidden });
  assert.ok(!stale.valid);
  assert.equal(stale.issues[0].code, 'TT2S1002');
});

it('reusable guidance carrying a task instance or its registered answer is refused', () => {
  const leak = guidanceLeakCheck('- For task-13 answer 1126.0.', forbidden);
  assert.ok(!leak.valid);
  assert.equal(leak.issues[0].code, 'TT2S1006');
  const clean = guidanceLeakCheck('- A euro amount uses a period for thousands: `14.250,00` is 14250.00.', forbidden);
  assert.ok(clean.valid, clean.valid ? '' : JSON.stringify(clean.issues));
  assert.ok(guidanceLeakCheck('1 kg = 2.20462 lb, rounded to one decimal.', forbidden).valid);
});

it('the valid pool applies to an in-memory copy and never to the frozen directory', async () => {
  const before = bytesOf(frozen.files);
  for (const id of ['redundant-a', 'redundant-b', 'redundant-c', 'units-a', 'units-b']) {
    const compiled = compilePatch(frozen, await fixturePatch(documents.get(id)!, frozen.bundle.id), { forbidden });
    assert.ok(compiled.valid, id);
    assert.equal(compiled.value.withheld.length, 0, id);
    const applied = applyCompiled(frozen.files, compiled.value);
    assert.ok(applied.valid, id);
    assert.notEqual(bytesOf(applied.value), before, `${id} changed nothing`);
  }
  assert.equal(bytesOf(frozen.files), before);
});
