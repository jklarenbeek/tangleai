/** Registered forecasting baselines, with explicit unresolved denominators. */
import {canonicalSha256} from '@jarenjs/json/canonical';
import {equalsJson} from '@jarenjs/core/object';
import {mulberry32,randomInt} from '@jarenjs/core/random';
import {mean} from '@jarenjs/core/stats';
import {loadForecastFixtures,type ForecastFixtures} from './forecast-fixtures.ts';
import {scoreForecast,cutoffAdmits,analyticBand,evidenceCeiling} from './forecast-oracle.ts';
import {sourceManifest} from './source-manifest.ts';
import {analyticEnvelope} from './report-envelope.ts';
import {createReportValidator} from './validate.ts';
import {table} from './table.ts';
import schema from '../schemas/forecast.schema.json' with {type:'json'};
import identitySchema from '../../packages/config/schemas/run-identity.schema.json' with {type:'json'};
import {admitEvidence,forecastMust,scoreForecastAnswer} from '@tangleai/forecast';
import {measureForecastTreatment,type ForecastNegative} from './forecast-scripted.ts';
import {measureForecastResume} from './forecast-resume.ts';
import type {Row,Case,Probe,Source,Audit,Forecast} from './forecast.types.ts';

export const REPORT_PATH='benchmark/results/forecast.json',DOCUMENT_PATH='docs/FORECAST_BENCHMARK.md';
export const SOURCE_FILES=['benchmark/forecast.ts','benchmark/schemas/forecast.schema.json','benchmark/scripts/forecast-runtime.ts','scripts/forecast-tick.ts','scripts/forecast-segments.ts','package.json','package-lock.json'];
export const FORECAST_ROWS=['oracle','seeded-reference','evidence-ceiling','no-harness','static-harness','scaffold-no-harness','evolving-harness'] as const;
export const FORECAST_SOURCE_ROOTS=['benchmark/lib','benchmark/fixtures/forecast','packages/forecast','packages/agents','packages/models','packages/context','packages/documents','packages/search','packages/mas','packages/store'];
const validator=createReportValidator(schema,[identitySchema]);
export const probe=(id:string,holds:boolean,detail:string):Probe=>{if(!holds)throw Error('Forecast probe failed: '+id);return {id,holds:true,detail};};
export function forecastAudit(fixture:ForecastFixtures):Audit[]{
  return fixture.questions.flatMap(q=>q.checkpoints.map(c=>{
    const admitted:string[]=[],refused:Audit['refused']=[];
    for(const id of c.snapshotIds){const gate=cutoffAdmits(fixture.snapshots.find(s=>s.id===id)!,c.cutoffAt);if(gate.admitted)admitted.push(id);else refused.push({id,reason:gate.reason});}
    return {questionId:q.id,checkpointId:c.id,admitted,refused,postCutoff:refused.filter(r=>r.reason==='post-cutoff').length,undated:refused.filter(r=>r.reason==='undated').length,decisiveAdmitted:c.decisiveSnapshotIds.every(id=>admitted.includes(id))};
  }));
}
export function finalizeRow(cases:Case[],fixture:ForecastFixtures){
  const available=cases.filter(c=>c.available),scored=cases.filter(c=>c.status==='scored');
  const ceiling=(selected:Case[])=>evidenceCeiling(selected.filter(c=>c.available).map(c=>({admittedIds:c.evidenceAdmitted,decisiveSnapshotIds:fixture.questions.find(q=>q.id===c.questionId)!.checkpoints.find(cp=>cp.id===c.checkpointId)!.decisiveSnapshotIds})));
  return {counts:{planned:cases.length,available:available.length,pending:cases.length-available.length,scored:scored.length,failed:available.filter(c=>c.status==='failed').length,notRun:available.filter(c=>c.status==='not-run').length},
    utility:scored.length?mean(scored.map(c=>c.utility!))!:null,
    byHorizon:([1,2,3] as const).map(ordinal=>{const selected=cases.filter(c=>c.ordinal===ordinal),scores=selected.filter(c=>c.status==='scored');return {ordinal,available:selected.filter(c=>c.available).length,planned:selected.length,scored:scores.length,utility:scores.length?mean(scores.map(c=>c.utility!))!:null,evidenceCeiling:ceiling(selected)};})};
}
export function forecastCases(fixture:ForecastFixtures,id:Row['id'],audit=forecastAudit(fixture)):Case[]{
  const random=mulberry32(fixture.manifest.policy.seed),measured=['oracle','seeded-reference','evidence-ceiling'].includes(id);
  return fixture.questions.flatMap(question=>question.checkpoints.map(checkpoint=>{
    const resolution=fixture.resolutions.find(r=>r.questionId===question.id),observed=audit.find(a=>a.checkpointId===checkpoint.id)!;
    let prediction:string|number|null=null,utility:Case['utility']=null,category:Case['category']=null;
    if(resolution&&measured){
      if(id==='evidence-ceiling'){utility=Number(observed.decisiveAdmitted) as 0|1;category=utility?'success':'failure';}
      else{
        prediction=id==='oracle'?resolution.outcome:question.adapter.id==='choice/v1'?question.adapter.options[randomInt(random,0,question.adapter.options.length)]:question.adapter.range[0]+random()*(question.adapter.range[1]-question.adapter.range[0]);
        const score=scoreForecast(question.adapter,prediction,resolution.outcome);utility=score.utility;category=score.category;
      }
    }
    return {questionId:question.id,checkpointId:checkpoint.id,ordinal:checkpoint.ordinal,scopeKey:question.scopeKey,cutoffAt:checkpoint.cutoffAt,available:!!resolution,
      status:!resolution?'pending' as const:measured?'scored' as const:'not-run' as const,failure:null,prediction,outcome:resolution?.outcome??null,category,utility,
      evidenceAdmitted:observed.admitted,evidenceRefused:{postCutoff:observed.postCutoff,undated:observed.undated},refused:observed.refused};
  }));
}
async function runtimeRow(fixture:ForecastFixtures,id:'no-harness'|'static-harness'):Promise<Row>{
  const measured=await measureForecastTreatment(fixture,id);
  if(measured.physicalCalls!==0)throw Error('Keyless forecast reached transport.');
  const names=['web_search','web_read',...(id==='static-harness'?['harness_read']:[]),'evidence_read'];
  return {id,treatment:id,status:'measured',identity:measured.identity,cost:measured.cost,cases:measured.cases,...finalizeRow(measured.cases,fixture),runtime:{retained:measured.retained,stopReasons:measured.stops,logicalCalls:measured.logicalCalls,physicalCalls:measured.physicalCalls as 0},probes:[probe('toolbox-names',measured.retained.every(r=>equalsJson(r.tools.names,names)&&r.tools.revision===measured.identity.toolset.revision&&r.executorCalls.length===3&&r.noteCalls.length===1),'Every checkpoint uses the registered closed toolbox and one bounded note call.')]};
}
async function executionProbes(fixture:ForecastFixtures):Promise<Probe[]>{
  let admissions=0,scores=0;
  for(const q of fixture.questions)for(const c of q.checkpoints){
    for(const s of fixture.snapshots){const a=forecastMust(admitEvidence(s,c.cutoffAt));if(!equalsJson({admitted:a.admitted,reason:a.reason},cutoffAdmits(s,c.cutoffAt)))throw Error('Runtime evidence admission differs from the independent oracle.');admissions++;}
    const resolution=fixture.resolutions.find(r=>r.questionId===q.id);
    if(resolution)for(const prediction of Object.values(fixture.predictions[c.id])){const a=forecastMust(scoreForecastAnswer({...q.adapter,version:'1'},prediction,resolution.outcome)),b=scoreForecast(q.adapter,prediction,resolution.outcome);if(a.utility!==b.utility||a.category!==b.category)throw Error('Runtime scorer differs from the independent oracle.');scores++;}
  }
  const negatives:ForecastNegative[]=['future','length','tool-limit','budget-turns','malformed'],census=[];
  for(const negative of negatives){const r=await measureForecastTreatment(fixture,'static-harness',negative),c=r.retained[0].checkpoint;const code=negative==='future'?null:negative==='malformed'?'TFCT1009':'TFCT1005';
    if(c.failure?.code!==code&&!(code===null&&c.failure===null)||!c.traceId||negative==='budget-turns'&&r.logicalCalls!==0||negative==='future'&&r.cases[0].evidenceRefused.postCutoff!==1)throw Error('Forecast negative script did not retain its expected refusal.');
    census.push(`${negative}: ${c.stopReason}, ${c.failure?.code??'cutoff refusal TFCT1006'}, ${r.logicalCalls} calls`);
  }
  return [probe('admission-parity',admissions===1152,`${admissions} snapshot/cutoff pairs agree with the independent oracle.`),probe('adapter-score-parity',scores===75,`${scores} authored predictions agree with the independent scorer.`),probe('stop-reason-census',true,census.join('; '))];
}
async function orchestrationProbes():Promise<Probe[]>{
  const r=await measureForecastResume(),stops=r.stages.reduce((n,s)=>n+s.stops,0);
  return [probe('resume-identity',r.stages.every(s=>s.extraCalls===0&&s.stops===s.resumed&&s.artifactDigest===r.artifactDigest),`${stops} stops and resumes across ${r.stages.length} committed stages; ${r.logicalCalls} calls, zero extra calls, ${r.physicalRequests} physical requests. Artifact digest ${r.artifactDigest}; executable ${r.executableRevision}. Stages: ${r.stages.map(s=>s.stage+'='+s.stops).join(', ')}.`),
    probe('duplicate-delivery',r.duplicateDeliveries===3,`${r.duplicateDeliveries} ${r.duplicateCause} deliveries create no extra forecast artifact or spend; second ticks start zero runs.`),
    probe('ordinal-discipline',r.ordinalRefusals===1,'One out-of-order ordinal is refused as TFCT1004 before any model purchase.'),
    probe('revision-skipped-at-ordinal-1',r.firstRevisionSkipped,'Checkpoint one takes revision-skip; later checkpoints return a counted not-implemented revision value.')];
}
export async function buildForecastReport(options:{root?:string;source?:Source}={}):Promise<Forecast>{
  const root=options.root??process.cwd(),fixture=await loadForecastFixtures(root),evidenceAudit=forecastAudit(fixture);
  const revision=await canonicalSha256({scorer:'forecast-utility/v1',cutoff:'available-at-lte-cutoff/v1',policy:fixture.manifest.policy});
  const rows:Row[]=await Promise.all(FORECAST_ROWS.map(async id=>{
    if(id==='no-harness'||id==='static-harness')return runtimeRow(fixture,id);
    const cases=forecastCases(fixture,id,evidenceAudit),measured=['oracle','seeded-reference','evidence-ceiling'].includes(id);
    return {id,status:measured?'measured':'implementation-missing',treatment:id,identity:{configuration:measured?{kind:'analytic',revision}:null,toolset:measured?{names:[],revision}:null,promptRevision:measured?revision:null,noteSchemaRevision:measured?revision:null,notePromptRevision:null,noteToolsetRevision:null,scorer:'forecast-utility/v1',cutoffPolicy:'available-at-lte-cutoff/v1'},cost:{calls:0,tokens:0,ms:0,usageKnown:true},cases,...finalizeRow(cases,fixture),runtime:null,probes:[]};
  }));
  const band=analyticBand(fixture.questions.flatMap(q=>{const r=fixture.resolutions.find(r=>r.questionId===q.id);return r?q.checkpoints.map(()=>({adapter:q.adapter,outcome:r.outcome})):[];}));
  const content={instrument:'forecast' as const,schemaVersion:1 as const,source:options.source??await sourceManifest(root,SOURCE_FILES,FORECAST_SOURCE_ROOTS),registrationId:fixture.manifest.registrationId,fixture:fixture.manifest.census,rows,evidenceAudit,
    refusals:{postCutoff:evidenceAudit.reduce((n,a)=>n+a.postCutoff,0),undated:evidenceAudit.reduce((n,a)=>n+a.undated,0),ids:evidenceAudit.flatMap(a=>a.refused.map(r=>r.id))},band,
    probes:[probe('oracle-ceiling',rows[0].utility===1&&rows[0].counts.scored===15,'The outcome oracle scores every resolved checkpoint and leaves three pending.'),
      probe('reference-band',rows[1].utility!>=band.low&&rows[1].utility!<=band.high,'The seeded reference lies inside the enumerated central 99% band.'),
      probe('cutoff-refusals',evidenceAudit.reduce((n,a)=>n+a.postCutoff,0)===3&&evidenceAudit.reduce((n,a)=>n+a.undated,0)===2,'The shared attachment audit counts three future and two undated items once.'),...await executionProbes(fixture),...await orchestrationProbes()],
    capabilities:{oracle:true,static:true,scaffold:false,evolving:false,complete:false},identity:analyticEnvelope(FORECAST_ROWS),
    limitations:['The fictional fixture measures conformance; it does not establish learned forecasting quality or reproduce paper results.','Pending checkpoints execute on the scripted tier and remain in planned denominators with no utility.','The shared audit counts unique registered attachments once. Each measured treatment separately captures three future and two undated refusals; negative scripts are separate probes.','Static rows run the real bounded agent, read-only tools, note builder and atomic memory store against authored responses. Calls and usage are scripted accounting, not purchased tokens; the injected clock gives zero elapsed time.','No provider stack executes; the provider identity envelope stays not-run. Runtime rows bind actual configuration, role prompts, toolset, artifacts and request digests. Unimplemented identities remain null.','No live plan is registered yet.']};
  const report={...content,reportId:await canonicalSha256(content)};await validateForecastReport(report,fixture);return report;
}
export async function validateForecastReport(value:unknown,fixture?:ForecastFixtures){
  const checked=validator(value);if(!checked.valid)throw Error('Invalid forecast report: '+JSON.stringify(checked.errors));
  const report=value as Forecast,{reportId,...content}=report;
  if(await canonicalSha256(content)!==reportId||await canonicalSha256({head:report.source.head,files:report.source.files})!==report.source.sha256)throw Error('Forecast report or source identity drift.');
  fixture??=await loadForecastFixtures();
  if(report.registrationId!==fixture.manifest.registrationId||!equalsJson(report.fixture,fixture.manifest.census)||!equalsJson(report.rows.map(r=>r.id),FORECAST_ROWS))throw Error('Forecast registration or row coverage drift.');
  const audit=forecastAudit(fixture);if(!equalsJson(report.evidenceAudit,audit)||!equalsJson(report.refusals.ids,audit.flatMap(a=>a.refused.map(r=>r.id))))throw Error('Forecast evidence audit drift.');
  for(const row of report.rows){
    if(row.id==='no-harness'||row.id==='static-harness'){
      if(!equalsJson(row,await runtimeRow(fixture,row.id)))throw Error('Forecast runtime evidence, identity, cost or score drift.');
      continue;
    }
    if(!equalsJson(row.cases,forecastCases(fixture,row.id,audit)))throw Error('Forecast analytic case or unimplemented state was fabricated.');
    const measured=finalizeRow(row.cases,fixture);if(!equalsJson({counts:row.counts,utility:row.utility,byHorizon:row.byHorizon},measured))throw Error('Forecast counts or score drift.');
    if(['oracle','seeded-reference','evidence-ceiling'].includes(row.id)?row.status!=='measured':row.status!=='implementation-missing')throw Error('Unsupported forecast mechanism claim.');
    if(row.cost.calls||row.cost.tokens||row.cost.ms||!row.cost.usageKnown||row.runtime!==null)throw Error('Analytic registration cannot claim provider spend or retained execution.');
  }
  const band=analyticBand(fixture.questions.flatMap(q=>{const r=fixture!.resolutions.find(r=>r.questionId===q.id);return r?q.checkpoints.map(()=>({adapter:q.adapter,outcome:r.outcome})):[];}));
  if(!equalsJson(report.identity,analyticEnvelope(FORECAST_ROWS)))throw Error('Analytic registration cannot claim a model execution identity.');
  if(!equalsJson(report.probes.slice(3),[...await executionProbes(fixture),...await orchestrationProbes()]))throw Error('Forecast runtime probe drift.');
  if(!equalsJson(report.band,band)||!equalsJson(report.capabilities,{oracle:true,static:true,scaffold:false,evolving:false,complete:false}))throw Error('Forecast band or capability drift.');
}
export function requireCapability(report:Forecast,capability:string){
  const gates:Record<string,string[]>={oracle:['oracle','seeded-reference','evidence-ceiling'],static:['no-harness','static-harness'],scaffold:['scaffold-no-harness'],evolving:['evolving-harness'],complete:[...FORECAST_ROWS]};
  if(!Object.hasOwn(gates,capability))throw Error('Unknown forecast capability: '+capability);
  const missing=gates[capability].filter(id=>report.rows.find(r=>r.id===id)?.status!=='measured');if(missing.length)throw Error('Forecast implementation missing: '+missing.join(', '));
}
export const renderReport=(report:Forecast)=>JSON.stringify(report,null,2)+'\n';
export function renderDocument(report:Forecast){
  return ['# Forecast harness benchmark','','Generated by `npm run benchmark:forecast`; do not edit figures.','',
    `Original MIT fiction: ${report.fixture.questions} questions, ${report.fixture.checkpoints} checkpoints, ${report.fixture.resolutions} resolved questions and ${report.fixture.pending} pending.`,
    `Oracle utility: ${report.rows[0].utility!.toFixed(3)} over ${report.rows[0].counts.scored}/${report.rows[0].counts.planned} checkpoints; ${report.rows[0].counts.pending} pending.`,
    `Seeded reference utility: ${report.rows[1].utility!.toFixed(4)}. Exact central 99% band: [${report.band.low.toFixed(4)}, ${report.band.high.toFixed(4)}]; expectation ${report.band.expected.toFixed(4)}.`, '',
    table({head:['Row','Status','Available / planned','Utility','Horizon 1 / 2 / 3','Evidence ceiling','Future / undated','Usage known','Calls / tokens / ms'],rows:report.rows.map(r=>[r.id,r.status,r.counts.available+' / '+r.counts.planned,r.utility,r.byHorizon.map(h=>h.utility??'unmeasured').join(' / '),report.rows[2].utility,report.refusals.postCutoff+' / '+report.refusals.undated,String(r.cost.usageKnown),r.cost.calls+' / '+r.cost.tokens+' / '+r.cost.ms])}), '',
    table({head:['Checkpoint','Scope','Status','Oracle utility','Evidence ceiling','Admitted','Future / undated'],rows:report.rows[0].cases.map((c,i)=>[c.checkpointId,c.scopeKey,c.status,c.utility,report.rows[2].cases[i].utility,c.evidenceAdmitted.length,c.evidenceRefused.postCutoff+' / '+c.evidenceRefused.undated])}), '',
    table({head:['Refused snapshot','Reason'],rows:report.evidenceAudit.flatMap(a=>a.refused.map(r=>[r.id,r.reason]))}), '',
    table({head:['Probe','Holds','Evidence'],rows:report.probes.map(p=>[p.id,String(p.holds),p.detail])}), '',...report.limitations.map(s=>'- '+s), '',
    table({head:['Runtime row','Stops','Note failures','Physical calls','Note prompt / empty toolset'],rows:report.rows.filter(r=>r.runtime).map(r=>[r.id,JSON.stringify(r.runtime!.stopReasons),r.runtime!.retained.filter((a:any)=>a.checkpoint.noteFailure!==null).length,r.runtime!.physicalCalls,r.identity.notePromptRevision+' / '+r.identity.noteToolsetRevision])}), '',
    `Registration: \`${report.registrationId}\`. Source: \`${report.source.sha256}\`. Report: \`${report.reportId}\`.`, ''].join('\n');
}
