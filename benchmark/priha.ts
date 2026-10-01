/** Keyless governed retrieval registration; no table precedes the scorer gate. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from './lib/args.ts';
import { readAiEnv } from './lib/ai-env.ts';
import { buildPrihaReport, requirePrihaCapability, renderPrihaDocument, renderPrihaReport, planPrihaLive, authorizePrihaLive, PRIHA_CAPABILITIES } from './lib/priha.ts';
const args = parseArgs(process.argv.slice(2), { flags: ['check', 'live'], values: ['json', 'md', 'require', 'authorize'] });
if (args.rest.length)
    throw Error('Unexpected PriHA positional arguments.');
if (args.values.has('authorize') && !args.flags.has('live'))
    throw Error('PriHA authorization requires --live.');
const required = args.values.get('require') ?? 'instrument';
if (!PRIHA_CAPABILITIES.includes(required as typeof PRIHA_CAPABILITIES[number]))
    throw Error('Unknown PriHA capability: ' + required);
globalThis.fetch = async () => { throw Error('Keyless PriHA must not make a network call.'); };
const report = await buildPrihaReport();
requirePrihaCapability(report, required);
if (args.flags.has('live')) {
    if (args.flags.has('check') || args.values.has('json') || args.values.has('md'))
        throw Error('A live dry plan cannot use keyless artifact flags.');
    const plan = await planPrihaLive(report, readAiEnv());
    const authorization = authorizePrihaLive(plan, args.values.get('authorize'));
    console.log(JSON.stringify(plan, null, 2));
    console.log(authorization + ': zero provider requests.');
}
else {
    const artifacts = [[args.values.get('json') ?? 'benchmark/results/priha.json', renderPrihaReport(report)], [args.values.get('md') ?? 'docs/PRIHA_BENCHMARK.md', renderPrihaDocument(report)]];
    for (const [path, bytes] of artifacts) {
        if (args.flags.has('check')) {
            if (await readFile(path, 'utf8') !== bytes)
                throw Error('PriHA artifact drift: ' + path);
        }
        else {
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, bytes);
        }
    }
    console.log(renderPrihaDocument(report));
}
