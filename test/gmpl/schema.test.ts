import {it} from 'node:test';
import assert from 'node:assert/strict';
import {validateGmplShape,resolveGmplParameters,gmplRevisionOf} from '@tangleai/gmpl';
it('GMPL parameters are closed and discriminated; unknown legacy options refuse',async()=>{
  for(const value of [{pattern:'parallel-analysis',participants:0},{pattern:'parallel-analysis',participants:9},{pattern:'peer-review',maxRounds:11},{pattern:'clarification',maxTurns:0},{pattern:'red-team',confidenceThreshold:0.7},{pattern:'delphi-panel',participants:1},{pattern:'delphi-panel',participants:2.5},{pattern:'unknown'}])assert.ok(!resolveGmplParameters(value).valid);
  for(const pattern of ['parallel-analysis','peer-review','red-team','structured-debate','clarification','delphi-panel'])assert.ok(resolveGmplParameters({pattern}).valid);
  assert.ok(!validateGmplShape('gmplPatternResult',{answer:'x',disposition:'completed',claims:[],findings:[],secret:'credential'}).valid);
  assert.ok(!validateGmplShape('gmplPatternResult',{answer:()=>'',disposition:'completed',claims:[],findings:[]}).valid);
  assert.notEqual(await gmplRevisionOf({value:1}),await gmplRevisionOf({value:2}));
});
