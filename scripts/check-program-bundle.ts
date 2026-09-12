/** The standalone program pen stays independent of engines and model mechanisms. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, config, isMain, readJson, writeJson } from './release/common.ts';

export function measureProgramBundle(directory: string) {
  const temporary = mkdtempSync(resolve(directory, '.program-probe-'));
  try {
    writeFileSync(resolve(temporary,'entry.js'), "import { program } from '@tangleai/linq/program'; export const doc = program(['data']).stat('data', 'meta').answer('meta').schema;\n");
    execFileSync('bun', ['build',resolve(temporary,'entry.js'),'--target=browser','--format=esm','--minify',`--outfile=${resolve(temporary,'bundle.js')}`,`--metafile=${resolve(temporary,'meta.json')}`], {cwd:directory,stdio:['ignore','pipe','pipe']});
    const meta = JSON.parse(readFileSync(resolve(temporary,'meta.json'),'utf8'));
    const modules = (Object.values(meta.outputs)[0] as {inputs:Record<string,{bytesInOutput:number}>}).inputs;
    const retained = Object.entries(modules).filter(([,value]) => value.bytesInOutput > 0).map(([name])=>name.replaceAll('\\','/'));
    const unwanted = retained.filter(name => /(?:@jarenjs\/(?:json|db|app|flow|validate)|@tangleai\/(?:models|context|agents)|packages\/(?:models|context|agents))\//.test(name) || /linq\/src\/(?:chain|query)/.test(name));
    assert.deepEqual(unwanted, [], 'Program pen imported runtime engines or model mechanisms');
    const bytes = readFileSync(resolve(temporary,'bundle.js')).length;
    assert.ok(bytes > 0 && bytes <= 18000, `Program pen bundle is ${bytes} bytes (ceiling 18000)`);
    return { schemaVersion:1, bun:execFileSync('bun',['--version'],{encoding:'utf8'}).trim(), bytes, retainedModules:retained.length, excludedEngineBytes:0 };
  } finally { rmSync(temporary,{recursive:true,force:true}); }
}
export function checkProgramBundle(directory: string, root = ROOT, write = false) {
  const result = measureProgramBundle(directory);
  assert.equal(result.bun,config(root).bun);
  const path = resolve(root,'docs/migrations/jaren-ai/program-bundle.json');
  if (write) writeJson(path,result);
  else assert.deepEqual(result,readJson(path),'Program bundle measurement changed; remeasure and review its documentation');
  console.log(`Program pen: ${result.bytes} bytes, ${result.retainedModules} retained modules, zero excluded engine bytes (Bun ${result.bun}).`);
  return result;
}
if (isMain(import.meta.url)) {
  assert.ok(process.argv.slice(2).every(arg => arg==='--write'));
  checkProgramBundle(ROOT,ROOT,process.argv.includes('--write'));
}
