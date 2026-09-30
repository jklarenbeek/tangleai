import {it} from 'node:test';import assert from 'node:assert/strict';
import {assignFailureCredit,createHeraLearner,createHeraGroupRunner,heraContentIdOf,type HeraTrajectoryStep} from '@tangleai/hera';
import {learningFixture} from './learning-fixture.ts';
it('failure credit creates bounded immutable role buffers and never admits successful trajectories',async()=>{
  const f=await learningFixture({failNode:'b'});try{
    const {host,request}=f.build(),input={...request,mode:'learn' as const,task:{...request.task,split:'training' as const}},learned=await createHeraLearner(host).run(input);assert.ok(learned.valid);
    const result=await createHeraGroupRunner(host).run(input);assert.ok(result.valid);
    const advantage=(await host.store.getAdvantage(learned.value.advantageId!))!,steps=await Promise.all(result.value.trajectories.flatMap(t=>t.stepIds).map(id=>host.store.getTrajectoryStep(id))) as HeraTrajectoryStep[];
    const evidence={...result.value,steps},planned=await assignFailureCredit(advantage,evidence,[],2);assert.ok(planned.valid,JSON.stringify(planned));assert.equal(planned.value.versions.length,1);
    const buffer=planned.value.buffers[0];assert.equal(buffer.agentId,'retriever');assert.equal(buffer.entries[0].trajectoryId,advantage.failedInvocationCredit[0].trajectoryId);
    const replay=await assignFailureCredit(advantage,evidence,[buffer],2);assert.ok(replay.valid);assert.equal(replay.value.versions.length,0);assert.deepEqual(replay.value.buffers,[buffer]);
    const older={...buffer,entries:[{...buffer.entries[0],trajectoryId:'older',invocationId:'older'},...buffer.entries]};older.id=await heraContentIdOf(older);
    const bounded=await assignFailureCredit(advantage,evidence,[older],1);assert.ok(bounded.valid);assert.equal(bounded.value.buffers[0].entries.length,1);assert.equal(bounded.value.buffers[0].parentId,older.id);assert.equal(older.entries.length,2);
    const success=result.value.trajectories.find(t=>t.success)!,invalid={...advantage,failedInvocationCredit:[{...advantage.failedInvocationCredit[0],trajectoryId:success.id}]};invalid.id=await heraContentIdOf(invalid);
    const refused=await assignFailureCredit(invalid,evidence,[buffer],2);assert.equal(refused.valid,false);if(!refused.valid)assert.equal(refused.issues[0].path,'/failedInvocationCredit/0/trajectoryId');
    const saved=await host.store.putFailureBuffer(buffer,{scope:host.store.scope,mode:'learn'});assert.ok(saved.valid);assert.deepEqual(await host.store.getFailureBuffer(buffer.id),buffer);
    const forbidden=await host.store.putFailureBuffer(buffer,{scope:host.store.scope,mode:'evaluate'});assert.equal(forbidden.valid,false);if(!forbidden.valid)assert.equal(forbidden.issues[0].code,'THERA1004');
  }finally{await f.close();}
});
