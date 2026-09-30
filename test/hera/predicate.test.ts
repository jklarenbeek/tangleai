import {test} from 'node:test';
import assert from 'node:assert/strict';
import {persistentFailure,heraProfileBucket,type HeraFailureState} from '@tangleai/hera';
test('persistent evaluated zeros trigger once at the threshold and reset only on success',async()=>{
  let state:HeraFailureState|undefined;
  const observe=(id:string,score:number|null,bucket='one')=>{const result=persistentFailure(state,{groupId:id,primaryScore:score,profileBucket:bucket},{consecutiveFailures:3});assert.ok(result.valid);state=result.value.state;return result.value;};
  assert.equal(observe('a',0).trigger,false);assert.equal(observe('b',0).trigger,false);
  const before=structuredClone(state);assert.equal(observe('unknown',null).changed,false);assert.deepEqual(state,before);
  assert.equal(observe('c',0).trigger,true);assert.equal(observe('c',0).trigger,false);assert.equal(observe('d',0).trigger,false);
  assert.equal(observe('elsewhere',1,'two').persistent,false);assert.equal(state!.buckets.one.zeroStreak,3);
  assert.equal(observe('e',0.1).persistent,false);assert.equal(observe('f',0).trigger,false);observe('g',0);assert.equal(observe('h',0).trigger,true);
  assert.equal(persistentFailure(state,{groupId:'h',primaryScore:1,profileBucket:'one'},{consecutiveFailures:3}).valid,false);
  assert.equal(persistentFailure(state,{groupId:'i',primaryScore:0,profileBucket:'one'},{consecutiveFailures:2}).valid,false);
  assert.equal(await heraProfileBucket({tags:[' Two HOP ','x','x']}),await heraProfileBucket({tags:['x','two  hop']}));
});
