import { it } from 'node:test';
import assert from 'node:assert/strict';
import { COPIED, inputs, parse, select } from '../scripts/gate.ts';

it('an assistant source change reaches the assistant tests and none of the long reproductions', () => {
  const { full, tests } = select(['components/assistant/src/view.ts']);
  assert.equal(full, false);
  for (const test of ['test/assistant/view.test.ts', 'test/assistant/import-graph.test.ts']) assert.ok(tests.includes(test), test);
  for (const test of ['test/benchmark/trading.test.ts', 'test/benchmark/research.test.ts', 'test/benchmark/priha.test.ts', 'test/trading/recovery.test.ts']) assert.ok(!tests.includes(test), test);
});

it('a change to an input of every test, or to a path no test claims, selects the whole suite and names the path', () => {
  for (const [path, reason] of [['package-lock.json', 'an input of every test'], ['vendor/jarenjs', 'an input of every test'], ['nowhere/unclaimed.txt', 'claimed by no test']]) {
    const { full, reasons } = select([path]);
    assert.equal(full, true, path);
    assert.ok(reasons.includes(`${path}: ${reason}`), reasons.join('\n'));
  }
});

it('the runner’s order record and editor state select nothing', () => {
  assert.deepEqual(select(['scripts/test-durations.json', '.vscode/settings.json']), {
    full: false, tests: [], reasons: ['scripts/test-durations.json: read by no test', '.vscode/settings.json: read by no test'],
  });
});

it('a test reaches its imports, the manifests they resolve through and the paths its closure names', () => {
  const reached = inputs('test/assistant/census.test.ts');
  for (const path of ['components/assistant/src/view.ts', 'components/assistant/package.json', 'test/fixtures/assistant-visible-en.json']) assert.ok(reached.has(path), path);
});

it('the tests the packed-consumer stage copies are the ones the gate also runs under Bun', () => {
  assert.deepEqual(COPIED, ['test/assistant/component.test.ts', 'test/assistant/view.test.ts', 'test/jaren/editor-adapters.test.ts', 'test/store/native-foundation.test.ts', 'test/store/physical-migration.test.ts']);
});

it('the arguments take a base, a dry run and paths in any order, and refuse anything else', () => {
  assert.deepEqual(parse(['components/assistant/src/view.ts']), { base: 'HEAD', print: false, paths: ['components/assistant/src/view.ts'] });
  assert.deepEqual(parse(['--print', 'a.ts', '--base', 'origin/main', 'b.ts']), { base: 'origin/main', print: true, paths: ['a.ts', 'b.ts'] });
  for (const args of [['--bogus'], ['--base'], ['--base', '--print']]) assert.throws(() => parse(args), /Use node scripts\/gate\.ts/, args.join(' '));
});
