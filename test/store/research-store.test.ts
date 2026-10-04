import { it } from 'node:test';
import assert from 'node:assert/strict';
import { runRuntimeFixture } from '../../scripts/runtime-fixture.ts';

for (const runtime of [process.execPath, 'bun']) it(`${runtime === 'bun' ? 'Bun' : 'Node'} SQLite passes research lifecycle parity and rollback at every transaction boundary`, async () => {
  const result = await runRuntimeFixture(runtime, runtime === 'bun' ? ['test', './test/store/research-driver.fixture.ts']
    : ['--test', '--test-reporter=tap', 'test/store/research-driver.fixture.ts'], { env: { NODE_TEST_CONTEXT: undefined } });
  assert.match(result.stdout + result.stderr, runtime === 'bun' ? /14 pass/ : /# pass 14/);
});
