/** A graph experiment publishes nothing before its independent scorer gate. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from './lib/args.ts';
import { buildLightRagReport, requireLightRagGate, renderLightRagDocument, renderLightRagReport } from './lib/lightrag.ts';
const args = parseArgs(process.argv.slice(2), { flags: ['check','live'], values: ['json','md'] });
if (args.rest.length) throw Error('Unexpected LightRAG positional arguments.');
if (args.flags.has('live')) throw Error('Live tier arrives with the ablation order; zero requests.');
globalThis.fetch = async () => { throw Error('Keyless LightRAG must not make a network call.'); };
const report = await buildLightRagReport(); requireLightRagGate(report);
for (const [path, bytes] of [[args.values.get('json') ?? 'benchmark/results/lightrag.json',renderLightRagReport(report)], [args.values.get('md') ?? 'docs/LIGHTRAG_BENCHMARK.md',renderLightRagDocument(report)]]) {
    if (args.flags.has('check')) { if (await readFile(path,'utf8') !== bytes) throw Error('LightRAG artifact drift: ' + path); }
    else { await mkdir(dirname(path),{recursive:true}); await writeFile(path,bytes); }
}
console.log(renderLightRagDocument(report));
