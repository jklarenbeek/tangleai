import {it} from 'node:test';
import assert from 'node:assert/strict';
import {validateGmplEvidence,mergeGmplFindings} from '@tangleai/gmpl';
import fixture from '../../benchmark/fixtures/gmpl/cases/minority-conflict-success.json' with {type:'json'};
import type {GmplPatternResult} from '@tangleai/gmpl';
it('evidence scope rejects hidden/digest-changed citations and lost minority findings',()=>{
  const result=fixture.script.result as GmplPatternResult,evidence=fixture.input.evidence;
  assert.ok(validateGmplEvidence(result,evidence).valid);
  for(const field of ['id','digest'] as const){const copy=structuredClone(result);copy.claims[0].citations[0][field]=field==='id'?'hidden':'0'.repeat(64);const out=validateGmplEvidence(copy,evidence);assert.ok(!out.valid);assert.equal(out.issues[0].code,'TGMPL1005');assert.equal(out.issues[0].path,'/claims/0/citations/0');}
  assert.ok(!validateGmplEvidence({...result,findings:[]},evidence,result.findings).valid);
  const changed=structuredClone(result);changed.findings[0].disposition='rejected-with-reason';assert.ok(!validateGmplEvidence(changed,evidence,result.findings).valid);
  changed.findings[0].reason='The second source establishes a different disposition.';assert.ok(validateGmplEvidence(changed,evidence,result.findings).valid);
  assert.ok(!mergeGmplFindings([result.findings,changed.findings]).valid);
});
it('finding equality ignores JSON property order and preserves critical flags',()=>{
  const finding={...(fixture.script.result as GmplPatternResult).findings[0],critical:true,contradictory:true};
  const same=Object.fromEntries(Object.entries(finding).reverse()) as typeof finding;
  assert.ok(mergeGmplFindings([[finding],[same]]).valid);
});
it('supported finding criticality cannot be silently removed',()=>{
  const finding={...(fixture.script.result as GmplPatternResult).findings[0],critical:true,contradictory:true};
  const dropped={...fixture.script.result,findings:[{...finding,critical:false}]};
  const result=validateGmplEvidence(dropped,fixture.input.evidence,[finding]);assert.ok(!result.valid);
});
