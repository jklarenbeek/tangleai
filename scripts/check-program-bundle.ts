/** The standalone program pen stays independent of engines and model mechanisms; the assistant's script entries are measured beside it. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, config, isMain, readJson, writeJson } from './release/common.ts';

/** Bundle one probe entry for the browser; `retained` lists inputs that reached the output, `all` every file the bundler parsed. */
export function measureEntryBundle({ directory, source, forbidden, scope }: { directory: string, source: string, forbidden: RegExp, scope: 'retained' | 'all' }) {
  const temporary = mkdtempSync(resolve(directory, '.bundle-probe-'));
  try {
    writeFileSync(resolve(temporary,'entry.js'), source);
    execFileSync('bun', ['build',resolve(temporary,'entry.js'),'--target=browser','--format=esm','--minify',`--outfile=${resolve(temporary,'bundle.js')}`,`--metafile=${resolve(temporary,'meta.json')}`], {cwd:directory,stdio:['ignore','pipe','pipe']});
    const meta = JSON.parse(readFileSync(resolve(temporary,'meta.json'),'utf8'));
    const names = scope === 'all' ? Object.keys(meta.inputs)
      : Object.entries((Object.values(meta.outputs)[0] as {inputs:Record<string,{bytesInOutput:number}>}).inputs).filter(([,value]) => value.bytesInOutput > 0).map(([name])=>name);
    const inputs = names.map(name => name.replaceAll('\\','/'));
    return { bytes: readFileSync(resolve(temporary,'bundle.js')).length, inputs, forbidden: inputs.filter(name => forbidden.test(name)) };
  } finally { rmSync(temporary,{recursive:true,force:true}); }
}
export function measureProgramBundle(directory: string) {
  const { bytes, inputs, forbidden } = measureEntryBundle({ directory, scope: 'retained',
    source: "import { program } from '@tangleai/linq/program'; export const doc = program(['data']).stat('data', 'meta').answer('meta').schema;\n",
    forbidden: /(?:@jarenjs\/(?:json|db|app|flow|validate)|@tangleai\/(?:models|context|agents)|packages\/(?:models|context|agents))\/|linq\/src\/(?:chain|query)/ });
  assert.deepEqual(forbidden, [], 'Program pen imported runtime engines or model mechanisms');
  assert.ok(bytes > 0 && bytes <= 29000, `Program pen bundle is ${bytes} bytes (ceiling 29000)`);
  return { schemaVersion:1, bun:execFileSync('bun',['--version'],{encoding:'utf8'}).trim(), bytes, retainedModules:inputs.length, excludedEngineBytes:0 };
}
const MECHANISM = /(?:@tangleai|packages)\/(models|agents|context)\//;
/** The view entry's first measurement (525,428 B) with the program pen's headroom: about 14 %, rounded up to a whole thousand. */
const VIEW_CEILING = 599000;
/** Every parsed input counts for the assistant rows, so a mechanism module the bundler dropped is still reported. */
export function measureAssistantBundles(directory: string) {
  const entries = ['.', './component', './view'].map(entry => {
    const specifier = '@tangleai/assistant' + entry.slice(1);
    const { bytes, inputs, forbidden } = measureEntryBundle({ directory, scope: 'all', forbidden: MECHANISM,
      source: `import * as entry from ${JSON.stringify(specifier)}; export { entry };\n` });
    if (entry === './view') {
      assert.deepEqual(forbidden, [], 'The view entry parsed a model, agent or context module');
      assert.ok(bytes <= VIEW_CEILING, `The view entry bundle is ${bytes} bytes (ceiling ${VIEW_CEILING})`);
    }
    return { entry, bytes, inputModules: inputs.length, mechanisms: [...new Set(forbidden.map(name => '@tangleai/' + MECHANISM.exec(name)![1]))].sort() };
  });
  return { schemaVersion:1, bun:execFileSync('bun',['--version'],{encoding:'utf8'}).trim(), scope:'all', entries };
}
export function checkProgramBundle(directory: string, root = ROOT, write = false) {
  const result = measureProgramBundle(directory);
  assert.equal(result.bun,config(root).bun);
  const path = resolve(root,'docs/migrations/jaren-ai/program-bundle.json');
  if (write) writeJson(path,result);
  else assert.deepEqual(result,readJson(path),'Program bundle measurement changed; remeasure and review its documentation');
  console.log(`Program pen: ${result.bytes} bytes, ${result.retainedModules} retained modules, zero excluded engine bytes (Bun ${result.bun}).`);
  const assistant = measureAssistantBundles(directory), assistantPath = resolve(root,'docs/migrations/jaren-ai/assistant-bundles.json');
  if (write) writeJson(assistantPath,assistant);
  else assert.deepEqual(assistant,readJson(assistantPath),'Assistant bundle measurement changed; remeasure and review its documentation');
  for (const row of assistant.entries) console.log(`Assistant ${row.entry}: ${row.bytes} bytes, ${row.inputModules} parsed modules, mechanisms ${row.mechanisms.join(', ') || 'none'}.`);
  return result;
}
if (isMain(import.meta.url)) {
  assert.ok(process.argv.slice(2).every(arg => arg==='--write'));
  checkProgramBundle(ROOT,ROOT,process.argv.includes('--write'));
}
