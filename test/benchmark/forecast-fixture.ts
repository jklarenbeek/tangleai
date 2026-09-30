/** Original fictional fixture authoring; the registered files are the runtime inputs. */
import {createHash} from 'node:crypto';
import {canonicalSha256} from '@jarenjs/json/canonical';
import {applyJSONPatch} from '@jarenjs/json/patch';

export async function authorForecastFixture(){
  const instant=(month:number,day:number)=>`2025-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T00:00:00.000Z`;
  const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
  const seed={factorTracking:'List the factors that could change the answer.',evidenceHandling:'Check the source and availability of each observation.',uncertaintyHandling:'State the uncertainty that remains before answering.'};
  const guidance={evidence:'Compare independent observations before updating the judgment.',uncertainty:'Revisit the strongest alternative before committing to an answer.'};
  const patches=[[{op:'replace' as const,path:'/evidenceHandling',value:seed.evidenceHandling+'\n'+guidance.evidence}],
    [{op:'replace' as const,path:'/evidenceHandling',value:seed.evidenceHandling+'\n'+guidance.evidence},{op:'replace' as const,path:'/uncertaintyHandling',value:seed.uncertaintyHandling+'\n'+guidance.uncertainty}]];
  const candidates=await Promise.all(patches.map(async(patch,i)=>({id:'c'+(i+1),patch,document:applyJSONPatch(seed,patch),digest:await canonicalSha256(applyJSONPatch(seed,patch))})));
  const seedHarnessDigest=await canonicalSha256(seed);
  const specifications=[
    {id:'q01',scopeKey:'tidewater/civic-votes',prompt:'Will Tidewater approve the Canal Library proposal?',adapter:{id:'choice/v1',options:['approve','reject']},outcome:'approve'},
    {id:'q02',scopeKey:'tidewater/civic-votes',prompt:'What percentage will support the Tidewater Grove proposal?',adapter:{id:'numeric/v1',tolerance:5,range:[0,100]},outcome:60},
    {id:'q03',scopeKey:'tidewater/civic-votes',prompt:'Which site will Tidewater choose for the civic hall?',adapter:{id:'choice/v1',options:['North','South','East']},outcome:'South'},
    {id:'q04',scopeKey:'tidewater/release-dates',prompt:'Will the Tidewater Lantern portal launch or be delayed?',adapter:{id:'choice/v1',options:['launch','delay']},outcome:'delay'},
    {id:'q05',scopeKey:'tidewater/release-dates',prompt:'How many days will the Tidewater Harbor release take?',adapter:{id:'numeric/v1',tolerance:2,range:[0,30]},outcome:18},
    {id:'q06',scopeKey:'tidewater/release-dates',prompt:'How many days will the Tidewater Beacon trial take?',adapter:{id:'numeric/v1',tolerance:1,range:[0,30]},outcome:null},
  ];
  type Snapshot={id:string;questionId:string;url:string;title:string;availableAt:string|null;excerpt:string;sha256:string};
  const snapshots:Snapshot[]=[],notes:Record<string,unknown>={},feedback:Record<string,unknown>={},predictions:Record<string,Record<string,string|number>>={};
  const add=(questionId:string,id:string,availableAt:string|null,excerpt:string)=>{snapshots.push({id,questionId,url:'https://fixtures.tangleai.dev/forecast/'+id,title:'Tidewater observation '+id,availableAt,excerpt,sha256:sha(excerpt)});return id;};
  const questions=specifications.map((q,qi)=>({id:q.id,scopeKey:q.scopeKey,prompt:q.prompt,issuedAt:instant(qi+1,1),expectedResolutionAt:instant(qi+1,28),adapter:q.adapter,
    checkpoints:[10,18,25].map((day,index)=>{
      const ordinal=index+1,id=q.id+'-c'+ordinal,cutoffAt=instant(qi+1,day),snapshotIds=[
        add(q.id,id+'-a',instant(qi+1,day-2),'The Tidewater working group lists supporting and opposing arguments.'),
        add(q.id,id+'-b',instant(qi+1,day-1),'The review log says that unresolved dependencies remain under examination.'),
        add(q.id,id+'-c',cutoffAt,'The latest public briefing records new observations without declaring a final outcome.'),
      ],decisiveSnapshotIds=[snapshotIds[2]];
      if((qi===0&&ordinal===1)||(qi===1&&ordinal===2)||(qi===3&&ordinal===3)){
        const future=add(q.id,id+'-future',instant(qi+1,day+1),'A later Tidewater bulletin describes a change after this checkpoint.');snapshotIds.push(future);
        if(qi!==3)decisiveSnapshotIds.push(future);
      }
      if((qi===2&&ordinal===1)||(qi===4&&ordinal===2)){
        const undated=add(q.id,id+'-undated',null,'An undated Tidewater memo offers an unattributed expectation.');snapshotIds.push(undated);
        if(qi===2)decisiveSnapshotIds.push(undated);
      }
      notes[id]={questionState:'The question remains unresolved.',keyEvidence:'The admitted observations are retained with source identities.',mainJudgmentTrajectory:'The judgment follows the available observations.',helpfulSignals:'Independent observations provide useful corroboration.',misleadingOrFragileSignals:'An unattributed expectation remains fragile.',unresolvedRisks:'Pending dependencies may alter the eventual result.'};
      const truth=q.outcome??15,wrong=typeof truth==='number'?0:q.adapter.options!.find(v=>v!==truth)!;
      const seedAnswer=(ordinal===1||((qi===0||qi===1)&&ordinal===3))?wrong:truth;
      const improved=(qi===0||qi===1)?truth:seedAnswer;
      predictions[id]={'no-harness':ordinal===3?truth:wrong,'scaffold-no-harness':seedAnswer,[seedHarnessDigest]:seedAnswer,[candidates[0].digest]:qi===4?wrong:improved,[candidates[1].digest]:qi===3?wrong:improved};
      feedback[id]={provisionalDiagnoses:[],committedGuidance:ordinal<2?[]:[{component:ordinal===2?'evidenceHandling':'uncertaintyHandling',text:ordinal===2?guidance.evidence:guidance.uncertainty,sources:['note:'+id]}],deferredFeedback:[]};
      return {id,ordinal,scheduledAt:cutoffAt,cutoffAt,snapshotIds,decisiveSnapshotIds};
    })}));
  const resolutions=specifications.flatMap((q,qi)=>q.outcome===null?[]:[{questionId:q.id,observedAt:instant(qi+1,29),outcome:q.outcome,
    evidence:[add(q.id,q.id+'-resolution',instant(qi+1,29),'The fictional Tidewater resolution is '+String(q.outcome)+'.')]}]);
  const files:Record<string,unknown>={
    'questions.json':questions,'snapshots.json':snapshots,'resolutions.json':resolutions,'harness/seed.json':seed,'harness/candidates.json':candidates,
    'scripted/predictions.json':predictions,'scripted/notes.json':notes,'scripted/feedback.json':feedback,
    'scripted/leaks.json':{refuse:['Use the bulletin dated 2025-01-10.','Always favor Tidewater Canal Library.','Persist the approve outcome.','The Tidewater working group lists supporting and opposing arguments.','Consult https://fixtures.tangleai.dev/forecast/q01-c1-a.','Expect 18 days.','Retain the result for q01.','Trust checkpoint ordinal 2.'],allow:[guidance.evidence,guidance.uncertainty,'Separate observation from inference.','Record why a source supports a factor.']},
    'scripted/duplicates.json':[{questionId:'q01',scheduledAt:questions[0].checkpoints[0].scheduledAt,kind:'same-input'},{questionId:'q01',scheduledAt:questions[0].checkpoints[0].scheduledAt,kind:'different-input',changedPrompt:'A conflicting question under the same delivery key.'}],
  };
  const manifest={schemaVersion:1,license:'MIT',authorship:'Tangle-authored fiction for this repository; no real municipality, third-party text or real outcome is represented.',namespace:'forecast-fixture',subject:'Tidewater',
    files:await Promise.all(Object.keys(files).sort().map(async path=>({path,digest:await canonicalSha256(files[path])}))),
    census:{questions:6,checkpoints:18,resolutions:5,pending:1,resolvedCheckpoints:15,snapshots:snapshots.length,postCutoff:3,undated:2},
    policy:{seed:17753,maxHarnessComponentBytes:4096,maxHarnessBytes:32768,maxPatchOperations:32,maxGuidanceItems:5,maxGuidanceBytes:512,maxPhysicalRequests:0},
    seedHarnessDigest,candidateDigests:candidates.map(c=>c.digest)};
  return {...files,'manifest.json':{...manifest,registrationId:await canonicalSha256(manifest)}};
}
