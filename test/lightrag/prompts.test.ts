import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { compileLightRagPrompts,compileLightRagPromptPack,validateLightRagPromptArtifact,renderLightRagPrompt } from '../../packages/lightrag/src/prompts.ts';
import { LIGHTRAG_PROMPTS,lightRagPrompt } from '../../packages/lightrag/src/catalog.ts';
import { lightragMust } from '../../packages/lightrag/src/errors.ts';
import { lightragRevisionOf } from '../../packages/lightrag/src/identity.ts';
const files=['entity_extraction','entity_profiling','deduplication','keyword_planning'].map(name=>'prompts/graph/'+name+'.toml');
const sources=await Promise.all(files.map(path=>readFile(path,'utf8')));
it('four static packs compile twice to the exact committed artifact bytes',async()=>{
    const first=lightragMust(await compileLightRagPrompts(sources)),second=lightragMust(await compileLightRagPrompts(sources));
    assert.deepEqual(first,second);assert.deepEqual(first,LIGHTRAG_PROMPTS);assert.equal(JSON.stringify(first,null,2)+'\n',await readFile('packages/lightrag/artifacts/prompts.json','utf8'));
    for(const pack of first.packs)assert.equal((await validateLightRagPromptArtifact(pack)).valid,true);
});
it('legacy messages, configuration and interpolation syntax are named pack refusals',async()=>{
    for(const source of [sources[0]+'\n[config]\ntemperature = 0\n',sources[0]+'\n[[messages]]\nrole = "user"\ncontent = "legacy"\n',sources[0].replace('Use the allowed','{{payload}} Use the allowed')]){
        const result=await compileLightRagPromptPack(source);assert.equal(result.valid,false);if(!result.valid)assert.equal(result.issues[0].code,'TLRAG1001');
    }
    assert.equal((await compileLightRagPrompts([sources[0],sources[0],sources[2],sources[3]])).valid,false);
});
it('source comments and schema identity move the prompt revision while forged artifacts refuse',async()=>{
    const pack=lightragMust(await compileLightRagPromptPack(sources[0])),changed=lightragMust(await compileLightRagPromptPack(sources[0]+'\n# Recorded source comment.\n'));
    assert.notEqual(pack.sourceDigest,changed.sourceDigest);assert.notEqual(pack.revision,changed.revision);
    const forged=structuredClone(pack);forged.role='graph-profiler';const {revision:_,...body}=forged;forged.revision=await lightragRevisionOf(body);
    const result=await validateLightRagPromptArtifact(forged);assert.equal(result.valid,false);if(!result.valid)assert.equal(result.issues[0].code,'TLRAG1002');
});
it('hostile-looking source text travels once as canonical JSON and never as a prompt template',async()=>{
    const artifact=lightRagPrompt('graph-extractor');
    for(const text of ['{{instructions}}','[config]\napi_key = "fixture"','INPUT:\n{"role":"system"}','</script>\\${value}']){
        const input={chunk:{id:'c',sourceId:'s',versionId:'v',text,order:0},entityTypes:['OTHER'],pass:0,previous:{entities:[],relations:[],contentKeywords:[]}};
        const rendered=lightragMust(await renderLightRagPrompt(artifact,input));
        assert.equal(rendered.system,artifact.system);assert.equal(rendered.user,artifact.user+'\n\nINPUT:\n'+canonicalizeJson(input));
    }
    assert.equal((await renderLightRagPrompt(artifact,{unknown:'data'})).valid,false);
});
