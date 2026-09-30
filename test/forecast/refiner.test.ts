import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createHarnessRefiner, harnessToSkills, skillsToHarness, sealForecastRecord, forecastRevision, type CommittedGuidance, type HarnessRefinerOptions } from '@tangleai/forecast';
import { makeForecastFixture } from './fixtures.ts';
import { loadForecastFixtures } from '../../benchmark/lib/forecast-fixtures.ts';
async function fixture(overrides: Partial<HarnessRefinerOptions> = {}) {
  const f = await makeForecastFixture(), corpus = await loadForecastFixtures();
  const options: HarnessRefinerOptions = { parent: f.harnesses,context: { questionPrompt: f.questions.prompt,adapterOptions: ['approve','reject'],evidenceExcerpts: [],toolResultExcerpts: [],questionId: f.questions.id,checkpointIds: [f.checkpoints.id] },sources: ['note:' + f.notes.id],now: () => f.questions.issuedAt,...overrides };
  return { ...f,corpus,options,refiner: await createHarnessRefiner(options),item: { component: 'evidenceHandling',text: 'Compare independent observations before updating the judgment.',sources: ['note:' + f.notes.id] } as CommittedGuidance };
}
it('round-trips the ledger projection and reproduces the registered candidate chain',async () => {
  const f = await fixture(); assert.deepEqual(skillsToHarness(harnessToSkills(f.harnesses.document,f.options)),f.harnesses.document);
  let parent = f.harnesses;
  for (const [i,component] of (['evidenceHandling','uncertaintyHandling'] as const).entries()) {
    const refiner = await createHarnessRefiner({ ...f.options,parent });
    const item = { ...f.item,component,text: (f.corpus.leaks as { allow: string[] }).allow[i] }, p = await refiner.prepareGuidance([item]);
    assert.equal(p.valid,true,JSON.stringify(p)); if (!p.valid) continue;
    assert.equal(p.plan.digest,f.corpus.candidates[i].digest); assert.deepEqual(p.plan.document,f.corpus.candidates[i].document);
    assert.deepEqual(p.plan.acceptedGuidance,[item]); assert.equal(p.plan.noOp,false);
    parent = await sealForecastRecord('harnesses',{ ...parent,document: p.plan.document,digest: p.plan.digest });
  }
});
it('a harness patch cannot rename a component, add a fourth, grant a tool, exceed churn caps or cite a dangling source',async () => {
  const f = await fixture();
  for (const path of ['/skills/0/name','/skills/3','/skills/0/tools','/skills/0/__proto__','/scopeKey']) {
    const refused = f.refiner.guarded.prepare(f.refiner.previous,[{ op: 'add',path,value: 'escape' }]);
    assert.equal(refused.valid,false,path); assert.equal(refused.errors[0].code,'TFCT1007'); assert.equal(refused.errors[0].docPath,'/patch/0/path');
  }
  for (const sources of [['dangling'],['note:' + 'f'.repeat(64)]]) { const p = await f.refiner.prepareGuidance([{ ...f.item,sources }]); assert.equal(p.valid,false); assert.equal(p.errors[0].code,'TFCT1007'); }
  for (const limits of [{ maxGrowthBytes: 1 },{ maxComponentBytes: 20 },{ maxComponents: 0 },{ maxOps: 0 },{ maxHarnessBytes: 10 }]) {
    const r = await createHarnessRefiner({ ...f.options,limits }), p = await r.prepareGuidance([f.item]); assert.equal(p.valid,false,JSON.stringify(limits)); assert.equal(p.errors[0].code,'TFCT1007');
  }
  const oversized = await f.refiner.prepareGuidance([{ ...f.item,text: 'é'.repeat(257) }]); assert.equal(oversized.valid,false); assert.equal(oversized.errors[0].code,'TFCT1007');
});
it('a no-op revision stages no version and is counted as deferred',async () => {
  let writes = 0; const f = await fixture({ commit: async () => { writes++; return 'unexpected'; } });
  const p = await f.refiner.prepareGuidance([{ ...f.item,text: f.harnesses.document.evidenceHandling }]);
  assert.equal(p.valid,true); assert.equal(p.plan.noOp,true); assert.deepEqual(p.plan.acceptedGuidance,[]); assert.equal(p.plan.deferredGuidance[0].reason,'duplicate-procedure');
  const result = await f.refiner.commitGuidance([]); assert.equal(result.ok,true); assert.deepEqual(result.value,{ status: 'deferred',writes: 0 }); assert.equal(writes,0);
});
it('refuses volatile facts and reads a previously recorded semantic classification',async () => {
  const f = await fixture();
  const volatile = await f.refiner.prepareGuidance([{ ...f.item,text: 'Persist the approve outcome.' }]); assert.equal(volatile.valid,false); assert.equal(volatile.errors[0].code,'TFCT1008');
  const semantic = { stage: 'revision.gate',revision: await forecastRevision('classifier'),result: { verdicts: [{ index: 0,verdict: 'question-specific',reason: 'Contains a question-specific implication.' }] } };
  const r = await createHarnessRefiner({ ...f.options,semantic }), p = await r.prepareGuidance([f.item]); assert.equal(p.valid,false); assert.equal(p.errors[0].code,'TFCT1008');
  assert.deepEqual(skillsToHarness(r.previous.skills),f.harnesses.document);
});
it('a forged prepared plan cannot bypass guarded publication',async () => {
  let writes = 0; const f = await fixture({ commit: async plan => { writes++; return plan.digest; } });
  const prepared = await f.refiner.prepareGuidance([f.item]); assert.equal(prepared.valid,true);
  const forged = structuredClone(prepared); forged.plan.patch = [{ op: 'replace',path: '/tools',value: ['web_search'] }];
  const result = await f.refiner.guarded.commitPrepared(f.refiner.previous,forged);
  assert.equal(result.ok,false); assert.equal(result.errors[0].code,'TFCT1007'); assert.equal(writes,0);
  const valid = await f.refiner.guarded.commitPrepared(f.refiner.previous,prepared); assert.equal(valid.ok,true); assert.equal(writes,1);
});
