/** Emit the composed evidence contract and its declarations from their owners. */
import {readFile,writeFile} from 'node:fs/promises';
import {emitTypeScript} from '@jarenjs/emit';
import {HERA_SCHEMA} from '../packages/hera/src/schema-definition.ts';
const args=process.argv.slice(2);if(args.length>1||args.some(a=>a!=='--check'))throw Error('usage: hera-schema.ts [--check]');
const outputs=new Map([
  ['packages/hera/schemas/hera.schema.json',JSON.stringify(HERA_SCHEMA,null,2)+'\n'],
  ['packages/hera/src/contracts.gen.ts',emitTypeScript(HERA_SCHEMA,{name:'Hera',source:'packages/hera/schemas/hera.schema.json'}).trimEnd()+'\n'],
]);
for(const [path,content] of outputs){if(args.includes('--check')){if(await readFile(path,'utf8')!==content)throw Error('HERA contract drift: '+path);}else await writeFile(path,content);}
