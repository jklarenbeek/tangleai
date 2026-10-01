/** Hosts compile graph prompt sources; runtime imports immutable JSON only. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { compileLightRagPrompts } from '../packages/lightrag/src/prompts.ts';
import { lightragMust } from '../packages/lightrag/src/errors.ts';
const args=process.argv.slice(2);
if(args.length>1||args.some(value=>value!=='--check'))throw Error('Usage: lightrag-prompts.ts [--check]');
const paths=['entity_extraction','entity_profiling','deduplication','keyword_planning'].map(name=>'prompts/graph/'+name+'.toml');
const catalog=lightragMust(await compileLightRagPrompts(await Promise.all(paths.map(path=>readFile(path,'utf8')))));
const path='packages/lightrag/artifacts/prompts.json',bytes=JSON.stringify(catalog,null,2)+'\n';
if(args.includes('--check')){if(await readFile(path,'utf8')!==bytes)throw Error('Graph prompt artifact drift.');}
else{await mkdir('packages/lightrag/artifacts',{recursive:true});await writeFile(path,bytes);}
console.log('Graph prompts: '+catalog.packs.length+' static packs; '+catalog.packs.map(pack=>pack.revision.slice(0,12)).join(' '));
