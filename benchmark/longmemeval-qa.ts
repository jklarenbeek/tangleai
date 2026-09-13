/** Keyless by default. Live/replay paths require explicit plans, caps and durable ignored receipts. */
import assert from 'node:assert/strict';
import { readFile, mkdir, unlink } from 'node:fs/promises';
import { writeFileSync, renameSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { parseArgs } from './lib/args.ts';
import { loadLongMemEval } from './lib/longmemeval.ts';
import { temporalConformanceContext } from './lib/temporal-conformance-source.ts';
import { temporalPurchaseTransport, type TemporalPurchasePlan, type TemporalPurchaseJournal, type TemporalPurchaseApproval } from './lib/temporal-live.ts';
import { executeLongMemEvalQa } from './lib/longmemeval-qa.ts';

const argv = process.argv.slice(2);
if (!argv.includes('--live') && !argv.includes('--replay')) await import('./temporal-eval.ts');
else {
  const args = parseArgs(argv, { flags: ['live', 'replay'], values: ['plan', 'approval', 'journal', 'json', 'key-env'] });
  assert.ok(!args.rest.length && args.flags.has('live') !== args.flags.has('replay'), 'choose live or replay explicitly');
  for (const key of ['plan','approval','journal','json']) assert.ok(args.values.has(key), `--${key} is required`);
  const plan = JSON.parse(await readFile(args.values.get('plan')!, 'utf8')) as TemporalPurchasePlan;
  const approval = JSON.parse(await readFile(args.values.get('approval')!, 'utf8')) as TemporalPurchaseApproval;
  assert.equal(plan.sourceIdentity, (await temporalConformanceContext(process.cwd())).sourceHash, 'source changed since plan approval');
  const corpus = await loadLongMemEval(process.cwd()); assert.equal(corpus.status, 'available'); if (corpus.status !== 'available') throw Error('required corpus unavailable');
  const journalPath = resolve(args.values.get('journal')!), outputPath = resolve(args.values.get('json')!);
  function ignored(path: string) {
    const local = relative(process.cwd(), path);
    if (local.startsWith('..')) { assert.ok(path.startsWith(resolve(tmpdir()) + '/'), 'external receipts must use the temporary directory'); return; }
    execFileSync('git', ['check-ignore','--quiet','--no-index',local]);
  }
  ignored(journalPath); ignored(outputPath); await mkdir(dirname(journalPath), { recursive: true }); await mkdir(dirname(outputPath), { recursive: true });
  const lockPath = `${journalPath}.lock`; writeFileSync(lockPath, `${process.pid}\n`, { flag: 'wx' });
  try {
    let journal: TemporalPurchaseJournal;
    try { journal = JSON.parse(await readFile(journalPath, 'utf8')) as TemporalPurchaseJournal; }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT' || args.flags.has('replay')) throw cause;
      journal = { planHash: plan.sha256, origin: 'live', campaignRequests: approval.campaignRequests, campaignUsd: approval.campaignUsd, entries: [] }; }
    const save = () => { const temp = `${journalPath}.${process.pid}.tmp`; writeFileSync(temp, JSON.stringify(journal,null,2)+'\n', { mode: 0o600 }); renameSync(temp,journalPath); };
    let fetcher: typeof fetch = async () => { throw Error('replay forbids network'); };
    if (args.flags.has('live')) {
      assert.equal(journal.origin, 'live', 'scripted receipts cannot be upgraded to live');
      const keyEnv = args.values.get('key-env'); assert.ok(keyEnv, 'live use requires explicit --key-env');
      const apiKey = process.env[keyEnv]; assert.ok(apiKey, 'selected credential is absent');
      fetcher = (url, init) => fetch(url, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), authorization: `Bearer ${apiKey}` } });
    }
    const result = await executeLongMemEvalQa(corpus.value, plan, temporalPurchaseTransport(plan, journal, approval, { fetch: fetcher, save, replay: args.flags.has('replay') }));
    writeFileSync(outputPath, JSON.stringify({ origin: journal.origin === 'scripted' ? 'scripted' : args.flags.has('replay') ? 'verified-live-replay' : 'live', planHash: plan.sha256,
      default: 'off', qualification: 'QA evidence only; the complete paired LongMemEval/LoCoMo correctness and deployment-cost gate is still required.', ...result },null,2)+'\n', { mode: 0o600 });
    console.log(JSON.stringify({ rows: result.rows.length, measured: result.rows.filter(r=>r.status==='measured').length, failed: result.rows.filter(r=>r.status==='failed').length, transport: result.transport, default: 'off' }));
    if(result.rows.some(r=>r.status==='failed'))process.exitCode=1;
  } finally { await unlink(lockPath); }
}
