/**
 * Run every `test/**\/*.test.ts` file under `node --test`, the slowest files
 * first so a long file never starts last, on as many workers as the machine
 * leaves room for: four at least, six at most. `TANGLE_TEST_CONCURRENCY` sets
 * the worker count and `TANGLE_TEST_ORDER=alpha` restores the plain glob
 * order. Arguments that name files (`npm test -- test/assistant/*.test.ts`)
 * run just those; flags, in `--name=value` form, go to `node --test`.
 */
import { globSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { spawnSync } from 'node:child_process';

/** The files that held half the suite's test time on 2026-11-03, slowest first. */
const SLOW_FIRST = [
  'test/benchmark/research.test.ts',
  'test/benchmark/trading-health.test.ts',
  'test/benchmark/trading.test.ts',
  'test/benchmark/priha.test.ts',
  'test/benchmark/research-report.test.ts',
  'test/benchmark/place-runtime.test.ts',
  'test/benchmark/forecast.test.ts',
  'test/benchmark/place-cli.test.ts',
  'test/benchmark/locomo-qa.test.ts',
  'test/benchmark/consolidate.test.ts',
  'test/benchmark/locomo-recall.test.ts',
  'test/benchmark/gmpl-conformance.test.ts',
  'test/benchmark/research-domains.test.ts',
  'test/benchmark/hera-qa.test.ts',
  'test/benchmark/outcome-conformance.test.ts',
];

const args = process.argv.slice(2), named = args.filter(arg => !arg.startsWith('-'));
const all = (named.length ? named.flatMap(pattern => globSync(pattern)) : globSync('test/**/*.test.ts')).sort();
const files = process.env.TANGLE_TEST_ORDER === 'alpha' ? all
  : [...SLOW_FIRST.filter(file => all.includes(file)), ...all.filter(file => !SLOW_FIRST.includes(file))];
const requested = Number(process.env.TANGLE_TEST_CONCURRENCY);
const concurrency = Number.isSafeInteger(requested) && requested > 0 ? requested : Math.max(4, Math.min(6, availableParallelism() - 2));
const run = spawnSync(process.execPath, ['--test', `--test-concurrency=${concurrency}`, ...args.filter(arg => arg.startsWith('-')), ...files], { stdio: 'inherit' });
process.exit(run.status ?? 1);
