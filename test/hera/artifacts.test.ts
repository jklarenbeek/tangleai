import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {compileGmplPromptPack,renderGmplPrompt,validateGmplPromptArtifact} from '@tangleai/gmpl';
import {heraArtifacts,compileEffectivePrompt} from '@tangleai/hera';
import {heraPromptFiles} from '../../scripts/hera-sources.ts';
import {fixture} from './fixture.ts';
/** Samples satisfy the variable schema rather than bypassing the renderer. */
function sample(schema:unknown,root:unknown=schema):unknown{
  const s=schema as Record<string,unknown>;
  if(typeof s.$ref==='string'&&s.$ref.startsWith('#/$defs/'))return sample((root as {$defs:Record<string,unknown>}).$defs[s.$ref.slice(8)],root);
  if(s.const!==undefined)return s.const;
  if(Array.isArray(s.enum))return s.enum[0];
  if(Array.isArray(s.anyOf))return sample(s.anyOf[0],root);
  if(s.type==='string')return s.pattern?'a'.repeat(64):'Literal {{query}} $data';
  if(s.type==='integer'||s.type==='number')return Number(s.minimum??0);
  if(s.type==='boolean')return false;
  if(s.type==='array')return Array.from({length:Number(s.minItems??0)},()=>sample(s.items,root));
  if(s.type==='object')return Object.fromEntries(((s.required??[]) as string[]).map(k=>[k,sample((s.properties as Record<string,unknown>)[k],root)]));
  return null;
}
describe('the compiled HERA role and control packs',()=>{
  assert.equal(heraArtifacts.prompts.length,13);
  for(const [index,artifact] of heraArtifacts.prompts.entries()){
    it(`${artifact.id} minimal render and exact compilation`,async()=>{
      assert.ok((await validateGmplPromptArtifact(artifact)).valid);
      const schema=artifact.variableSchema as {required:string[]};
      const input=Object.fromEntries(schema.required.map(key=>[key,sample(artifact.variables[key].schema)]));
      const rendered=renderGmplPrompt(artifact,input);assert.ok(rendered.valid,JSON.stringify(rendered));
      assert.equal(rendered.value.system,artifact.role.instructions);
      const compiled=await compileGmplPromptPack(await readFile(heraPromptFiles()[index],'utf8'),{variables:artifact.variables,outputSchema:artifact.outputSchema});assert.ok(compiled.valid);assert.deepEqual(compiled.value,artifact);
    });
    it(`${artifact.id} full render preserves literal prompt-shaped data`,()=>{
      const input=Object.fromEntries(Object.entries(artifact.variables).map(([key,v])=>[key,key==='context'?{text:'Literal {{query}} $data'}:sample(v.schema)]));
      const rendered=renderGmplPrompt(artifact,input);assert.ok(rendered.valid,JSON.stringify(rendered));
      assert.ok(rendered.value.user.includes('Literal {{query}} $data')||artifact.id==='hera-topology-mutation');
    });
  }
});
it('effective prompt compilation preserves the role envelope and refuses a foreign envelope',async()=>{
  const f=await fixture(),prompt=f.prompts[0],artifact=f.catalog.prompt(f.agents[0].artifactId)!;
  const rendered=await compileEffectivePrompt(artifact,prompt);assert.ok(rendered.valid);assert.equal(rendered.value,prompt.effectivePrompt);
  const bad=await compileEffectivePrompt(artifact,{...prompt,envelopeRevision:'f'.repeat(64)});assert.equal(bad.valid,false);if(!bad.valid)assert.equal(bad.issues[0].code,'THERA1002');
});
it('the public HERA root imports without filesystem, database or network work',async()=>{
  const script=`import {registerHooks} from 'node:module';
    const banned=['node:fs','node:fs/promises','fs','node:sqlite','bun:sqlite','node:net','node:http','node:https','node:child_process'];
    registerHooks({resolve(specifier,context,next){if(banned.includes(specifier))throw Error('Unexpected IO import: '+context.parentURL+' -> '+specifier);return next(specifier,context)}});
    globalThis.fetch=()=>{throw Error('Unexpected network')};
    const api=await import('@tangleai/hera');if(typeof api.createMemoryHeraStore!=='function')throw Error('Missing public store');`;
  await promisify(execFile)(process.execPath,['--input-type=module','-e',script]);
});
