import assert from 'node:assert/strict';
import { createGmplCatalog } from '@tangleai/gmpl';
import { createMasRegistrySnapshot } from '@tangleai/mas';
import { heraArtifacts, createHeraAgents, heraRegistryDocument, heraContentIdOf, heraLibraryRevisionOf,
  emptyHeraHead, planPromptActivation, planSnapshotActivation, planLibraryActivation, heraRevisionOf,
  type HeraStore, type HeraLearningConfig, type HeraLearningSnapshot, type HeraExperience } from '@tangleai/hera';
export const scope = 'fixture', authority = {scope,mode:'learn' as const}, at = '2020-01-01T00:00:00.000Z';
export const config: HeraLearningConfig = {groupSize:3,maxAgents:5,selectorVersion:'mmr-v1',selectorWeights:{similarity:1,utility:0.5,novelty:0.25,selectionPenalty:0.1},selectorCap:4,libraryCap:32,operationCap:8,failureBufferSize:8,consecutiveFailures:3,variantAxes:['efficiency','thoroughness'],promptBounds:{maxRules:16,maxBytes:8192,maxOps:16},flags:{experience:true,rope:true,mutation:true}};
export async function fixture() {
  const catalog = await createGmplCatalog(heraArtifacts); assert.ok(catalog.valid);
  const created = await createHeraAgents(catalog.value,{scope,profile:'scripted',at}); assert.ok(created.valid);
  const registry = await heraRegistryDocument(catalog.value,{agents:created.value.agents}); assert.ok(registry.valid);
  const pinned = await createMasRegistrySnapshot(registry.value); assert.ok(pinned.valid);
  const content = {scope,parentId:null,activePromptVersionIds:Object.fromEntries(created.value.prompts.map(p=>[p.agentId,p.id])),libraryRevision:await heraLibraryRevisionOf([]),experienceIds:[],registryRevision:pinned.value.revision,
    identities:{model:'scripted/hera-fixture',decoder:await heraRevisionOf({temperature:0}),tools:['hera-evidence'],corpusRevision:'c'.repeat(64),embeddedBy:{model:'test',dims:2},evaluator:{id:'fixture-exact',version:'1',successRuleId:'exact-v1'}},config,status:'staged' as const};
  const snapshot: HeraLearningSnapshot = {...content,id:await heraContentIdOf(content)};
  const entry = {scope,profile:{text:'question',tags:[],embedding:[1,0],embeddedBy:{model:'test',dims:2}},insight:'Cite the visible record.',insightEmbedding:[1,0],provenance:{advantageId:'fixture-advantage',groupId:'fixture-group'},useCount:0,successCount:0,utility:0,selectionCount:0,status:'active' as const,parents:[],inheritedCounts:null};
  const experience: HeraExperience = {...entry,id:await heraContentIdOf(entry)};
  return {...created.value,catalog:catalog.value,registry:pinned.value,snapshot,experience};
}
export async function lifecycle(store: HeraStore) {
  const f = await fixture();
  const seeded = await store.transaction(authority,async tx => {
    for (const agent of f.agents) await tx.put('agent',agent);
    for (const prompt of f.prompts) {
      await tx.put('promptVersion',prompt);
      const head = emptyHeraHead(scope,'prompt',prompt.agentId);
      const plan = planPromptActivation(head,head,prompt); assert.ok(plan.valid);
      await tx.transitionHead(plan.value);
    }
    await tx.put('snapshot',f.snapshot);
    const head = emptyHeraHead(scope,'snapshot'), plan = planSnapshotActivation(head,head,f.snapshot); assert.ok(plan.valid);
    await tx.transitionHead(plan.value);
    await tx.put('experience',f.experience);
    const library = emptyHeraHead(scope,'library');
    const next = planLibraryActivation(library,library,await heraLibraryRevisionOf([f.experience.id])); assert.ok(next.valid);
    await tx.transitionHead(next.value);
    return true;
  }); assert.ok(seeded.valid,JSON.stringify(seeded));
  const repeated = await store.put('experience',f.experience,authority); assert.ok(repeated.valid); assert.equal(repeated.value.written,false);
  return {prompts:await store.listPromptVersions({agentId:'retriever',scope}),snapshots:await store.listSnapshots({scope}),experiences:await store.listExperiences({scope,status:'active'}),head:await store.readHead(emptyHeraHead(scope,'snapshot').id),counters:store.counters()};
}
