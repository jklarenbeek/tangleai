import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readAiEnv } from '../../benchmark/lib/ai-env.ts';
import { buildForecastLive, runForecastLive, validateForecastLive, forecastLiveAuthorization } from '../../benchmark/lib/forecast-live.ts';
import { forecastCounterfactuals } from '../../benchmark/lib/forecast-ablations.ts';
import { createInternalFeedbackEditor } from '@tangleai/forecast';
import { scriptedClient } from '../forecast/runtime-fixture.ts';
import { feedbackFixture, feedbackAnswer } from '../forecast/feedback-fixture.ts';
import type { Row } from '../../benchmark/lib/forecast.types.ts';
import { openTangleDb } from '@tangleai/store';
import { loadForecastFixtures } from '../../benchmark/lib/forecast-fixtures.ts';
import { measureEvolvingForecast } from '../../benchmark/lib/forecast-evolving.ts';
import { forecastGenerations } from '../../benchmark/lib/forecast-longrun.ts';
import { execFileSync } from 'node:child_process';
import { mkdtemp,readFile,rm,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

it('counts retained rejected guidance even when repair succeeds and stages a clean candidate',async () => {
  const f = await feedbackFixture(), text = 'Remember Tidewater at checkpoint 2.';let calls = 0;
  const revised = await createInternalFeedbackEditor({ ...f,client: scriptedClient(async () => feedbackAnswer({ provisionalDiagnoses: [],committedGuidance: [{ ...f.item,text: calls++ ? f.item.text : text }],deferredFeedback: [] })) }).run(f,f.budget);
  assert.equal(revised.status,'staged');
  const row = { runtime: { retained: [{ revision: revised.revision }] },lifecycle: { records: { retrospectives: [] },pairedCandidates: [] } } as unknown as Row;
  const block = forecastCounterfactuals(row).gateCounterfactual;
  assert.equal(block.guidanceRefused,1);assert.equal(block.excludedGuidanceBytes,new TextEncoder().encode(text).length);assert.equal(block.semanticRefusals,0);
});
it('the counterfactual blocks never relax a gate or write to an observed lineage',async () => {
  const db=await openTangleDb({jobs:{},capture:{mode:'auto'}});let writes=0;const unsubscribe=db.observe(()=>{writes++;});
  try{
    const fixture=await loadForecastFixtures(),measured=await measureEvolvingForecast(fixture,{db}),before=writes;assert.ok(before>0);
    const row={runtime:{retained:measured.retained},lifecycle:measured.lifecycle} as unknown as Row,original=JSON.stringify(row),blocks=forecastCounterfactuals(row);
    assert.equal(writes,before);assert.equal(JSON.stringify(row),original);assert.equal(blocks.gateCounterfactual.newWrites,0);assert.equal(blocks.verdictOnlyPromotion.newWrites,0);assert.equal(blocks.verdictOnlyPromotion.refused,2);assert.equal(blocks.gateCounterfactual.guidanceRefused,0);
    const missing=structuredClone(fixture),digest=fixture.candidates[0].digest;delete missing.predictions['q03-c1'][digest];const generations=await forecastGenerations(missing,measured);assert.equal(generations[1].transfer.status,'not-run');assert.equal(generations[1].transfer.delta,null);assert.ok(generations[1].transfer.reason!.includes(digest));assert.deepEqual(generations[1].transfer.missingCheckpointIds,['q03-c1']);assert.equal(writes,before);
  }finally{unsubscribe();await db.close();}
});
it('freezes a credential-free live plan and makes no call for skips, dry plans or mismatched authorization',async () => {
  const fake = 'forecast-test-secret-do-not-retain', env = readAiEnv({ OPENROUTER_AI_KEY: fake,TANGLE_AI_MODEL: 'fixture/model',TANGLE_AI_MAX_CALLS: '600' });
  let requests = 0;const fetch = async () => { requests++;throw Error('Dry plan reached transport.'); };
  const record = await buildForecastLive({ env });validateForecastLive(record);assert.equal(record.plan.maxFreshTotal,596);assert.equal(record.status,'not-run');assert.equal(record.physicalRequests,0);assert.ok(!JSON.stringify(record).includes(fake));
  assert.equal((await runForecastLive(record,{ env,fetch })).authorization,'dry-run');
  assert.equal((await runForecastLive(record,{ env,fetch,authorize: 'wrong' })).authorization,'refused');
  assert.equal(forecastLiveAuthorization(record.plan,record.plan.planId),'execute');
  const empty = readAiEnv({}), skipped = await buildForecastLive({ env: empty });assert.equal((await runForecastLive(skipped,{ env: empty,fetch })).authorization,'skipped');
  assert.equal(forecastLiveAuthorization(skipped.plan,'wrong'),'refused');assert.equal(requests,0);
  const forged = structuredClone(record);forged.plan.rows[0].maxFreshCalls++;await assert.rejects(runForecastLive(forged,{ env,fetch,authorize: forged.plan.planId }),/plan changed/);assert.equal(requests,0);
  for (const url of ['https://user:secret@forecast.invalid/v1','https://forecast.invalid/v1?key=secret','https://forecast.invalid/v1#secret']) await assert.rejects(buildForecastLive({ env: { ...env,baseUrl: url } }),/credential-free/);
});
it('executes an exactly authorized plan through the real wire and MAS host using only an injected fake transport',async () => {
  const env = readAiEnv({ OPENROUTER_AI_KEY: 'fixture-key',TANGLE_AI_MODEL: 'fixture/model',TANGLE_AI_MAX_CALLS: '600' }), record = await buildForecastLive({ env });
  let requests = 0;
  const fetch: typeof globalThis.fetch = async (_url,init) => {
    requests++; const body = JSON.parse(String(init?.body)), format = body.response_format?.json_schema?.name;
    assert.equal(body.max_tokens,1024);assert.equal(body.reasoning.enabled,false);assert.equal(body.stream,false);
    let content: string;
    if (format === 'checkpoint_note') content = JSON.stringify(Object.fromEntries(['questionState','keyEvidence','mainJudgmentTrajectory','helpfulSignals','misleadingOrFragileSignals','unresolvedRisks'].map(k => [k,'The supplied checkpoint is recorded.'])));
    else if (format === 'internal_feedback') content = JSON.stringify({ provisionalDiagnoses: [],committedGuidance: [],deferredFeedback: [] });
    else if (format === 'forecast_retrospective') content = JSON.stringify({ verdicts: [],candidate: null });
    else { const data = body.messages.filter((m: { role: string }) => m.role === 'user').map((m: { content: string }) => JSON.parse(m.content)).find((d: { adapter?: unknown }) => d.adapter);assert.ok(data,JSON.stringify({ format,messages: body.messages }));content = '\\boxed{' + (data.adapter.id === 'choice/v1' ? data.adapter.options[0] : data.adapter.range[0]) + '}'; }
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant',content },finish_reason: 'stop' }],usage: { prompt_tokens: 2,completion_tokens: 1,total_tokens: 3 },model: 'fixture/model' }),{ headers: { 'content-type': 'application/json' } });
  };
  const result = await runForecastLive(record,{ env,authorize: record.plan.planId,fetch });
  assert.equal(result.authorization,'execute');assert.equal(result.physicalRequests,requests);assert.ok(requests>0&&requests<=596);assert.equal(result.execution!.rows.length,4);
  for (const row of result.execution!.rows) { assert.equal(row.cases.length,18);assert.deepEqual(row.failures,[]);assert.ok(row.cases.every(c=>c.prediction));assert.equal(row.cost.calls,row.physicalRequests); }
  const evolving = result.execution!.rows[3];assert.equal(evolving.resolutions.length,5);assert.equal(evolving.retrospectives.length,5);assert.ok(evolving.retrospectives.every(r=>r.outcome==='retained'));assert.ok(!JSON.stringify(result).includes('fixture-key'));
});
it('the live CLI redirects its not-run record, checks without writing and refuses a wrong plan',async () => {
  const dir=await mkdtemp(join(tmpdir(),'forecast-live-cli-'));
  const env={...process.env,OPENROUTER_AI_KEY:'fake-forecast-key',TANGLE_AI_PROVIDER:'custom',TANGLE_AI_BASE_URL:'https://forecast.fixture.invalid/v1',TANGLE_AI_MODEL:'fixture/model',TANGLE_AI_MAX_CALLS:'600'};
  const run=(args:string[],key=env.OPENROUTER_AI_KEY)=>execFileSync(process.execPath,['benchmark/forecast.ts','--live','--out-dir',dir,...args],{env:{...env,OPENROUTER_AI_KEY:key},encoding:'utf8',stdio:'pipe'});
  try{
    assert.match(run([]),/dry-run: 0 provider requests/);const path=join(dir,'forecast-live.json'),bytes=await readFile(path,'utf8'),record=JSON.parse(bytes);validateForecastLive(record);assert.doesNotMatch(bytes,/fake-forecast-key/);
    const before=(await stat(path)).mtimeMs;run(['--check']);assert.equal((await stat(path)).mtimeMs,before);
    assert.throws(()=>run(['--authorize','wrong']),/does not match/);assert.throws(()=>run(['--check','--authorize',record.plan.planId]),/check mode/);
    assert.match(run([],''),/skipped: 0 provider requests/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
