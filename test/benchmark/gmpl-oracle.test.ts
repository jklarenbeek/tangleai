import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import controls from '../../benchmark/fixtures/gmpl/corrupt-controls.json' with {type:'json'};
import {loadCases} from '../../benchmark/lib/gmpl-conformance.ts';
import {scoreGmplResult,checkTrace} from '../../benchmark/lib/gmpl-oracle.ts';
const cases=await loadCases();
describe('GMPL independent fixture oracle',()=>{
  it('registers 24 cases with four distinct variants in each of six groups',()=>{
    assert.equal(cases.length,24);assert.equal(new Set(cases.map(c=>c.id)).size,24);
    for(const group of new Set(cases.map(c=>c.group)))assert.equal(cases.filter(c=>c.group===group).length,4);
    for(const c of cases){assert.equal(scoreGmplResult(c,c.script.result).utility,1);assert.ok(!Object.hasOwn(c.input,'oracle'));}
  });
  for(const control of controls)it(`rejects corrupted ${control.id}`,()=>{
    assert.ok(checkTrace(control.expected,control.expected));assert.ok(!checkTrace(control.expected,control.observed));
  });
  it('does not reward hidden citations, missing minority findings or false confidence',()=>{
    const f=cases.find(c=>c.oracle.requiredFindings.length)!;
    const missing=structuredClone(f.script.result);missing.findings=[];
    assert.equal(scoreGmplResult(f,missing).utility,0);
    const foreign=structuredClone(f.script.result);foreign.claims[0].citations[0].id='hidden';
    assert.equal(scoreGmplResult(f,foreign).utility,0);
    const wrong=structuredClone(f.script.result);wrong.answer='unrelated';
    assert.equal(scoreGmplResult(f,wrong).utility,0);
    assert.ok(!scoreGmplResult(f,{...f.script.result,confidence:1}).valid);
  });
});
