/**
 * The authoring instrument: how often a plain request becomes an application
 * that works when a person uses it.
 *
 * Each task of `benchmark/fixtures/authoring/tasks.json` is a request in plain
 * words; the author chooses its own state, actions and layout. The author gets
 * the desktop's crib (`authoringCrib()` from `@tangleai/os/authoring`) and
 * repairs against the gate a desktop runs before it shows a document (the
 * lint, the compile, a first frame with text). It never sees the task's
 * probes: they are the judge, using the application as a person would and
 * checking the text any correct application shows.
 *
 *   node benchmark/authoring.ts                 keyless: the reference documents pass every probe
 *   node --env-file-if-exists=.env benchmark/authoring.ts --live [--trials 3] [--tasks bill,words]
 *        [--repairs 2] [--out benchmark/results/authoring-live.json]
 *
 * A live run plans every request up front against `TANGLE_AI_MAX_CALLS` and
 * refuses a plan that exceeds it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { authoringCrib, checkAuthoredApp, gateAuthoredApp, type AppProbe } from '../components/os/src/authoring.ts';
import { readAiEnv, chatSettingsOf } from './lib/ai-env.ts';

type Task = { id: string, request: string, probes: AppProbe[] };
const root = new URL('..', import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const TASKS: Task[] = read('benchmark/fixtures/authoring/tasks.json').tasks;

const { values: args } = parseArgs({ options: {
  live: { type: 'boolean', default: false }, trials: { type: 'string', default: '3' }, tasks: { type: 'string' },
  repairs: { type: 'string', default: '2' }, out: { type: 'string', default: 'benchmark/results/authoring-live.json' },
} });

if (!args.live) {
  let failed = 0;
  for (const task of TASKS) {
    const verdict = await checkAuthoredApp(read(`benchmark/fixtures/authoring/reference/${task.id}.json`), task.probes);
    if (!verdict.ok) failed++;
    console.log(`${verdict.ok ? 'ok  ' : 'FAIL'} ${task.id}${verdict.ok ? '' : `: ${verdict.problems[0]}`}`);
  }
  console.log(failed ? `${failed} of ${TASKS.length} reference documents fail their probes` : `all ${TASKS.length} reference documents pass their probes`);
  process.exit(failed ? 1 : 0);
}

const env = readAiEnv(process.env);
if (!env.live) { console.log(`skipped: ${env.reason}`); process.exit(0); }
const trials = Number(args.trials), repairs = Number(args.repairs);
const chosen = args.tasks ? TASKS.filter(t => args.tasks!.split(',').includes(t.id)) : TASKS;
const planned = chosen.length * trials * (1 + repairs);
if (planned > env.maxCalls) { console.log(`refused: the plan needs up to ${planned} requests and the ceiling is ${env.maxCalls}`); process.exit(2); }

// the desktop's own client factory, in JSON mode: an app document's profile is no output schema a provider accepts (D13)
const { chatClientFor } = await import('../apps/desktop/src/settings.ts');
const { createStructuredOutput } = await import('../packages/models/src/structured.ts');
let calls = 0, promptTokens = 0, completionTokens = 0, stop: string | null = null;
const metered: typeof fetch = async (input, init) => {
  if (stop) throw new Error(`stopped: ${stop}`);
  if (++calls > env.maxCalls) throw new Error('the request ceiling is reached');
  const response = await fetch(input, init);
  if (response.status === 401 || response.status === 402) stop = `HTTP ${response.status}`;
  try { const body = await response.clone().json(); promptTokens += body?.usage?.prompt_tokens ?? 0; completionTokens += body?.usage?.completion_tokens ?? 0; } catch { /* not JSON */ }
  return response;
};
const client = chatClientFor(chatSettingsOf(env), { fetch: metered, retry: { attempts: 3 }, structured: 'json' as any });
const system = `Author exactly one @jarenjs/app document for the person's request. Return its JSON value only.\n\n${authoringCrib()}`;
const gate = (doc: unknown) => {
  const { problems } = gateAuthoredApp(doc);
  return problems.length ? { valid: false, errors: problems.map(message => ({ docPath: '', message })) } : true;
};

const rows: any[] = [];
for (const task of chosen) for (let trial = 1; trial <= trials && !stop; trial++) {
  const before = calls;
  const generator = createStructuredOutput({ client, schema: { type: 'object' }, name: 'jaren_app', strict: false, gate: [gate], maxRepairs: repairs });
  let doc: unknown = null, attempts = 0, error: string | null = null;
  try {
    const result: any = await generator.generate([{ role: 'system', content: system }, { role: 'user', content: task.request }]);
    attempts = result.attempts ?? 0;
    if ('value' in result) doc = result.value; else error = JSON.stringify(result.errors ?? result.error ?? result).slice(0, 300);
  } catch (e: any) { error = String(e?.message ?? e).slice(0, 300); }
  const verdict = doc ? await checkAuthoredApp(doc, task.probes) : { ok: false, problems: [error ?? 'no document'] };
  rows.push({ task: task.id, trial, works: verdict.ok, gated: doc !== null, attempts, calls: calls - before, problems: verdict.problems.slice(0, 4), doc });
  console.log(JSON.stringify({ task: task.id, trial, works: verdict.ok, calls: calls - before, problem: verdict.problems[0]?.slice(0, 140) }));
}

const works = rows.filter(r => r.works).length;
const report = {
  $comment: 'Live authoring run: plain requests, the desktop crib and gate, judged by hidden probes. Validated by tests, never regenerated by them.',
  generated: { at: new Date().toISOString(), model: env.model, provider: env.provider, trials, repairs, tasks: chosen.map(t => t.id), structured: 'json' },
  summary: { runs: rows.length, works, rate: rows.length ? +(works / rows.length).toFixed(3) : 0, gated: rows.filter(r => r.gated).length, calls, promptTokens, completionTokens, stop },
  rows,
};
writeFileSync(new URL(args.out!, root), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.summary));
