import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createCandidateResolver,createScriptedCoreferenceJudge,checkCoreferencePartition } from '../../packages/lightrag/src/resolve.ts';
import { lightRagPrompt } from '../../packages/lightrag/src/catalog.ts';
import { graphClaim,graphEntity } from '../fixtures/lightrag-records.ts';
const modelIdentity={provider:'fixture',model:'scripted'},promptRevision=lightRagPrompt('graph-deduplicator').revision;
const empty=()=>({claims:{entities:[],relations:[]},canonicals:{entities:[],relations:[]}});
it('candidate lookup precedes alias review and the reason binds the exact claims without vector input',async()=>{
    const first=await graphClaim('Cedar'),existing=await graphEntity(first),alias=await graphClaim('ＣＥＤＡＲ',{source:'b',description:'Cedar keeps the equipment register.'}),events:string[]=[];
    const judge=createScriptedCoreferenceJudge(input=>{events.push('judge');for(const subject of input.subjects)assert.equal(Object.hasOwn(subject,'embedding'),false);return {groups:[input.subjects.map(row=>row.id)],reasons:['One evidenced organization with two spellings.']};},{modelIdentity,promptRevision});
    const resolver=createCandidateResolver({judge,lookup:async request=>{events.push('lookup');assert.deepEqual(request.normalizedNames,['cedar']);return {claims:{entities:[first],relations:[]},canonicals:{entities:[existing],relations:[]}};}});
    const result=await resolver({claims:[alias]});assert.equal(result.valid,true);assert.deepEqual(events,['lookup','judge']);
    if(result.valid){assert.equal(result.value.groups.length,1);assert.equal(result.value.groups[0].id,existing.id);assert.deepEqual(result.value.groups[0].claimIds,[first.id,alias.id].sort());assert.equal(result.value.reviews[0].decision,'merge');assert.match(result.value.reviews[0].reason,/two spellings/);assert.equal(result.value.decisions,1);}
});
it('the judge is never called without a fold and type collision requiring review',async()=>{
    let calls=0;const judge=createScriptedCoreferenceJudge(()=>{calls++;throw Error('Unexpected review.');},{modelIdentity,promptRevision});
    const resolver=createCandidateResolver({judge,lookup:async()=>empty()});
    const claims=[await graphClaim('Beacon',{type:'LOCATION'}),await graphClaim('Beacon',{type:'CONCEPT',ordinal:1}),await graphClaim('Cedar',{ordinal:2}),await graphClaim('CEDAR',{ordinal:3})];
    const result=await resolver({claims});assert.equal(result.valid,true);if(result.valid){assert.equal(result.value.groups.length,3);assert.equal(result.value.decisions,0);}assert.equal(calls,0);
});
it('same-name same-type homonyms remain separate under an exhaustive claim-id decision',async()=>{
    const a=await graphClaim('Cedar'),b=await graphClaim('Cedar',{source:'b',description:'A separate organization in another town.'});
    const judge=createScriptedCoreferenceJudge(input=>({groups:input.subjects.map(row=>[row.id]),reasons:input.subjects.map(row=>row.description)}),{modelIdentity,promptRevision});
    const result=await createCandidateResolver({judge,lookup:async()=>empty()})({claims:[a,b]});assert.equal(result.valid,true);
    if(result.valid){assert.equal(result.value.groups.length,2);assert.equal(new Set(result.value.groups.map(row=>row.id)).size,2);assert.equal(result.value.groups.filter(row=>row.identityClaimId).length,1);assert.equal(result.value.reviews[0].decision,'keep-apart');}
});
it('co-reference partitions cannot repeat, omit, invent or split already merged claim identities',async()=>{
    const a=await graphClaim('Cedar'),b=await graphClaim('CEDAR',{ordinal:1}),row=await graphEntity(a);
    const input={subjects:[a,b].map(claim=>({id:claim.id,name:claim.name,type:claim.type,description:claim.description,canonicalId:row.id}))};
    for(const groups of [[[a.id]],[[a.id,b.id,a.id]],[[a.id,'f'.repeat(64)]],[[a.id],[b.id]]])assert.equal(checkCoreferencePartition(input,{groups,reasons:groups.map(()=> 'Registered reason.')}).valid,false);
});
it('the decision ceiling refuses before another judge call and returns a serializable failure',async()=>{
    let calls=0;const a=await graphClaim('Cedar'),b=await graphClaim('CEDAR',{ordinal:1,description:'A separate attributed role.'});
    const judge=createScriptedCoreferenceJudge(input=>{calls++;return {groups:[input.subjects.map(row=>row.id)],reasons:['Same organization.']};},{modelIdentity,promptRevision});
    const result=await createCandidateResolver({judge,lookup:async()=>empty(),maxDecisions:0})({claims:[a,b]});
    assert.equal(result.valid,false);if(!result.valid)assert.equal(result.issues[0].code,'TLRAG1005');assert.equal(calls,0);assert.deepEqual(JSON.parse(JSON.stringify(result)),result);
});
