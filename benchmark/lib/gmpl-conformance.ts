/** Fixed-denominator GMPL measurement. Scripted results assert conformance only. */
import { readFile, glob } from 'node:fs/promises';
import { gmplPromptFiles } from '../../scripts/gmpl-sources.ts';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {equalsJson} from '@jarenjs/core/object';
import {gmplSchemaOf} from '@tangleai/gmpl';
import ablationRegistration from '../fixtures/gmpl/ablations.json' with {type:'json'};
import {measureAblations} from './gmpl-ablations.ts';
import {measureReceipt} from './gmpl-receipts.ts';
import manifest from '../fixtures/gmpl/manifest.json' with {type:'json'};
import controls from '../fixtures/gmpl/corrupt-controls.json' with {type:'json'};
import schema from '../schemas/gmpl-conformance.schema.json' with {type:'json'};
import rootPackage from '../../package.json' with {type:'json'};
import jarenPackage from '@jarenjs/json/package.json' with { type: 'json' };
import { sourceManifest } from './source-manifest.ts';
import { createReportValidator } from './validate.ts';
import { scoreGmplResult, validateCase, checkTrace, contentId } from './gmpl-oracle.ts';
import {prepareGmplPattern} from './gmpl-patterns.ts';
import {driveGmplWorkflow} from './gmpl-runner.ts';
import {measureGmplInteraction} from './gmpl-interaction.ts';
import {measureGmplCritique} from './gmpl-critique.ts';
import {scriptedGmplResponse} from './gmpl-scripts.ts';
import {measureGmplAnalysis} from './gmpl-analysis.ts';
import { measureGmplContracts } from './gmpl-contracts.ts';
import { driveSingleAgent, prepareSingleAgent } from './gmpl-runner.ts';
import { table } from './table.ts';
import type { Case, GmplConformance, Row, Receipt, Probe, Source, Capabilities, Pair } from './gmpl-conformance.types.ts';
export const ROOT=fileURLToPath(new URL('../../',import.meta.url));
export const REPORT_PATH=join(ROOT,'benchmark/results/gmpl-conformance.json');
export const DOCUMENT_PATH=join(ROOT,'docs/GMPL_BENCHMARK.md');
export const patterns=manifest.patterns as Row['pattern'][];
const checkShape=createReportValidator(schema);
export async function loadCases():Promise<Case[]>{
  return Promise.all(manifest.cases.map(async id=>{
    const value:unknown=JSON.parse(await readFile(join(ROOT,'benchmark/fixtures/gmpl/cases',`${id}.json`),'utf8'));
    if(!validateCase(value)||value.id!==id||value.input.caseId!==id)throw Error(`invalid registered case ${id}`);
    return value;
  }));
}
export function summarizeRow(id:string,pattern:Row['pattern'],kind:Row['kind'],cases:Receipt[]):Row{
  const counts:Row['counts']={planned:24,valid:0,refused:0,failed:0,waiting:0,'not-implemented':0};
  for(const c of cases)counts[c.status]++;
  const total=cases.reduce((n,c)=>n+c.utility,0);
  const validTotal=cases.filter(c=>c.status==='valid').reduce((n,c)=>n+c.utility,0);
  return {id,pattern,kind,counts,utility:total/24,conditionalUtility:counts.valid?validTotal/counts.valid:null,cases};
}
export function reportCapabilities(rows:Row[],probes:Probe[]):Capabilities{
  const passed=(cap:string)=>probes.filter(p=>p.capability===cap).every(p=>p.state==='pass');
  const present=(names:string[])=>rows.filter(r=>r.kind==='pattern'&&names.includes(r.pattern)).every(r=>r.counts['not-implemented']===0);
  const instrument=passed('instrument');
  const contracts=instrument&&passed('contracts');
  const analysis=contracts&&passed('analysis')&&present(['parallel-analysis']);
  const critique=analysis&&passed('critique')&&present(['peer-review','red-team','structured-debate']);
  const interaction=critique&&passed('interaction')&&present(['clarification','delphi-panel']);
  const comparison=interaction&&comparisons(rows).every(pair=>pair.eligible);
  const complete=comparison&&rows.length===12&&rows.every(row=>row.cases.length===24)&&probes.every(probe=>probe.state==='pass');
  return {instrument,contracts,analysis,critique,interaction,comparison,complete};
}
export function comparisons(rows:Row[]):Pair[]{
  return patterns.map(pattern=>{
    const p=rows.find(r=>r.pattern===pattern&&r.kind==='pattern'),c=rows.find(r=>r.pattern===pattern&&r.kind==='single-agent');
    const reason=!p||!c?'missing comparison row':p.counts['not-implemented']||c.counts['not-implemented']?'pattern not implemented':
      p.cases.length!==24||c.cases.length!==24?'incomplete planned coverage':
      p.cases.some((entry,i)=>entry.caseId!==c.cases[i].caseId||!equalsJson(entry.resources,c.cases[i].resources))?'unequal information or resources':null;
    const eligible=reason===null;
    return {pattern,eligible,delta:eligible?p!.utility-c!.utility:null,reason};
  });
}
export function failureCounts(rows:Row[]){
  const failures=new Map<string,number>();
  for(const c of rows.flatMap(r=>r.cases)){if(c.reason)failures.set(c.reason,(failures.get(c.reason)??0)+1);}
  return [...failures].sort(([a],[b])=>a.localeCompare(b)).map(([reason,count])=>({reason,count}));
}
export async function buildGmplReport(options:{source?:Source}={}):Promise<GmplConformance>{
  const cases=await loadCases();
  const rows:Row[]=[];
  for(const pattern of patterns){
    const prepared=await prepareGmplPattern({pattern}),control=await prepareSingleAgent();
    const measured:Receipt[]=[],baseline:Receipt[]=[];
    for(const fixture of cases){
      const drive=await driveGmplWorkflow(prepared,{input:{input:structuredClone(fixture.input)},bindings:prepared.bindings,response:scriptedGmplResponse(fixture.input,structuredClone(fixture.script.result))});
      measured.push(await measureReceipt(prepared,fixture,drive));
      const single=await driveGmplWorkflow(control,{input:{input:structuredClone(fixture.input)},response:()=>structuredClone(fixture.script.result)});
      baseline.push(await measureReceipt(control,fixture,single));
    }
    rows.push(summarizeRow(pattern,pattern,'pattern',measured),summarizeRow(`${pattern}-single-agent`,pattern,'single-agent',baseline));
  }
  const ablations=await measureAblations(cases);
  const repaired=await driveSingleAgent(cases[0].input,cases[0].script.result,{repair:true});
  const budget=await driveSingleAgent(cases[0].input,cases[0].script.result,{calls:1});
  const contracts=await measureGmplContracts(cases);
  const observations:Record<string,Record<string,unknown>>={
    ...contracts.observations,
    ...await measureGmplAnalysis(cases),
    ...await measureGmplCritique(cases),
    ...await measureGmplInteraction(cases),
    'normalization-and-repair-charged':{completion:repaired.usage.completion,normalization:repaired.usage.normalization,repair:repaired.usage.repair,physical:repaired.usage.physical},
    'budget-exhaustion-no-extra-call':{physical:budget.usage.physical,status:budget.status},
  };
  const probes:Probe[]=manifest.probes.map(p=>{
    const observed=observations[p.id]??null;
    const pass=observed!==null && JSON.stringify(observed)===JSON.stringify(p.expected);
    return {id:p.id,capability:p.capability,expected:p.expected,observed,state:observed===null?'not-implemented':pass?'pass':'fail',reason:observed===null?'capability not implemented':pass?null:'observation differs from registration'};
  });
  const unsafeControls=controls.map(c=>{if(checkTrace(c.expected,c.observed))throw Error(`oracle accepted ${c.id}`);return {id:c.id,rejected:true as const};});
  const packs=await gmplPromptFiles(ROOT);
  const packagePaths:string[]=[];for await(const path of glob('packages/*/package.json',{cwd:ROOT}))packagePaths.push(path);
  const source=options.source??await sourceManifest(ROOT,['scripts/gmpl-sources.ts','scripts/runtime-fixture.ts',...packs,...packagePaths,'.nvmrc','release.config.json','package.json','benchmark/gmpl-conformance.ts','benchmark/schemas/gmpl-conformance.schema.json','benchmark/lib/gmpl-conformance.ts','benchmark/lib/gmpl-conformance.types.ts','benchmark/lib/gmpl-oracle.ts','benchmark/lib/gmpl-runner.ts','benchmark/lib/gmpl-patterns.ts','benchmark/lib/gmpl-contracts.ts','benchmark/lib/gmpl-analysis.ts','benchmark/lib/gmpl-critique.ts','benchmark/lib/gmpl-interaction.ts','benchmark/lib/gmpl-ablations.ts','benchmark/lib/gmpl-receipts.ts','benchmark/lib/gmpl-scripts.ts','scripts/release/build.ts','scripts/release/consumers.ts','test/release/fixtures/gmpl-consumer.mjs','test/release/fixtures/gmpl-browser.mjs','test/release/fixtures/gmpl-types.ts','test/release/fixtures/browser.mjs','test/benchmark/gmpl-health.test.ts','scripts/gmpl-artifacts.ts','scripts/gmpl-consumer-smoke.ts','examples/gmpl.ts','examples/fixtures/gmpl-domains.json','package-lock.json','benchmark/lib/validate.ts','benchmark/lib/source-manifest.ts','benchmark/lib/locomo-parity.ts','benchmark/lib/args.ts','benchmark/lib/table.ts','test/benchmark/gmpl-conformance.test.ts','test/benchmark/gmpl-oracle.test.ts','test/benchmark/gmpl-comparison.test.ts'],['benchmark/fixtures/gmpl','packages/gmpl/src','packages/gmpl/schemas','packages/gmpl/artifacts','test/gmpl','packages/mas/src','packages/mas/schemas','packages/store/src','packages/agents/src','packages/models/src','packages/context/src','packages/config/src','packages/config/schemas','packages/core/src']);
  const missing=rows.reduce((n,r)=>n+r.counts['not-implemented'],0);
  const payload:Omit<GmplConformance,'reportId'>={instrument:'gmpl-conformance',version:1,source,ablations,ablationRegistrationId:await contentId(ablationRegistration),artifacts:contracts.artifacts,suite:{tangle:rootPackage.version,jaren:jarenPackage.version},registrationId:await contentId(manifest),corpusId:await contentId(cases),scorer:manifest.scorer as GmplConformance['scorer'],rows,probes,unsafeControls,pairs:comparisons(rows),capabilities:reportCapabilities(rows,probes),coverage:{planned:288,executed:288-missing,missing},failures:failureCounts(rows),limitations:['Scripted conformance does not measure model quality or establish a live improvement.','All 24 quality cases use identical role-visible evidence and no incremental human responses.','Missing patterns contribute zero utility; conditional utility has a separate denominator.','Active latency uses a fixed injected clock; live latency and monetary cost are unmeasured.','Citation scope is checked separately from answer utility; valid citations do not prove entailment.']};
  const report={...payload,reportId:await contentId(payload)};
  const check=await validateGmplReport(report);if(!check.valid)throw Error(check.errors.join('\n'));
  return report;
}
export async function validateGmplReport(value:unknown):Promise<{valid:boolean;errors:string[]}>{
  const shape=checkShape(value);if(!shape.valid)return {valid:false,errors:(shape.errors??[]).map(e=>JSON.stringify(e))};
  const report=value as GmplConformance,errors:string[]=[];
  const same=(a:unknown,b:unknown,label:string)=>{if(!equalsJson(a,b))errors.push(label);};
  const {reportId,...payload}=report;
  same(reportId,await contentId(payload),'report identity');
  same(report.source.sha256,await contentId({head:report.source.head,files:report.source.files}),'source identity');
  const fixtures=await loadCases(),outputSchemaId=await contentId(gmplSchemaOf('gmplPatternResult'));
  const configRevision=(await prepareSingleAgent()).catalog.revision;
  same(report.registrationId,await contentId(manifest),'registration identity');same(report.ablationRegistrationId,await contentId(ablationRegistration),'ablation registration');same(report.corpusId,await contentId(fixtures),'corpus identity');
  same(report.rows.map(r=>r.id),patterns.flatMap(p=>[p,`${p}-single-agent`]),'row identities');
  for(const row of report.rows){
    same({pattern:row.pattern,kind:row.kind},{pattern:patterns[Math.floor(report.rows.indexOf(row)/2)],kind:report.rows.indexOf(row)%2?'single-agent':'pattern'},'row metadata');
    same(row.cases.map(c=>c.caseId),manifest.cases,'case coverage');
    same(row,summarizeRow(row.id,row.pattern,row.kind,row.cases),'row totals');
    for(const c of row.cases){
      const {receiptId,...rest}=c;same(receiptId,await contentId(rest),'receipt identity');
      const fixture=fixtures.find(f=>f.id===c.caseId);
      if(!fixture)errors.push('unknown case');
      if(c.status==='valid'&&fixture){
        const score=scoreGmplResult(fixture,c.output);
        same([c.utility,c.citationFidelity,c.findingRetention],[score.utility,score.citationFidelity,score.findingRetention],'score');
        if(!score.valid||c.reason!==null)errors.push('hidden invalid result');
      }else if(c.utility!==0)errors.push('nonvalid utility');
      if(fixture){same(c.resources.inputId,await contentId(fixture.input),'input identity');same(c.resources.evidenceId,await contentId(fixture.input.evidence),'evidence identity');}
      same(c.resources.caps,manifest.caps,'registered resource caps');same(c.resources.model,manifest.model,'registered model');same(c.resources.humanId,await contentId(manifest.primaryHumanResponses),'registered human information');same(c.resources.outputSchemaId,outputSchemaId,'output contract');same(c.resources.profile,manifest.model,'registered profile');same(c.resources.provider,'scripted','registered provider');same(c.resources.configRevision,configRevision,'registered configuration');same(c.resources.scorer,manifest.scorer,'registered scorer');
      same(c.usage.physical,c.visibility.length,'request census');
      same(c.usage.roles,c.usage.completion,'logical role census');
      same(c.usage.promptTokens,(c.usage.physical-c.usage.unknownTokenRequests)*7,'scripted prompt token census');
      same(c.usage.completionTokens,(c.usage.physical-c.usage.unknownTokenRequests)*3,'scripted completion token census');
      same(c.usage.tools,0,'unregistered tools');same(c.usage.context,0,'unregistered context');
      for(const phase of ['completion','normalization','repair'] as const)same(c.usage[phase],c.visibility.filter(v=>v.phase===phase).length,'phase census');
      if(c.visibility.some(v=>v.messages.some(m=>/"oracle"\s*:|"requiredFindings"\s*:/.test(m.content))))errors.push('truth leakage');
      if(c.status==='not-implemented'&&(c.output!==null||c.usage.physical!==0||c.reason===null))errors.push('forged missing result');
    }
  }
  same(report.ablations.map(a=>({id:a.id,kind:a.kind,pattern:a.pattern,expectedRoles:a.expectedRoles,caseId:a.receipt.caseId})),ablationRegistration.map(a=>({id:a.id,kind:a.kind,pattern:a.pattern,expectedRoles:a.expectedRoles,caseId:a.caseId})),'ablation coverage');
  for(const [i,a] of report.ablations.entries()){
    const c=a.receipt,{receiptId,...rest}=c;same(receiptId,await contentId(rest),'ablation receipt identity');same(c.usage.roles,a.expectedRoles,'ablation role census');same(c.usage.physical,c.visibility.length,'ablation request census');
    const registration=ablationRegistration[i],fixture=fixtures.find(f=>f.id===registration?.caseId);
    if(fixture){const score=scoreGmplResult(fixture,c.output);same([c.utility,c.citationFidelity,c.findingRetention],[score.utility,score.citationFidelity,score.findingRetention],'ablation score');same(c.resources.inputId,await contentId(fixture.input),'ablation input');same(c.resources.evidenceId,await contentId(fixture.input.evidence),'ablation evidence');}
    same(c.resources.caps,{...manifest.caps,...(registration?.parameters as {caps?:object}).caps},'ablation caps');same(c.resources.model,manifest.model,'ablation model');same(c.resources.configRevision,configRevision,'ablation config');same(c.resources.humanId,await contentId(manifest.primaryHumanResponses),'ablation host information');
    for(const phase of ['completion','normalization','repair'] as const)same(c.usage[phase],c.visibility.filter(v=>v.phase===phase).length,'ablation phase census');
  }
  same(report.probes.map(p=>({id:p.id,capability:p.capability,expected:p.expected})),manifest.probes,'probe registration');
  for(const p of report.probes){
    if(p.state==='pass'&&JSON.stringify(p.expected)!==JSON.stringify(p.observed))errors.push('false probe pass');
    if(p.state==='not-implemented'&&p.observed!==null)errors.push('missing probe observation');
  }
  if(report.artifacts.packs!==14||report.artifacts.validRenders!==28)errors.push('artifact census');
  same(report.capabilities,reportCapabilities(report.rows,report.probes),'forged capability');
  same(report.pairs,comparisons(report.rows),'paired deltas');same(report.failures,failureCounts(report.rows),'hidden failures');
  same(report.unsafeControls,controls.map(c=>({id:c.id,rejected:!checkTrace(c.expected,c.observed)})),'unsafe controls');
  return {valid:errors.length===0,errors};
}
export function requireCapability(report:GmplConformance,capability:string):void{
  if(!Object.hasOwn(report.capabilities,capability))throw Error(`unknown GMPL requirement: ${capability}`);
  if(!report.capabilities[capability as keyof Capabilities])throw Error(`GMPL capability unavailable: ${capability}`);
}
export function renderReport(report:GmplConformance):string{return JSON.stringify(report,null,2)+'\n';}
export function renderDocument(report:GmplConformance):string{
  return `# GMPL conformance benchmark\n\nGenerated by \`npm run benchmark:gmpl\`. Report identity: \`${report.reportId}\`.\nSource: \`${report.source.sha256}\`; suite ${report.suite.tangle}, Jaren ${report.suite.jaren}.\n\n${report.coverage.executed}/${report.coverage.planned} registered executions measured; ${report.coverage.missing} missing. Every row retains all 24 planned cases.\n\n${report.artifacts.packs}/14 prompt packs; ${report.artifacts.validRenders}/28 minimal/full renders verified.\n\n${table({head:['Row','Valid','Refused','Failed','Waiting','Missing','Utility','Conditional'],rows:report.rows.map(r=>[r.id,r.counts.valid,r.counts.refused,r.counts.failed,r.counts.waiting,r.counts['not-implemented'],r.utility.toFixed(3),r.conditionalUtility===null?'—':r.conditionalUtility.toFixed(3)])})}\n\n${table({head:['Pattern','Comparable','Utility delta','Reason'],rows:report.pairs.map(p=>[p.pattern,p.eligible?'yes':'no',p.delta===null?'—':p.delta.toFixed(3),p.reason??'matched information and resources'])})}\n\n${table({head:['Row','Roles','Physical','Normalization','Repair','Tokens','Unknown-token requests'],rows:report.rows.map(r=>[r.id,...(['roles','physical','normalization','repair'] as const).map(k=>r.cases.reduce((n,c)=>n+c.usage[k],0)),r.cases.reduce((n,c)=>n+c.usage.promptTokens+c.usage.completionTokens,0),r.cases.reduce((n,c)=>n+c.usage.unknownTokenRequests,0)])})}\n\nDiagnostic ablations: ${report.ablations.length} executions outside the primary 288.\n\n${table({head:['Ablation','Case','Status','Utility','Roles','Physical'],rows:report.ablations.map(a=>[a.id,a.receipt.caseId,a.receipt.status,a.receipt.utility.toFixed(3),a.receipt.usage.roles,a.receipt.usage.physical])})}\n\n${table({head:['Probe','State','Reason'],rows:report.probes.map(p=>[p.id,p.state,p.reason??'registered observation matched'])})}\n\n${report.unsafeControls.length}/${report.unsafeControls.length} intentionally corrupted controls rejected.\n\n${report.limitations.map(l=>`- ${l}`).join('\n')}\n`;
}
