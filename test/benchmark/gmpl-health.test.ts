import {it} from 'node:test';
import assert from 'node:assert/strict';
import measured from '../../benchmark/results/gmpl-conformance.json' with {type:'json'};
import {validateGmplReport} from '../../benchmark/lib/gmpl-conformance.ts';
import {contentId} from '../../benchmark/lib/gmpl-oracle.ts';
import type {GmplConformance} from '../../benchmark/lib/gmpl-conformance.types.ts';
it('report verification refuses forged logical-role and token cost censuses after rehashing',async()=>{
  for(const mutate of [(r:GmplConformance)=>{r.rows[0].cases[0].usage.roles++;},(r:GmplConformance)=>{r.rows[0].cases[0].usage.promptTokens++;}]){
    const report=structuredClone(measured) as unknown as GmplConformance;mutate(report);const c=report.rows[0].cases[0],{receiptId:_,...rest}=c;c.receiptId=await contentId(rest);const {reportId:__,...payload}=report;report.reportId=await contentId(payload);assert.equal((await validateGmplReport(report)).valid,false);
  }
});
