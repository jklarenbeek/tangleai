/**
 * @file `examples/vector-recall.ts`, executed: an example is a promise that a
 * reader can run it and get the printed answer, so this runs it against the
 * real packages and asserts the values its `// →` comments quote — derived
 * from the run, never typed only here — so a printed figure and a real answer
 * cannot drift apart in either direction.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import util from 'node:util';

import { runVectorRecallExample } from '../../examples/vector-recall.ts';

const SOURCE = fs.readFileSync(new URL('../../examples/vector-recall.ts', import.meta.url), 'utf8');
const prints = (value: unknown) => SOURCE.includes(`→ ${util.inspect(value)}`);

describe('the vector example runs, and answers what it says it answers', () => {
  let ran: Awaited<ReturnType<typeof runVectorRecallExample>>;

  it('executes as one program', async () => {
    ran = await runVectorRecallExample();
    assert.ok(ran, 'the example produced no bindings');
  });

  it('the k-nearest query answers the ids it prints, through the knn plan', () => {
    assert.deepStrictEqual(ran.ranked, ['n1', 'n2']);
    assert.strictEqual(ran.mode, 'knn');
    assert.ok(prints(ran.ranked), `the example no longer prints ${util.inspect(ran.ranked)} for the k-nearest answer`);
    assert.ok(prints(ran.mode), `the example no longer prints ${util.inspect(ran.mode)} for the plan mode`);
  });

  it('the ranked recall answers the memories, scores and skip count it prints', () => {
    const recalled = ran.recalled;
    if ('error' in recalled) assert.fail(`the recall refused: ${recalled.error}`);
    const evidence = recalled.memories.map((m: any) => m.evidence);
    const scores = recalled.scores.map((s: number) => s.toFixed(3));
    assert.deepStrictEqual(evidence, ['n1', 'n2']);
    assert.deepStrictEqual(scores, ['0.712', '0.441']);
    assert.strictEqual(recalled.skipped, 0);
    assert.deepStrictEqual(ran.swept, { embedded: 3, remaining: 0 });
    for (const printed of [evidence, scores, ran.swept, recalled.skipped]) {
      assert.ok(prints(printed), `the example no longer prints ${util.inspect(printed)}`);
    }
  });
});
