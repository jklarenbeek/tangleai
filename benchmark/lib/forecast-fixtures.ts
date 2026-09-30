/** Digest-registered fictional inputs and explicit checkpoint evidence pools. */
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {canonicalSha256} from '@jarenjs/json/canonical';
import {applyJSONPatch} from '@jarenjs/json/patch';
import {equalsJson} from '@jarenjs/core/object';
import {createReportValidator} from './validate.ts';
import {cutoffAdmits,forecastInstant} from './forecast-oracle.ts';
import schema from '../schemas/forecast.schema.json' with {type:'json'};
import type {Manifest,Question,Snapshot,Resolution,HarnessDocument,Candidate} from './forecast.types.ts';

export const FORECAST_FILES=['harness/candidates.json','harness/seed.json','questions.json','resolutions.json','scripted/duplicates.json','scripted/feedback.json','scripted/leaks.json','scripted/notes.json','scripted/predictions.json','snapshots.json'] as const;
const validators=new Map<string,ReturnType<typeof createReportValidator>>();
export function validateForecastFixture<T>(name:string,value:unknown):T{
  let validate=validators.get(name);if(!validate){validate=createReportValidator({$defs:schema.$defs,$ref:'#/$defs/'+name});validators.set(name,validate);}
  const result=validate(value);if(!result.valid)throw Error('Invalid forecast '+name+': '+JSON.stringify(result.errors));return value as T;
}
export async function loadForecastFixtures(root=process.cwd()){
  const directory=join(root,'benchmark/fixtures/forecast'),read=async(path:string):Promise<unknown>=>JSON.parse(await readFile(join(directory,path),'utf8'));
  const manifest=validateForecastFixture<Manifest>('manifest',await read('manifest.json')),{registrationId,...payload}=manifest;
  if(await canonicalSha256(payload)!==registrationId)throw Error('Forecast registration digest mismatch.');
  if(!equalsJson(manifest.files.map(f=>f.path),FORECAST_FILES))throw Error('Forecast file allowlist mismatch.');
  const files=new Map<string,unknown>();
  for(const file of manifest.files){const value=await read(file.path);if(await canonicalSha256(value)!==file.digest)throw Error('Forecast fixture digest mismatch: '+file.path);files.set(file.path,value);}
  const array=<T>(path:string,type:string)=>{const raw=files.get(path);if(!Array.isArray(raw))throw Error('Missing fixture array '+path);return raw.map(v=>validateForecastFixture<T>(type,v));};
  const questions=array<Question>('questions.json','question'),snapshots=array<Snapshot>('snapshots.json','snapshot'),resolutions=array<Resolution>('resolutions.json','resolution');
  const seed=validateForecastFixture<HarnessDocument>('harnessDocument',files.get('harness/seed.json')),candidates=array<Candidate>('harness/candidates.json','candidate');
  const checkpoints=questions.flatMap(q=>q.checkpoints),unique=(ids:string[],label:string)=>{if(new Set(ids).size!==ids.length)throw Error('Duplicate forecast '+label);};
  unique(questions.map(q=>q.id),'question');unique(checkpoints.map(c=>c.id),'checkpoint');unique(snapshots.map(s=>s.id),'snapshot');unique(resolutions.map(r=>r.questionId),'resolution');
  if(questions.length!==6||checkpoints.length!==18||resolutions.length!==5||candidates.length!==2)throw Error('Forecast cardinality changed.');
  for(const scope of ['tidewater/civic-votes','tidewater/release-dates']){
    const selected=questions.filter(q=>q.scopeKey===scope);
    if(selected.length!==3||new Set(selected.map(q=>q.adapter.id)).size!==2)throw Error('Forecast scope/adapter coverage drift.');
  }
  const encoder=new TextEncoder();
  const checkHarness=(doc:HarnessDocument)=>{if(Object.values(doc).some(text=>encoder.encode(text).length>4096)||encoder.encode(JSON.stringify(doc)).length>32768)throw Error('Harness byte limit exceeded.');};
  checkHarness(seed);if(await canonicalSha256(seed)!==manifest.seedHarnessDigest)throw Error('Seed harness digest mismatch.');
  for(const [index,candidate] of candidates.entries()){
    checkHarness(candidate.document);
    if(!equalsJson(applyJSONPatch(seed,candidate.patch),candidate.document)||await canonicalSha256(candidate.document)!==candidate.digest||candidate.digest!==manifest.candidateDigests[index])throw Error('Scripted candidate digest or patch drift.');
  }
  let postCutoff=0,undated=0;
  for(const snapshot of snapshots){
    if(snapshot.availableAt!==null)forecastInstant(snapshot.availableAt);
    if(!questions.some(q=>q.id===snapshot.questionId)||createHash('sha256').update(snapshot.excerpt).digest('hex')!==snapshot.sha256)throw Error('Snapshot ownership or excerpt digest mismatch.');
  }
  for(const question of questions){
    forecastInstant(question.issuedAt);forecastInstant(question.expectedResolutionAt);
    let previous=question.issuedAt;
    for(const [index,checkpoint] of question.checkpoints.entries()){
      forecastInstant(checkpoint.scheduledAt);forecastInstant(checkpoint.cutoffAt);
      if(checkpoint.ordinal!==index+1||checkpoint.scheduledAt<=previous||checkpoint.cutoffAt>checkpoint.scheduledAt||checkpoint.scheduledAt>question.expectedResolutionAt)throw Error('Checkpoint chronology drift.');
      previous=checkpoint.scheduledAt;let admitted=0;
      for(const id of checkpoint.snapshotIds){const snapshot=snapshots.find(s=>s.id===id);if(!snapshot||snapshot.questionId!==question.id)throw Error('Checkpoint evidence pool crosses a question.');
        const gate=cutoffAdmits(snapshot,checkpoint.cutoffAt);if(gate.admitted)admitted++;else if(gate.reason==='post-cutoff')postCutoff++;else undated++;
      }
      if(admitted<3||checkpoint.decisiveSnapshotIds.some(id=>!checkpoint.snapshotIds.includes(id)))throw Error('Missing admitted or decisive checkpoint evidence.');
    }
  }
  for(const resolution of resolutions){const question=questions.find(q=>q.id===resolution.questionId);
    forecastInstant(resolution.observedAt);
    if(!question||question.checkpoints.some(c=>c.scheduledAt>=resolution.observedAt)||resolution.evidence.some(id=>!snapshots.some(s=>s.id===id&&s.questionId===question.id)))throw Error('Resolution chronology or evidence mismatch.');
  }
  const pending=questions.filter(q=>!resolutions.some(r=>r.questionId===q.id)).length,census={questions:questions.length,checkpoints:checkpoints.length,resolutions:resolutions.length,pending,resolvedCheckpoints:checkpoints.length-pending*3,snapshots:snapshots.length,postCutoff,undated};
  if(!equalsJson(census,manifest.census)||postCutoff!==3||undated!==2||pending!==1)throw Error('Forecast census drift.');
  const predictions=files.get('scripted/predictions.json') as Record<string,Record<string,string|number>>,notes=files.get('scripted/notes.json') as Record<string,unknown>,feedback=files.get('scripted/feedback.json') as Record<string,unknown>;
  const treatments=['no-harness','scaffold-no-harness',manifest.seedHarnessDigest,...manifest.candidateDigests].sort();
  for(const record of [predictions,notes,feedback])if(!record||!equalsJson(Object.keys(record).sort(),checkpoints.map(c=>c.id).sort()))throw Error('Scripted checkpoint coverage drift.');
  for(const checkpoint of checkpoints)if(!equalsJson(Object.keys(predictions[checkpoint.id]).sort(),treatments)||Object.values(predictions[checkpoint.id]).some(v=>typeof v!=='string'&&(typeof v!=='number'||!Number.isFinite(v))))throw Error('Scripted prediction coverage or value drift.');
  return {manifest,questions,snapshots,resolutions,seed,candidates,predictions,notes,feedback,leaks:files.get('scripted/leaks.json'),duplicates:files.get('scripted/duplicates.json')};
}
export type ForecastFixtures=Awaited<ReturnType<typeof loadForecastFixtures>>;
