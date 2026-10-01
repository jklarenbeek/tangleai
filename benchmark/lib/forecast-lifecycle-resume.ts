/** Durable outcome stages reopen the same SQLite database before retrying their MAS attempt. */
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MasInfrastructureCrash } from '@tangleai/mas';
import { openTangleDb,createForecastStore,createMasStore } from '@tangleai/store';
import { FORECAST_TABLES,FORECAST_LIFECYCLE_HANDLERS,forecastQuery,forecastMust,forecastRevision } from '@tangleai/forecast';
import { loadForecastFixtures } from './forecast-fixtures.ts';
import { fixtureForecastHost,type ForecastScriptCounter } from './forecast-host-fixture.ts';
import { fixtureForecastOutcome,fixtureForecastResolution } from './forecast-lifecycle-fixture.ts';
export const FORECAST_LIFECYCLE_RESUME_STAGES = [...FORECAST_LIFECYCLE_HANDLERS,...FORECAST_LIFECYCLE_HANDLERS.map(stage=>'mas:'+stage)] as const;
export async function driveForecastLifecycleResume(path: string,stop?: string) {
  const fixture=await loadForecastFixtures(),counters:ForecastScriptCounter[]=[];let instant=fixture.questions[0].issuedAt,leaseClock=1_000_000,stopped=false,crashes=0,duplicates=0;
  const open=()=>openTangleDb({path,jobs:{now:()=>leaseClock,random:()=>.5}});let db=await open();
  try{
    for(const [questionIndex,registered] of fixture.questions.slice(0,2).entries()){
      instant=registered.issuedAt;const store=createForecastStore(db),outcome=await fixtureForecastOutcome({db,store,fixture,scopeKey:registered.scopeKey,instant:()=>instant});
      const f=await fixtureForecastHost({db,fixture,questionIndex,forecastStore:store,counters,evolving:true,instant:()=>instant,outcomeHost:()=>outcome,outcomeAdmission:outcome});
      for(const cp of registered.checkpoints){instant=cp.scheduledAt;const tick=await f.host.tick(instant);assert.deepEqual(tick.failed,[]);assert.deepEqual(tick.refused,[]);}
      instant=fixture.resolutions[questionIndex].observedAt;
      const crash=(stage:string)=>{if(questionIndex===1&&stage===stop&&!stopped){stopped=true;throw new MasInfrastructureCrash('Stop after committed '+stage);}};
      for(let attempt=0;;attempt++){
        assert.ok(attempt<3,'bounded outcome stage recovery');
        try{
          const currentStore=createForecastStore(db),host=await fixtureForecastOutcome({db,store:currentStore,fixture,scopeKey:registered.scopeKey,instant:()=>instant}),base=createMasStore(db,{now:()=>instant});
          const masStore={...base,async commitNodeCompletion(...args:Parameters<typeof base.commitNodeCompletion>){const result=await base.commitNodeCompletion(...args);if(result.ok)crash('mas:'+result.value.attempt.invocationId);return result;}};
          const done=await fixtureForecastResolution({db,fixture,host,masStore,question:f.question,registeredId:registered.id,instant:()=>instant,counters,afterStage:stage=>crash(stage)});assert.ok(done);
          const priorCalls=counters.reduce((n,c)=>n+c.calls(),0),prior=await Promise.all(FORECAST_TABLES.map(t=>forecastQuery(currentStore,t)));
          assert.equal(forecastMust(await done.lifecycle.deliver(done.request)).duplicate,true);duplicates++;await done.lifecycle.drain();
          assert.equal(counters.reduce((n,c)=>n+c.calls(),0),priorCalls);assert.deepEqual(await Promise.all(FORECAST_TABLES.map(t=>forecastQuery(currentStore,t))),prior);
          break;
        }catch(error){if(!(error instanceof MasInfrastructureCrash))throw error;crashes++;leaseClock+=300000;await db.close();db=await open();}
      }
    }
    const store=createForecastStore(db),host=await fixtureForecastOutcome({db,store,fixture,scopeKey:fixture.questions[0].scopeKey,instant:()=>instant});
    const records=Object.fromEntries(await Promise.all(FORECAST_TABLES.map(async table=>[table,forecastMust(await forecastQuery(store,table))]))),outcomes=await host.history(),head=await host.checked(),logicalCalls=counters.reduce((n,c)=>n+c.calls(),0),physicalCalls=counters.reduce((n,c)=>n+c.physicalCalls(),0);
    assert.equal(logicalCalls,30);assert.equal(physicalCalls,0);assert.equal(head!.head.revision,1);assert.equal((await db.integrityCheck()).ok,true);
    return {artifactDigest:await forecastRevision({records,outcomes,head,logicalCalls,physicalCalls}),logicalCalls,physicalCalls,crashes,duplicates};
  }finally{await db.close();}
}
export async function measureForecastLifecycleResume() {
  const directory=await mkdtemp(join(tmpdir(),'forecast-lifecycle-resume-'));
  try{
    const baseline=await driveForecastLifecycleResume(join(directory,'baseline.db')),stages=[];
    for(const stage of FORECAST_LIFECYCLE_RESUME_STAGES){const r=await driveForecastLifecycleResume(join(directory,stage.replace(':','-')+'.db'),stage);assert.equal(r.artifactDigest,baseline.artifactDigest,stage);assert.equal(r.crashes,1,stage);stages.push({stage,stops:r.crashes,extraCalls:r.logicalCalls-baseline.logicalCalls,artifactDigest:r.artifactDigest});}
    return {...baseline,stages};
  }finally{await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:50});}
}
