import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRuntimeFixture } from '../../scripts/runtime-fixture.ts';

for (const runtime of ['node', 'bun']) {
  test(`${runtime} temporal backend leaves its reopened SQLite file in parent-owned scratch`, async () => {
    let directory = '';
    const result = await runRuntimeFixture(runtime, [fileURLToPath(new URL('../../benchmark/scripts/temporal-backend.ts', import.meta.url))], {
      async afterExit(path) { directory = path; await access(join(path, 'fixture.db')); },
    });
    assert.equal(JSON.parse(result.stdout).rows.length, 46);
    await assert.rejects(access(directory), { code: 'ENOENT' });
  });

  test(`${runtime} fixture parent waits for late writes and cleans failures and timeout`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'fixture lifetime é-'));
    const file = join(root, 'child.mjs');
    const scratchRoot = join(root, 'scratch');
    await mkdir(scratchRoot);
    try {
      await writeFile(file, `import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const directory = process.env.TANGLE_FIXTURE_DIRECTORY;
await writeFile(join(directory, 'first'), 'started');
console.log('ready');
setTimeout(async () => { await writeFile(join(directory, 'last'), 'complete'); }, 30);
`);
      const result = await runRuntimeFixture(runtime, [file], { scratchRoot, async afterExit(directory) {
        assert.match(directory, /fixture é-/);
        assert.equal(await readFile(join(directory, 'last'), 'utf8'), 'complete');
      } });
      assert.match(result.stdout, /ready/);
      assert.deepEqual(await readdir(scratchRoot), []);
      await writeFile(file, "throw Error('expected child failure');\n");
      await assert.rejects(() => runRuntimeFixture(runtime, [file], { scratchRoot }), /expected child failure/);
      assert.deepEqual(await readdir(scratchRoot), []);
      await writeFile(file, 'setInterval(() => {}, 1000);\n');
      await assert.rejects(() => runRuntimeFixture(runtime, [file], { scratchRoot, timeout: 100 }), error => {
        assert.equal((error as { killed: boolean }).killed, true); return true;
      });
      assert.deepEqual(await readdir(scratchRoot), []);
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }); }
  });
}
