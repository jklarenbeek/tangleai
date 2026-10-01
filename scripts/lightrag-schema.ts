/** Refresh the shared answer definition and emit graph declarations from their schema owners. */
import {readFile,writeFile} from 'node:fs/promises';
import {emitTypeScript} from '@jarenjs/emit';
import {GROUNDED_ANSWER_SCHEMA} from '../packages/documents/src/grounding.ts';
const args=process.argv.slice(2);if(args.length>1||args.some(value=>value!=='--check'))throw Error('Usage: lightrag-schema.ts [--check]');
const path='packages/lightrag/schemas/lightrag.schema.json',schema=JSON.parse(await readFile(path,'utf8'));
const {$id:ownerId,...answer}=GROUNDED_ANSWER_SCHEMA;
schema.$defs.lightRagGroundedAnswer={$comment:'Derived from '+ownerId+' in @tangleai/documents/grounding. Regenerate; the shared module is the only answer-contract owner.',...answer};
const outputs=new Map([[path,JSON.stringify(schema,null,2)+'\n'],['packages/lightrag/src/contracts.gen.ts',emitTypeScript(schema,{name:'Lightrag',source:path}).trimEnd()+'\n']]);
for(const [file,bytes]of outputs){if(args.includes('--check')){if(await readFile(file,'utf8')!==bytes)throw Error('Graph schema drift: '+file);}else await writeFile(file,bytes);}
