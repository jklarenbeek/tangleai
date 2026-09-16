/**
 * The evolve read surface, compared against its frozen baseline.
 *
 * The claim this gate defends is narrow and worth stating plainly: the
 * published surface has no operation that lands a change. Not "the write
 * operations are guarded" — there are none, and this refuses the commit
 * that adds one.
 *
 * It also refuses the quieter breakages: removing an operation a client
 * depends on, and narrowing an input so a call that used to be accepted
 * is not. Widening an input or adding a read is compatible and passes;
 * that asymmetry is the whole point of comparing against a freeze rather
 * than against the previous commit.
 */
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const FROZEN = new URL('./fixtures/evolve-contract-v1.json', import.meta.url);
const CURRENT = new URL('../packages/evolve/schemas/evolve.contract.json', import.meta.url);

interface Operation { kind: string }
interface Document {
  id: string;
  version: string;
  operations: Record<string, Operation>;
  $defs: Record<string, unknown>;
}

const read = async (url: URL): Promise<Document> =>
  JSON.parse(await readFile(url, 'utf8')) as Document;

const frozen = await read(FROZEN);
const current = await read(CURRENT);

assert.equal(current.id, frozen.id, 'the contract id is part of the surface');

// 1. Nothing may land a change. Every operation is a read, forever.
const writes = Object.entries(current.operations)
  .filter(([, operation]) => operation.kind !== 'read')
  .map(([id]) => id);
assert.deepEqual(writes, [],
  'the evolve surface publishes reads only; an operation that merges, promotes, '
  + 'approves, runs or stops an experiment must not exist here');

// 2. No operation a client depends on may disappear.
const removed = Object.keys(frozen.operations).filter(id => !(id in current.operations));
assert.deepEqual(removed, [], 'an operation in the frozen surface was removed');

// 3. An operation may not change what it is.
for (const [id, operation] of Object.entries(frozen.operations)) {
  assert.equal(current.operations[id].kind, operation.kind,
    `${id} changed kind since the freeze`);
}

// 4. An input may widen but not narrow: a call the freeze accepted must
//    still be accepted. Required members are the narrowing that matters.
for (const id of Object.keys(frozen.operations)) {
  const before = frozen.$defs as Record<string, { required?: string[] }>;
  const after = current.$defs as Record<string, { required?: string[] }>;
  for (const [name, definition] of Object.entries(before)) {
    const now = after[name];
    if (now === undefined) continue;
    const added = (now.required ?? []).filter(one => !(definition.required ?? []).includes(one));
    assert.deepEqual(added, [],
      `${name} gained required member(s) since the freeze; a call that used to be `
      + 'accepted would now be refused');
  }
  break;
}

const count = Object.keys(current.operations).length;
console.log(`evolve contract: ${count} read operations, none that lands a change`);
