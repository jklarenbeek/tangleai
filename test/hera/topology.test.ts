import {it} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {projectMasPlan} from '@tangleai/mas';
import {validateHeraTopology,toMasWorkflow,heraConfigCatalog,HERA_DEFAULT_LIMITS,validateHeraRecord,type HeraBudget,type HeraTopology} from '@tangleai/hera';
import {fixture} from './fixture.ts';
import analytic from '../../benchmark/fixtures/hera/topologies.json' with {type:'json'};
export const groupBudget:HeraBudget={calls:24,tokens:65536,ms:120000,turns:6,nodes:15,depth:15,fanOut:12,concurrency:4};
export async function topologyFixture(kind='serial'){
  const f=await fixture(),source=analytic.find(t=>t.id===kind)!;
  const topology:HeraTopology={id:kind,scope:f.snapshot.scope,taskId:'q',snapshotId:f.snapshot.id,profile:f.experience.profile,
    nodes:source.nodes.map(n=>({id:n.id,agentId:n.roleId,dependsOn:n.dependsOn,promptVersionId:f.snapshot.activePromptVersionIds[n.roleId]})),
    offeredExperienceIds:[],appliedExperienceIds:[],generator:{kind:'orchestrator',configRevision:'a'.repeat(64)},validation:{valid:true,issues:[]},workflowVersionId:null};
  return {...f,topology};
}
it('analytic serial, parallel and repeated-role invocation graphs all compile and plan through MAS',async()=>{
  const config=await heraConfigCatalog('scripted',{...HERA_DEFAULT_LIMITS});assert.ok(config.valid);
  for(const kind of ['serial','parallel','repeated-role']){
    const f=await topologyFixture(kind),check=validateHeraTopology(f.topology,f.snapshot,f,groupBudget);assert.ok(check.valid,JSON.stringify(check));
    const compiled=await toMasWorkflow(f.topology,f.snapshot,{...f,config:config.value},groupBudget);assert.ok(compiled.valid,JSON.stringify(compiled));
    const diagram=projectMasPlan(compiled.value.plan);
    assert.deepEqual(diagram.regions.map(r=>r.mermaid),JSON.parse(await readFile(new URL('./fixtures/'+kind+'.mermaid.json',import.meta.url),'utf8')));
    const repeated=await toMasWorkflow(f.topology,f.snapshot,{...f,config:config.value},groupBudget);assert.ok(repeated.valid);
    assert.deepEqual(projectMasPlan(repeated.value.plan),diagram);
    assert.equal(compiled.value.validated.workflow.nodes.filter(n=>n.kind==='agent').length,f.topology.nodes.length);
    assert.deepEqual(compiled.value.validated.workflow.messages.filter(m=>m.to.node!=='hera-validate-'+kind.slice(0,12)).map(m=>[m.from.node,m.to.node]),
      f.topology.nodes.flatMap(n=>n.dependsOn.map(d=>[d,n.id])));
  }
});
it('registered negative topology fixtures retain their exact semantic refusal pointers',async()=>{
  const cases=[['cyclic-depends-on','/nodes/0/dependsOn/0'],['duplicate-node-id','/nodes/1/id'],['tool-not-allowlisted','/nodes/1/tools/0'],['applied-not-offered','/appliedExperienceIds/0']] as const;
  for(const [id,path] of cases){
    const negative=JSON.parse(await readFile(new URL('../../benchmark/fixtures/hera/negative/'+id+'.json',import.meta.url),'utf8'));
    const f=await topologyFixture(id==='cyclic-depends-on'?'back-edge':'serial'),topology=structuredClone(f.topology);
    if(id==='duplicate-node-id')topology.nodes[1].id=topology.nodes[0].id;
    if(id==='tool-not-allowlisted')topology.nodes[1].tools=negative.input.tools;
    if(id==='applied-not-offered')topology.appliedExperienceIds=negative.input.appliedExperienceIds;
    const result=validateHeraTopology(topology,f.snapshot,f,groupBudget);assert.equal(result.valid,false);
    if(!result.valid){assert.equal(result.issues[0].code,negative.expectedCode);assert.equal(result.issues[0].path,path);topology.validation={valid:false,issues:result.issues};}
    assert.ok((await validateHeraRecord('topology',topology)).valid,'An invalid survivor must remain retainable');
  }
});
it('unknown roles, prompts, disconnected terminals and structural caps never reach MAS',async()=>{
  const f=await topologyFixture();
  for(const change of [(t:HeraTopology)=>{t.nodes[0].agentId='shell';},(t:HeraTopology)=>{t.nodes[1].promptVersionId='stale';},(t:HeraTopology)=>{t.nodes[2].dependsOn=[];}]){
    const t=structuredClone(f.topology);change(t);assert.equal(validateHeraTopology(t,f.snapshot,f,groupBudget).valid,false);
  }
  assert.equal(validateHeraTopology(f.topology,f.snapshot,f,{...groupBudget,depth:2}).valid,false);
  assert.equal(validateHeraTopology(f.topology,f.snapshot,f,{...groupBudget,nodes:2}).valid,false);
});
