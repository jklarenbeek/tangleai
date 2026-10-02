import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readAiEnv } from '../../benchmark/lib/ai-env.ts';
import { planTradingLive, runTradingLive } from '../../benchmark/lib/trading-live.ts';
import { measureTradingPaperProfile } from '../../benchmark/lib/trading-paper.ts';

it('the undecided paper profile has no synthetic manifest, observations, costs or completed rows', async () => {
  const paper = await measureTradingPaperProfile();
  assert.equal(paper.registration.manifest, null); assert.equal(paper.registration.corpus, null);
  assert.equal(paper.rows.length, 7);
  assert.ok(paper.rows.every(r => r.status === 'not-run' && r.parityTier === 'unmeasured' && !r.eligible && r.reason === 'no licensed replay corpus decided' && r.sessions === 0));
});
it('the live CLI prints the frozen dry plan, refuses mismatched authorization and writes no unexecuted result', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'trading-live-preflight-'));
  try {
    const hook = join(dir, 'network.mjs'), resultFile = join(dir, 'live.json');
    await writeFile(hook, "globalThis.fetch = async () => { throw Error('UNAUTHORIZED_NETWORK'); };\n");
    const run = (...args: string[]) => promisify(execFile)(process.execPath, ['--import', hook, 'benchmark/trading.ts', ...args],
      { env: { PATH: process.env.PATH, TANGLE_AI_MODEL: 'scripted/model' }, maxBuffer: 65536 });
    const dry = JSON.parse((await run('--live', '--live-json', resultFile)).stdout);
    assert.equal(dry.status, 'dry-plan'); assert.equal(dry.plan.maximumFreshCalls, 0); assert.equal(dry.plan.exactCacheHits, 0);
    await assert.rejects(access(resultFile));
    await assert.rejects(run('--live', '--authorize', 'wrong-plan'), /planId/);
    const skipped = JSON.parse((await run('--live', '--authorize', dry.plan.planId, '--live-json', resultFile)).stdout);
    assert.equal(skipped.status, 'skipped'); assert.match(skipped.reason, /no key/); await assert.rejects(access(resultFile));
    for (const args of [['--profile', 'unknown'], ['--authorize', 'wrong-plan'], ['--fresh'], ['--live', '--profile', 'fixture'], ['--live', '--check']])
      await assert.rejects(run(...args));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it('live preflight spends nothing, freezes exact authorization and never discloses the key', async () => {
  const prior = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests++; throw Error('No live request is authorized'); };
  try {
    const secret = 'not-a-real-key-sentinel', env = readAiEnv({ OPENROUTER_AI_KEY: secret, TANGLE_AI_MODEL: 'scripted/model', TANGLE_AI_MAX_CALLS: '9', TANGLE_AI_MAX_CONCURRENCY: '2' });
    const plan = await planTradingLive({ env }); assert.deepEqual(plan, await planTradingLive({ env }));
    assert.equal(plan.maximumFreshCalls, 0); assert.equal(plan.exactCacheHits, 0); assert.equal(plan.roles.length, 5);
    assert.deepEqual(plan.ceilings, { calls: 9, concurrency: 2 }); assert.ok(plan.roles.every(r => r.decisions === 0 && r.maximumFreshCalls === 0));
    assert.ok(!JSON.stringify(plan).includes(secret)); assert.equal((await runTradingLive({ env })).status, 'dry-plan');
    await assert.rejects(runTradingLive({ env, authorize: 'wrong-plan' }), /planId/);
    await assert.rejects(runTradingLive({ env, fresh: true, authorize: plan.planId }), /planId/);
    const skipped = await runTradingLive({ env, authorize: plan.planId }); assert.equal(skipped.status, 'skipped');
    assert.equal(skipped.reason, 'no licensed replay corpus decided'); assert.equal(skipped.fresh, 0); assert.equal(skipped.replayed, 0);
    const noKey = readAiEnv({ TANGLE_AI_MODEL: 'scripted/model' }), keylessPlan = await planTradingLive({ env: noKey });
    assert.match((await runTradingLive({ env: noKey, authorize: keylessPlan.planId })).reason!, /no key/);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = prior; }
});
