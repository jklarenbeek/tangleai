/** The only filesystem prompt build. Installed consumers read immutable JSON. */
import {readFile,writeFile,glob} from 'node:fs/promises';
import {compileGmplPromptPack} from '../packages/gmpl/src/prompts.ts';
import {gmplSchemaOf} from '../packages/gmpl/src/schema.ts';
import {gmplCatalogDocument,createGmplCatalog,createGmplRecipe} from '../packages/gmpl/src/catalog.ts';
import {GMPL_STAGES} from '../packages/gmpl/src/defaults.ts';
import type {GmplPromptArtifact,GmplVariables,GmplPatternRecipe} from '../packages/gmpl/src/contracts.gen.ts';
const args=process.argv.slice(2);if(args.some(a=>a!=='--check')||args.length>1)throw Error('usage: gmpl-artifacts.ts [--check]');
const files:string[]=[];for await(const p of glob('prompts/gmpl/**/*.toml'))if(!p.includes('/outcome/'))files.push(p);
files.sort();if(files.length!==14)throw Error(`expected fourteen in-scope packs, found ${files.length}`);
const variables:GmplVariables={query:{schema:{type:'string',minLength:1},render:'text'},evidence:{schema:{type:'array',items:gmplSchemaOf('gmplEvidenceUnit')},render:'json'},context:{schema:{type:'object'},render:'json'}};
const prompts:GmplPromptArtifact[]=[];
for(const file of files){
  const stage=file.split('/').slice(-2).join('-').replace('.toml','');
  const artifact=await compileGmplPromptPack(await readFile(file,'utf8'),{variables,outputSchema:gmplSchemaOf(stage as Parameters<typeof gmplSchemaOf>[0])});
  if(!artifact.valid)throw Error(`${file}: ${JSON.stringify(artifact.issues)}`);prompts.push(artifact.value);
}
const recipes:GmplPatternRecipe[]=[];
for(const pattern of ['parallel-analysis','peer-review','red-team','structured-debate','clarification','delphi-panel'] as const){
  const recipe=await createGmplRecipe({id:pattern,parameters:{pattern},scope:'pattern',stages:[...GMPL_STAGES[pattern]]});if(!recipe.valid)throw Error(JSON.stringify(recipe.issues));recipes.push(recipe.value);
}
const document=await gmplCatalogDocument({id:'gmpl-default',prompts,domains:[],recipes});
const checked=await createGmplCatalog(document);if(!checked.valid)throw Error(JSON.stringify(checked.issues));
const path='packages/gmpl/artifacts/catalog.json',bytes=JSON.stringify(document,null,2)+'\n';
if(args.includes('--check')){if(await readFile(path,'utf8')!==bytes)throw Error('GMPL artifact drift');}else await writeFile(path,bytes);
console.log(`GMPL: ${prompts.length} JOSL→JTLT artifacts; ${document.revision}`);
