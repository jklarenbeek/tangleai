import {it} from 'node:test';
import assert from 'node:assert/strict';
import {nodeDriver} from '@jarenjs/db/node';
import {createDesktop} from '../../apps/desktop/src/server.ts';
import {DESKTOP_CONTRACT} from '../../apps/desktop/src/contract.ts';
import {GRAPH_QUESTION,lightRagDesktop,graphCall,retainedReadState} from '../fixtures/lightrag-desktop.ts';

it('experimental graph reads validate all four modes without persisting chats, runs or identities',async()=>{
    const {desktop,requests}=await lightRagDesktop();
    try{
        const before=await retainedReadState(desktop),status=await graphCall(desktop,'/api/lightrag/status');
        assert.equal(status.status,200,JSON.stringify(status));assert.equal(status.value.status,'ok');assert.equal(status.value.experimental,true);
        assert.deepEqual(status.value.graph,{entities:2,relations:1,claims:3});assert.equal(status.value.projections.length,2);
        assert.match(status.value.graphRevision,/^[a-f0-9]{64}$/);assert.deepEqual(status.value.embeddedBy,[{model:'hash-trigram-32',dims:32}]);
        for(const mode of ['low','high','hybrid','hybrid-no-original']){
            const result=await graphCall(desktop,'/api/lightrag/retrieve?'+new URLSearchParams({q:GRAPH_QUESTION,mode,limit:'2'}));
            assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.value.status,'ok',JSON.stringify(result.value));
            assert.equal(result.value.experimental,true);assert.equal(result.value.mode,mode);assert.equal(result.value.graphRevision,status.value.graphRevision);
            assert.equal(result.value.plan.limits.candidatesPerKeyword,2);assert.equal(result.value.citations.length,1);
            assert.equal(result.value.citations[0].url,'https://docs.example/graph-example');assert.match(result.value.sections.entities,/Cedar Guild/);
            assert.equal(result.value.sections.chunks==='',mode==='hybrid-no-original');assert.equal(result.value.spend.calls,mode==='low'||mode==='high'?1:2);
        }
        assert.equal(requests(),6);assert.deepEqual(await retainedReadState(desktop),before);
    }finally{await desktop.close();}
});
it('graph reads refuse invalid inputs at the boundary and bad settings as named data without calls',async()=>{
    let calls=0;const desktop=await createDesktop({driver:nodeDriver(),fetch:async()=>{calls++;throw Error('No provider registered.');}});
    try{
        for(const query of ['q=&mode=low','q=x&mode=unknown','q=x&mode=low&limit=0','q=x&mode=low&limit=51'])
            assert.equal((await graphCall(desktop,'/api/lightrag/retrieve?'+query)).status,400,query);
        const missing=await graphCall(desktop,'/api/lightrag/retrieve?q=x&mode=low');
        assert.equal(missing.status,200,JSON.stringify(missing));assert.equal(missing.value.status,'refused');assert.equal(missing.value.issues[0].code,'TLRAG1008');
        const saved=await desktop.dispatcher.dispatch({method:'POST',url:'/api/settings',headers:{'content-type':'application/json'},body:JSON.stringify({settings:{profile:'missing-profile'}})});
        assert.equal(saved.status,200);const before=await retainedReadState(desktop),refused=await graphCall(desktop,'/api/lightrag/retrieve?q=x&mode=hybrid');
        assert.equal(refused.status,200,JSON.stringify(refused));assert.equal(refused.value.status,'refused');assert.match(refused.value.issues[0].code,/^TCFG/);
        assert.equal(refused.value.spend.calls,0);assert.equal(calls,0);assert.deepEqual(await retainedReadState(desktop),before);
    }finally{await desktop.close();}
});
it('the graph surface adds exactly two non-streaming reads',()=>{
    const operations=Object.entries(DESKTOP_CONTRACT.operations).filter(([name])=>name.startsWith('lightrag.'));
    assert.deepEqual(operations.map(([name])=>name),['lightrag.status','lightrag.retrieve']);
    for(const [,operation]of operations){assert.equal(operation.kind,'read');assert.ok('policy'in operation);assert.equal(operation.policy?.idempotency,'none');assert.equal(operation.http?.method,'GET');assert.equal('stream'in operation,false);}
    assert.deepEqual(Object.entries(DESKTOP_CONTRACT.operations).filter(([,operation])=>operation.kind==='subscribe').map(([name])=>name),['research.runs.live','runs.live','run.live']);
});
