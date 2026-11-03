/**
 * Run every `test/**\/*.test.ts` file through `node:test`'s `run()`, the longest
 * recorded file first so a long file never starts late and bounds the run, on
 * as many workers as the machine leaves room for: four at least, six at most.
 * (`node --test` sorts the files it is given, so the order needs the API.)
 * Files with no recorded time start first. `TANGLE_TEST_CONCURRENCY` or
 * `--test-concurrency=N` sets the worker count, `TANGLE_TEST_ORDER=alpha`
 * restores the plain glob order, and `TANGLE_TEST_RECORD=1` on a full run
 * rewrites `scripts/test-durations.json` with each file's time, module-level
 * work included. Arguments that name files (`npm test -- test/assistant/*.test.ts`)
 * run just those; `--test-reporter`, `--test-reporter-destination`,
 * `--test-name-pattern` and `--test-skip-pattern` work as for `node --test`.
 */
import assert from 'node:assert/strict';
import { createWriteStream, globSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';
import { finished } from 'node:stream/promises';
import { run } from 'node:test';
import * as reporters from 'node:test/reporters';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RECORD = fileURLToPath(new URL('test-durations.json', import.meta.url));
const FLAGS = ['test-reporter', 'test-reporter-destination', 'test-name-pattern', 'test-skip-pattern', 'test-concurrency'];
const flags = new Map(FLAGS.map(name => [name, [] as string[]])), patterns: string[] = [];
for (const arg of process.argv.slice(2)) {
  const flag = /^--([a-z-]+)=(.*)$/s.exec(arg);
  if (flag && flags.has(flag[1])) flags.get(flag[1])!.push(flag[2]);
  else {
    assert.ok(!arg.startsWith('-'), `scripts/test.ts takes file patterns and --${FLAGS.join('=, --')}=, not ${arg}`);
    patterns.push(arg);
  }
}
const given = (name: string) => flags.get(name)!.length ? flags.get(name) : undefined;

const all = [...new Set(patterns.length ? patterns.flatMap(pattern => globSync(pattern)) : globSync('test/**/*.test.ts'))].sort();
assert.ok(all.length, `No test file matches ${patterns.join(' ')}`);
const recorded = new Map(Object.entries(JSON.parse(readFileSync(RECORD, 'utf8')).seconds as Record<string, number>));
const files = process.env.TANGLE_TEST_ORDER === 'alpha' ? all
  : [...all.filter(file => !recorded.has(file)), ...all.filter(file => recorded.has(file)).sort((a, b) => recorded.get(b)! - recorded.get(a)!)];
const record = process.env.TANGLE_TEST_RECORD === '1';
assert.ok(!record || (!patterns.length && !given('test-name-pattern') && !given('test-skip-pattern') && process.env.TANGLE_TEST_ORDER !== 'alpha'),
  'TANGLE_TEST_RECORD=1 records only a full run in the recorded order');
const requested = Number(flags.get('test-concurrency')!.at(-1) ?? process.env.TANGLE_TEST_CONCURRENCY);
const concurrency = Number.isSafeInteger(requested) && requested > 0 ? requested : Math.max(4, Math.min(6, availableParallelism() - 2));

// Reporters load before the run starts, so none of its events go unheard; a class
// (or constructor function) is instantiated the way `node --test` does it.
const loaded = await Promise.all((given('test-reporter') ?? ['spec']).map(async name => {
  let reporter: any = Object.hasOwn(reporters, name) && name !== 'default' ? reporters[name as keyof typeof reporters]
    : await import(/^\.{0,2}\//.test(name) ? pathToFileURL(resolve(name)).href : name);
  reporter = reporter.default ?? reporter;
  return reporter.prototype && Object.getOwnPropertyDescriptor(reporter.prototype, 'constructor') ? new reporter() : reporter;
}));
const absolute = new Map(files.map(file => [resolve(file), file]));
const source = run({ files: [...absolute.keys()], concurrency, isolation: 'process', testNamePatterns: given('test-name-pattern'), testSkipPatterns: given('test-skip-pattern') });
const done = loaded.map((reporter, index) => {
  const target = flags.get('test-reporter-destination')![index] ?? 'stdout', output = source.compose(reporter);
  const destination = target === 'stdout' ? process.stdout : target === 'stderr' ? process.stderr : createWriteStream(target);
  output.pipe(destination);
  return finished(destination === process.stdout || destination === process.stderr ? output : destination);
});
const path = (value: string) => value.startsWith('file:') ? fileURLToPath(value) : value;
const measured = new Map<string, number>();
let wallSeconds = 0;
// A file's own complete event is timed by the runner from spawn to exit, unlike its summary.
source.on('test:complete', data => {
  const file = data.file && absolute.get(path(data.file));
  if (data.nesting === 0 && file && path(data.name) === path(data.file!)) measured.set(file, Math.round(data.details.duration_ms / 1000));
});
source.on('test:summary', data => {
  if (!data.success) process.exitCode = 1;
  if (data.file === undefined) wallSeconds = Math.round(data.duration_ms / 1000);
});
await Promise.all(done);

if (record && process.exitCode !== 1) {
  const seconds = Object.fromEntries([...measured].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1)));
  writeFileSync(RECORD, JSON.stringify({ measured: new Date().toISOString().slice(0, 10), node: process.version, workers: concurrency, wallSeconds, seconds }, null, 2) + '\n');
  console.log(`Recorded ${measured.size} of ${files.length} file times (${wallSeconds} s wall) in scripts/test-durations.json.`);
} else if (record) console.log('Not recorded: the run failed.');
