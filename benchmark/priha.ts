/** Keyless governed retrieval registration; no table precedes the scorer gate. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readPrihaLiveReceipts } from './lib/priha-live-records.ts';
import { authorizePrihaLive } from './lib/priha-live.ts';
import { prihaLocalTimingReceipt, type PrihaLocalTiming } from './lib/priha-local.ts';
import { parseArgs } from './lib/args.ts';
import { readAiEnv } from './lib/ai-env.ts';
import { buildPrihaReport, requirePrihaCapability, renderPrihaDocument, renderPrihaReport, planPrihaLive, runPrihaLive, createPrihaValidator, PRIHA_CAPABILITIES, type PrihaReport } from './lib/priha.ts';
const args = parseArgs(process.argv.slice(2), { flags: ['check', 'live', 'web-live'], values: ['json', 'md', 'require', 'authorize', 'latency-json', 'live-json', 'searx'] });
if (args.rest.length)
    throw Error('Unexpected PriHA positional arguments.');
if (args.values.has('authorize') && !args.flags.has('live'))
    throw Error('PriHA authorization requires --live.');
const required = args.values.get('require') ?? 'instrument';
if (!PRIHA_CAPABILITIES.includes(required as typeof PRIHA_CAPABILITIES[number]))
    throw Error('Unknown PriHA capability: ' + required);
if (!args.flags.has('live') && (args.flags.has('web-live') || args.values.has('live-json') || args.values.has('searx')))
    throw Error('Live transport and receipt flags require --live.');
const authorizedTransport = globalThis.fetch;
globalThis.fetch = async () => { throw Error('Keyless PriHA must not make a network call.'); };
if (args.values.has('latency-json') && (args.flags.has('check') || args.flags.has('live'))) throw Error('Latency receipt output requires a keyless generation run.');
const timings: PrihaLocalTiming[] = [];
if (args.flags.has('live')) {
    if (args.flags.has('check') || args.values.has('json') || args.values.has('md'))
        throw Error('A live dry plan cannot use keyless artifact flags.');
    if (args.values.has('authorize') && !args.values.has('live-json')) throw Error('Authorized live execution requires --live-json PATH.');
    const report = JSON.parse(await readFile('benchmark/results/priha.json', 'utf8')) as PrihaReport;
    if (!createPrihaValidator()(report).valid) throw Error('The retained keyless PriHA report is invalid; regenerate it before planning a live run.');
    requirePrihaCapability(report, 'complete');
    const env = readAiEnv(), plan = await planPrihaLive(report, env, { webLive: args.flags.has('web-live'), searxBase: args.values.get('searx') });
    await runPrihaLive(report, plan, { env }); // Verify current source before printing or opening a receipt.
    const authorization = authorizePrihaLive(plan, args.values.get('authorize'));
    console.log(JSON.stringify(plan, null, 2));
    if (authorization === 'execute') {
        const path = args.values.get('live-json')!;
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, JSON.stringify({ status: 'started', planId: plan.plan.planId }) + '\n', { flag: 'wx' });
        // Failures keep the started receipt and SQLite directory; an identical invocation cannot repurchase it.
        const result = await runPrihaLive(report, plan, { env, authorize: args.values.get('authorize'), fetch: authorizedTransport, databaseDirectory: path + '.db' });
        const execution = result.execution!, bytes = JSON.stringify({ plan, execution }, null, 2) + '\n';
        await writeFile(path, bytes);
        const retained = join('benchmark/results', `priha-live-${execution.at.slice(0, 10)}-${execution.executionId}.json`);
        await writeFile(retained, bytes, { flag: 'wx' });
        await writeFile('docs/PRIHA_BENCHMARK.md', renderPrihaDocument(report, await readPrihaLiveReceipts()));
        console.log(result.authorization + ': ' + result.physicalRequests + ' physical requests.');
    } else {
        console.log(authorization + ': 0 physical requests.');
    }
}
else {
    if (args.flags.has('check')) {
        const path = args.values.get('json') ?? 'benchmark/results/priha.json';
        try { JSON.parse(await readFile(path, 'utf8')); } catch { throw Error('PriHA artifact drift: ' + path); }
    }
    const report = await buildPrihaReport({ onLocalTiming: sample => timings.push(sample) });
    requirePrihaCapability(report, required);
    const document = renderPrihaDocument(report, await readPrihaLiveReceipts());
    const artifacts = [[args.values.get('json') ?? 'benchmark/results/priha.json', renderPrihaReport(report)], [args.values.get('md') ?? 'docs/PRIHA_BENCHMARK.md', document]];
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
    if (args.values.has('latency-json')) {
        const path = args.values.get('latency-json')!; await mkdir(dirname(path), { recursive: true });
        await writeFile(path, JSON.stringify(await prihaLocalTimingReceipt(report, timings), null, 2) + '\n');
    }
    console.log(document);
}
