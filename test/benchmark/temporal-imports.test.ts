import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
test('canonical LoCoMo entrypoints initialize independently of temporal and policy import order', async () => {
  for (const name of ['locomo-qa', 'locomo-recall', 'temporal-live'])
    await exec(process.execPath, ['--input-type=module', '-e', `await import('./benchmark/lib/${name}.ts')`], { cwd: process.cwd() });
});
