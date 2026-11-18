/**
 * The inner loop for work on `@tangleai/os` and the Pages desktop: minutes,
 * not the release gate. It runs what an OS change can break and nothing else:
 *
 *   1. the typecheck of the whole repository (an OS type reaches its hosts);
 *   2. the OS and Pages unit tests (`test/os`, `test/pages`);
 *   3. the Pages build;
 *   4. every OS browser spec (`.e2e/migration/os-*.spec.mjs`) in Chromium and
 *      Firefox, against that build on a private port.
 *
 *   node scripts/os-loop.ts                    everything
 *   node scripts/os-loop.ts --unit             steps 1–2 only
 *   node scripts/os-loop.ts --browser chromium one browser
 *   node scripts/os-loop.ts --grep "dock"      only browser tests whose title matches
 *
 * No benchmark artifact hashes `components/os`, `apps/pages` or their tests, so
 * an OS change never needs a regeneration. A release still goes through the
 * short release gate once, for the batch.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));
const { values: args } = parseArgs({ options: {
  unit: { type: 'boolean', default: false },
  browser: { type: 'string', multiple: true },
  grep: { type: 'string' },
  port: { type: 'string', default: '4740' },
} });

const timings: [string, number, boolean][] = [];
function step(name: string, command: string, argv: string[], env: Record<string, string> = {}): boolean {
  const started = Date.now();
  process.stdout.write(`\n── ${name}\n`);
  const run = spawnSync(command, argv, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
  const ok = run.status === 0;
  timings.push([name, (Date.now() - started) / 1000, ok]);
  return ok;
}
const report = () => {
  console.log('\n── os loop');
  for (const [name, seconds, ok] of timings) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(28)} ${seconds.toFixed(0).padStart(4)} s`);
  const failed = timings.some(([, , ok]) => !ok);
  console.log(failed ? 'the loop is red' : `green in ${timings.reduce((n, [, s]) => n + s, 0).toFixed(0)} s`);
  process.exit(failed ? 1 : 0);
};

const tests = (dir: string) => readdirSync(new URL(`../${dir}/`, import.meta.url)).filter(f => f.endsWith('.test.ts')).map(f => `${dir}/${f}`);
if (!step('typecheck', 'npx', ['tsc', '-p', 'tsconfig.json'])) report();
step('unit: test/os, test/pages', process.execPath, ['--test', ...tests('test/os'), ...tests('test/pages')]);
if (args.unit) report();

if (!step('pages build', 'bun', ['apps/pages/build.ts'])) report();
const specs = readdirSync(new URL('../.e2e/migration/', import.meta.url)).filter(f => /^os-.*\.spec\.mjs$/.test(f)).map(f => f.replace(/\.spec\.mjs$/, ''));
const server = spawn('python3', ['-m', 'http.server', args.port!, '--bind', '127.0.0.1', '--directory', 'apps/pages/dist'], { cwd: root, stdio: 'ignore' });
try {
  await new Promise(resolve => setTimeout(resolve, 600));
  const browsers = args.browser?.length ? args.browser : ['chromium', 'firefox'];
  step(`browser: ${specs.length} os specs`, process.execPath, ['.e2e/migration/run.mjs', ...browsers.map(b => `--project=${b}`), ...specs, ...(args.grep ? ['-g', args.grep] : [])],
    // Playwright as the release gate resolves it
    { PAGES_URL: `http://127.0.0.1:${args.port}` });
} finally { server.kill(); }
report();
