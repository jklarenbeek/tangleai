import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { sha256 } from '../../benchmark/lib/longmemeval-source.ts';
import { lmeFixture } from '../fixtures/longmemeval.ts';
import { loadLongMemEval, lmeStamp } from '../../benchmark/lib/longmemeval.ts';
import { runTemporalKeyless } from '../../benchmark/lib/temporal-experiment.ts';
import { planTemporalPurchases } from '../../benchmark/lib/temporal-live.ts';
import { runTemporalConformance } from '../../benchmark/lib/temporal-conformance.ts';
import { temporalConformanceContext } from '../../benchmark/lib/temporal-conformance-source.ts';
import { temporalExperimentReport, temporalExperimentSummary, validateTemporalExperiment, validateTemporalExperimentSummary, renderTemporalExperiment } from '../../benchmark/lib/temporal-report.ts';
import { temporalLocomoComparison, renderTemporalLocomo } from '../../benchmark/lib/temporal-locomo.ts';
const rehash = <T extends {sha256:string}>(r:T):T => { const {sha256:_,...body}=r;return {...r,sha256:sha256(canonicalizeJson(body))}; };
test('the generated experiment contract rejects changed counters, missing questions, hidden budgets and forged default decisions', async () => {
  const data = [lmeFixture()], keyless = await runTemporalKeyless(data,[]), plan = await planTemporalPurchases(data,[],'a'.repeat(64));
  const conformance = await runTemporalConformance({sourceHash:plan.sourceIdentity,registrationHash:plan.registrationHash,lme:{status:'available',qa:1,retrieval:0,futureGoldQuestions:1},locomo:{status:'unavailable',scorable:null,adversarial:null,anchoredQuestions:null}});
  const report = temporalExperimentReport(keyless,conformance,plan); assert.equal(validateTemporalExperiment(report),true);
  const summary = temporalExperimentSummary(report); assert.equal(validateTemporalExperimentSummary(summary),true); assert.equal(validateTemporalExperiment(summary),false);
  assert.equal(renderTemporalExperiment(report),renderTemporalExperiment(summary));
  const changed = structuredClone(report);changed.summaries[0].questions++;assert.equal(validateTemporalExperiment(rehash(changed)),false);
  const hidden = structuredClone(report);hidden.questionRows[0].rows[2].bytes=12001;assert.equal(validateTemporalExperiment(rehash(hidden)),false);
  const missing = structuredClone(report);missing.questionRows.pop();assert.equal(validateTemporalExperiment(rehash(missing)),false);
  assert.equal(validateTemporalExperiment(rehash({...report,default:'on'})),false);
  const badSummary = structuredClone(summary);badSummary.summaries[0].unmeasured++;assert.equal(validateTemporalExperimentSummary(rehash(badSummary)),false);
});
test('optional LoCoMo block binds its original metric, corpus and complete question-group pairs', () => {
  const expected=[{id:'q',group:'conversation'}], block=temporalLocomoComparison({metric:'locomo-f1',datasetHash:'d',sourceIdentity:'s',registrationHash:'r',expected,pairs:[{...expected[0],control:.2,treatment:.3}]});
  assert.ok(renderTemporalLocomo(block,'d').includes('canonical-unanchored'));
  assert.throws(()=>renderTemporalLocomo(block,'other'),/identity/);
  const analysis = block.analysis; assert.ok(analysis.status === 'measured');
  assert.throws(()=>renderTemporalLocomo({...block,analysis:{...analysis,low:1}},'d'),/identity/);
});
test('the compact external matrix receipt reproduces its document and is bound to the current effective source bytes', async t => {
  const context = await temporalConformanceContext(process.cwd());
  if(context.lme.status==='unavailable'||context.locomo.status==='unavailable'){t.skip('optional external corpus absent; synthetic report and scorer tests still run');return;}
  const receipt:unknown=JSON.parse(await readFile('benchmark/receipts/temporal-keyless.json','utf8'));
  assert.ok(validateTemporalExperimentSummary(receipt));assert.equal(receipt.context.sourceHash,context.sourceHash);assert.equal(receipt.registrationHash,context.registrationHash);
  assert.equal(receipt.counts.questions,500);assert.equal(receipt.counts.profileCases,1000);assert.equal(receipt.counts.plannedRows,8000);assert.equal(receipt.strict.passed,138);
  const corpus=await loadLongMemEval(process.cwd());assert.ok(corpus.status==='available');
  // Independent raw-array accounting: every strict oracle loss must be explained
  // by unavailable gold, rather than a source-ID collapse or context truncation.
  const eligible=corpus.value.filter(q=>!q.question_id.includes('_abs'));
  const availability=eligible.map(q=>{const cutoff=lmeStamp(q.question_date)!.epochMs;
    const allowed=new Set(q.haystack_session_ids.filter((_,i)=>lmeStamp(q.haystack_dates[i])!.epochMs<=cutoff));
    return {any:q.answer_session_ids.some(id=>allowed.has(id)),all:q.answer_session_ids.every(id=>allowed.has(id))};});
  const strict=receipt.summaries.find(r=>r.profile==='strict-as-of'&&r.fold==='all'&&r.row==='oracle-evidence')!;
  assert.equal(availability.filter(a=>!a.any).length,18);assert.equal(availability.filter(a=>!a.all).length,41);
  assert.equal(strict.retrieval.recallAny,availability.filter(a=>a.any).length/eligible.length);
  assert.equal(strict.retrieval.recallAll,availability.filter(a=>a.all).length/eligible.length);
  const provided=receipt.summaries.find(r=>r.profile==='provided-history'&&r.fold==='all'&&r.row==='oracle-evidence')!;
  assert.equal(provided.retrieval.recallAny,1);assert.equal(provided.retrieval.recallAll,1);
  assert.equal(await readFile('docs/TEMPORAL_EVALUATION.md','utf8'),renderTemporalExperiment(receipt));
});
