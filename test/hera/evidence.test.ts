import {it} from 'node:test';import assert from 'node:assert/strict';
import {openTangleDb} from '@tangleai/store';
import {validateHeraAnswer,validateHeraEvidenceUnits,createHeraMemoryEvidenceProvider,assertHeraCorpus,createHeraEvidenceTool} from '@tangleai/hera';
import {validateClaimEvidence} from '@tangleai/context';
import {createHeraFixtureEvidence} from '../../benchmark/lib/hera-runner.ts';
import {loadHeraFixture} from '../../benchmark/lib/hera-qa.ts';
it('native document retrieval keeps exact digests, bounded results and superseded corpus refusal',async()=>{
  const db=await openTangleDb();try{
    const fixture=await loadHeraFixture(),host=await createHeraFixtureEvidence(db,fixture.corpus,fixture.manifest.revision),signal=new AbortController().signal;
    const units=await host.evidence.recall('Where did Mira move?',{k:2,signal});assert.equal(units.length,2);assert.ok((await validateHeraEvidenceUnits(units)).valid);assert.ok(units.every(u=>u.address.startsWith('document:hera-fixture/')));
    const source=(await host.documents.getSource('hera-fixture'))!;await host.documents.putSource({...source,activeVersionId:'superseded'});
    assert.equal((await assertHeraCorpus(host.evidence,fixture.manifest.revision)).valid,false);await assert.rejects(host.evidence.recall('Mira',{k:2,signal}),/superseded/);
  }finally{await db.close();}
});
it('native memory retrieval excludes other identities and superseded memories',async()=>{
  const unit={id:'live',text:'Native evidence',evidence:'e',tags:[],at:'2020',kind:'fact' as const,embedding:[1,0],embeddedBy:{model:'fixture',dims:2}};
  const provider=createHeraMemoryEvidenceProvider({units:async()=>[unit,{...unit,id:'foreign',embeddedBy:{model:'foreign',dims:2}},{...unit,id:'old',supersededBy:'live'}],embedder:{model:'fixture',dims:2,embed:async()=>[new Float32Array([1,0])]},corpusRevision:'v1',currentCorpusRevision:()=> 'v1',revision:'memory/v1'});
  assert.deepEqual((await provider.recall('Native',{k:4,signal:new AbortController().signal})).map(u=>u.id),['live']);
});
it('citation checking counts forged evidence and preserves a valid claim envelope and abstention',async()=>{
  const fixture=await loadHeraFixture(),unit={...fixture.corpus[0],address:'fixture:p01'},citation={id:unit.id,digest:unit.digest};
  assert.equal((await validateHeraEvidenceUnits([{...unit,digest:'a'.repeat(64)}])).valid,false);
  assert.equal((await validateHeraEvidenceUnits([unit,unit])).valid,false);
  const checked=await validateHeraAnswer({answer:'Mira',disposition:'completed',claims:[{text:'Mira',citations:[citation,{id:'invented',digest:'b'.repeat(64)}]}],findings:[]},[unit]);
  assert.equal(checked.citationRecall,.5);assert.equal(checked.unsupported[0].code,'THERA1005');assert.deepEqual(checked.citations,[citation]);assert.ok(validateClaimEvidence(checked.envelope).valid);
  const abstained=await validateHeraAnswer({answer:'Unknown',disposition:'needs-information',claims:[],findings:[]},[]);assert.equal(abstained.citationRecall,1);assert.deepEqual(abstained.unsupported,[]);
});
it('evidence tools forward the runtime key and refuse superseded pins before recall',async()=>{
  let current='v1',calls=0,key:unknown;const tool=createHeraEvidenceTool({revision:'tool/v1',currentCorpusRevision:()=>current,recall:async(_q,o)=>{calls++;key=o.idempotencyKey;return [];}},'v1');
  const context={signal:new AbortController().signal,idempotencyKey:'runtime-owned-key'};
  assert.deepEqual(await tool.handler({query:'x',k:2},context),{units:[]});assert.equal(key,context.idempotencyKey);current='v2';
  const stale=await tool.handler({query:'x',k:2},context) as {valid:boolean};assert.equal(stale.valid,false);assert.equal(calls,1);
});
