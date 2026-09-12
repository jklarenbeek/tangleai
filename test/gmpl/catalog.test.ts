import {it} from 'node:test';
import assert from 'node:assert/strict';
import {gmplArtifacts,createGmplCatalog,gmplCatalogDocument,createGmplDomainBinding,gmplSchemaOf} from '@tangleai/gmpl';
it('catalog admission is detached, immutable and identity checked',async()=>{
  const original=structuredClone(gmplArtifacts),outcome=await createGmplCatalog(original);assert.ok(outcome.valid);
  original.prompts[0].pack.system.content='changed';assert.notEqual(outcome.value.document.prompts[0].pack.system.content,'changed');
  assert.ok(Object.isFrozen(outcome.value.document.prompts[0].pack));
  assert.equal(outcome.value.prompt('unknown'),undefined);
  assert.ok(!(await createGmplCatalog(original)).valid);
  const domain=await createGmplDomainBinding({id:'unknown-stage',title:'Unknown',payloadSchema:gmplSchemaOf('gmplInput'),projection:{id:'text',version:'1',kind:'text',scale:null},rolePrompts:{review:'unknown'},requiredCapabilities:[]});assert.ok(domain.valid);
  const invalid=await createGmplCatalog(await gmplCatalogDocument({id:'unknown-stage',prompts:gmplArtifacts.prompts as never,domains:[domain.value],recipes:[]}));assert.ok(!invalid.valid);assert.equal(invalid.issues[0].code,'TGMPL1003');
});
