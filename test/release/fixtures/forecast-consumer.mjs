import assert from 'node:assert/strict';
import {join} from 'node:path';
import {openTangleDb,createForecastStore} from '@tangleai/store';
import {forecastMust,forecastQuery,createForecastContract,createForecastReadHandlers,forecastContractDocument} from '@tangleai/forecast';
import contract from '@tangleai/forecast/schemas/contract' with {type:'json'};
import {openLocalClient} from '@jarenjs/contract/local';
import {qualifyForecastBrowser} from './forecast-browser.mjs';
import {runForecastExample} from './forecast-example.mjs';
assert.match(import.meta.resolve('@tangleai/forecast'),/\.js$/);assert.deepEqual(contract,forecastContractDocument);
const browser=await qualifyForecastBrowser();assert.equal(browser.status,'provisional');assert.equal(browser.refusal,'TFCT1008');assert.equal(browser.writes,1);
const directory=process.env.TANGLE_FIXTURE_DIRECTORY;assert.ok(directory);const path=join(directory,'forecast.sqlite');
const first=await runForecastExample(path),second=await runForecastExample(path);
assert.equal(first.resolutions,5);assert.equal(first.scoredCheckpoints,15);assert.equal(first.promotions,1);assert.equal(first.ineligible,2);assert.equal(first.logicalCalls,89);assert.equal(first.physicalRequests,0);
assert.equal(second.writes,0);assert.equal(second.logicalCalls,0);assert.equal(second.replayed,23);assert.deepEqual(second.checkedHeads,first.checkedHeads);
const db=await openTangleDb({path});try{
  const store=createForecastStore(db),question=forecastMust(await forecastQuery(store,'questions'))[0];
  const client=openLocalClient(createForecastContract(),createForecastReadHandlers({resolveHost:()=>({store,scopeKey:question.scopeKey,allowScope:()=>true})}),{validateOutput:'always'});
  const read=await client.invoke('forecast.question.get',{id:question.id});assert.ok(read.ok,JSON.stringify(read));assert.ok(read.value.ok,JSON.stringify(read));assert.equal(read.value.value.id,question.id);
  console.log(JSON.stringify({forecastInstalled:true,resolutions:first.resolutions,scored:first.scoredCheckpoints,promoted:first.promotions,refused:first.ineligible,firstCalls:first.logicalCalls,replayCalls:second.logicalCalls,readOperations:Object.keys(contract.operations).length,browser}));
}finally{await db.close();}
