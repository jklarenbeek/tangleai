import {it} from 'node:test';
import assert from 'node:assert/strict';
import report from '../../benchmark/results/gmpl-conformance.json' with {type:'json'};
import {comparisons,validateGmplReport} from '../../benchmark/lib/gmpl-conformance.ts';
import {contentId} from '../../benchmark/lib/gmpl-oracle.ts';
import type {GmplConformance,Resources} from '../../benchmark/lib/gmpl-conformance.types.ts';
it('comparison refuses unequal information or resources',async()=>{
  const measured=report as unknown as GmplConformance;
  assert.ok(comparisons(measured.rows).every(p=>p.eligible));
  const mutations:Array<(r:Resources)=>void>=[r=>{r.evidenceId='0'.repeat(64);},r=>{r.model='different-model';},r=>{r.caps.tokens--;},r=>{r.humanId='0'.repeat(64);},r=>{r.profile='different-profile';},r=>{r.outputSchemaId='0'.repeat(64);}];
  for(const mutate of mutations){
    const changed=structuredClone(measured),receipt=changed.rows[0].cases[0];mutate(receipt.resources);
    const pair=comparisons(changed.rows)[0];assert.equal(pair.eligible,false);assert.equal(pair.delta,null);assert.equal(pair.reason,'unequal information or resources');
    const {receiptId:_,...receiptPayload}=receipt;receipt.receiptId=await contentId(receiptPayload);
    const {reportId:__,...payload}=changed;changed.reportId=await contentId(payload);
    assert.ok(!(await validateGmplReport(changed)).valid,'a forged eligible delta cannot survive receipt rehashing');
  }
});
it('diagnostic ablations retain their separate denominator and actual costs',()=>{
  const measured=report as unknown as GmplConformance;
  assert.equal(measured.coverage.planned,288);assert.equal(measured.ablations.length,7);assert.equal(new Set(measured.ablations.map(a=>a.kind)).size,3);
  for(const a of measured.ablations){assert.equal(a.receipt.usage.roles,a.expectedRoles);assert.equal(a.receipt.usage.physical,a.receipt.visibility.length);}
  assert.equal(measured.pairs.find(p=>p.pattern==='clarification')!.delta,-0.375);
});
