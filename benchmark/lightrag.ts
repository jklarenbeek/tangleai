/** Keyless graph scores, frozen paid plans and separately authorized judge diagnostics. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {parseArgs} from './lib/args.ts';
import {buildLightRagReport,requireLightRagGate,renderLightRagDocument,renderLightRagReport} from './lib/lightrag.ts';
import {readAiEnv,chatSettingsOf,embedSettingsOf} from './lib/ai-env.ts';
import {DEFAULT_SETTINGS,chatClientFor,embedderFor} from '../apps/desktop/src/settings.ts';
import {planLightRagLive,describeLightRagPlan,lightRagAuthorization,executeLightRagLive,createLightRagFetchGuard,validateLightRagLive,type LightLiveRowKey} from './lib/lightrag-run.ts';
import {planLightRagJudge,executeLightRagJudge,validateLightRagJudge} from './lib/lightrag-judge.ts';
import {openWireCache,WIRE_CACHE_PATH} from './lib/wire-cache.ts';
import type {LightragLive,LightragJudge} from './lib/lightrag.types.ts';
const args=parseArgs(process.argv.slice(2),{flags:['check','live','judge','fresh'],values:['json','md','authorize','authorize-judge','rows','cache','live-json','judge-json']});
if(args.rest.length||args.flags.has('live')&&args.flags.has('judge'))throw Error('Choose one graph measurement tier and no positional arguments.');
if(args.values.has('authorize')&&!args.flags.has('live')||args.values.has('authorize-judge')&&!args.flags.has('judge'))throw Error('Authorization must name its explicit live or judge tier.');
const rows=args.values.get('rows')?.split(',') as LightLiveRowKey[]|undefined,cachePath=args.values.get('cache')??WIRE_CACHE_PATH,fresh=args.flags.has('fresh');
async function write(path:string,bytes:string){await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);}
if(args.flags.has('live')){
    const env=readAiEnv(),context=await planLightRagLive({env,rows,cache:cachePath,fresh});console.log(describeLightRagPlan(context));
    const authorization=lightRagAuthorization(context.plan,args.values.get('authorize'));
    if(authorization==='refused')throw Error('Live authorization differs from the printed plan or its request bound is refused; zero requests.');
    if(authorization==='dry-run')console.error('Dry plan only. Zero provider requests. A matching --authorize <plan-id> is required for execution.');
    else{
        const cache=cachePath==='none'?undefined:await openWireCache({path:cachePath});
        try{const guard=createLightRagFetchGuard(env.maxCalls),replay=cache?.adapter({fresh}),retry={attempts:1},client=chatClientFor(chatSettingsOf(env),{fetch:guard.fetch,cache:replay,retry}),embedder=embedderFor({...DEFAULT_SETTINGS,embed:embedSettingsOf(env)},guard.fetch,replay,retry);
            const report=await executeLightRagLive(context,{authorize:args.values.get('authorize')!,env,client,embedder,tier:'paid',physicalRequests:guard.requests});await write(args.values.get('live-json')??'benchmark/results/lightrag-live.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({reportId:report.reportId,tier:report.tier,physicalRequests:report.physicalRequests,decision:report.decision}));
        }finally{await cache?.close();}
    }
}else if(args.flags.has('judge')){
    const env=readAiEnv(),path=args.values.get('live-json'),report=path?await validateLightRagLive(JSON.parse(await readFile(path,'utf8')) as LightragLive):null,plan=await planLightRagJudge({env,report,comparisons:rows,cache:cachePath,fresh});console.log(JSON.stringify(plan,null,2));
    const authorize=args.values.get('authorize-judge');
    if(authorize===undefined)console.error('Dry judge plan only. Zero provider requests. A matching --authorize-judge <plan-id> is required.');
    else{
        if(authorize!==plan.planId||!plan.runnable||!report)throw Error('Judge authorization differs from the plan or complete answers are absent; zero requests.');
        const cache=cachePath==='none'?undefined:await openWireCache({path:cachePath});
        try{const guard=createLightRagFetchGuard(env.maxCalls),client=chatClientFor({...chatSettingsOf(env),model:plan.model},{fetch:guard.fetch,cache:cache?.adapter({fresh}),retry:{attempts:1}}),result=await executeLightRagJudge({plan,authorize,env,report,client,tier:'paid',physicalRequests:guard.requests});
            await write(args.values.get('judge-json')??'benchmark/results/lightrag-judge.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({reportId:result.reportId,failedOrders:result.failedOrders,disagreements:result.disagreements,physicalRequests:result.physicalRequests}));
        }finally{await cache?.close();}
    }
}else{
    globalThis.fetch=async()=>{throw Error('Keyless LightRAG must not make a network call.');};
    const live=args.values.has('live-json')?await validateLightRagLive(JSON.parse(await readFile(args.values.get('live-json')!,'utf8')) as LightragLive):undefined,judge=args.values.has('judge-json')?await validateLightRagJudge(JSON.parse(await readFile(args.values.get('judge-json')!,'utf8')) as LightragJudge):undefined;
    const report=await buildLightRagReport({live,judge});requireLightRagGate(report);
    for(const [path,bytes]of [[args.values.get('json')??'benchmark/results/lightrag.json',renderLightRagReport(report)],[args.values.get('md')??'docs/LIGHTRAG_BENCHMARK.md',renderLightRagDocument(report)]]){
        if(args.flags.has('check')){if(await readFile(path,'utf8')!==bytes)throw Error('LightRAG artifact drift: '+path);}else await write(path,bytes);
    }
    console.log(renderLightRagDocument(report));
}
