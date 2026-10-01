/** Project shared grounding result schemas, then emit the graph instrument's native contract. */
import {readFile,writeFile} from 'node:fs/promises';
import {emitTypeScript} from '@jarenjs/emit';
const args=process.argv.slice(2);if(args.some(value=>value!=='--check'))throw Error('Usage: lightrag-report-schema.ts [--check]');
const path='benchmark/schemas/lightrag.schema.json',schema=JSON.parse(await readFile(path,'utf8')),ground=JSON.parse(await readFile('benchmark/schemas/grounding.schema.json','utf8'));
for(const key of Object.keys(schema.$defs))if(key.startsWith('groundOwner_'))delete schema.$defs[key];
function project(value:unknown):any{
    if(Array.isArray(value))return value.map(project);
    if(value===null||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value).map(([key,child])=>{
        if(key==='$ref'&&typeof child==='string'&&child.startsWith('#/$defs/')){
            const name=child.slice('#/$defs/'.length),target='groundOwner_'+name;
            if(!(target in schema.$defs)){schema.$defs[target]={};schema.$defs[target]=project(ground.$defs[name]);}
            return [key,'#/$defs/'+target];
        }
        return [key,project(child)];
    }));
}
const attempt=project(ground.$defs.liveQuestionResult);
attempt.properties.questionId=attempt.properties.id;delete attempt.properties.id;attempt.required=attempt.required.map((key:string)=>key==='id'?'questionId':key);
attempt.properties.cost={$ref:'#/$defs/lightLiveCost'};attempt.properties.retrievalCost={$ref:'#/$defs/lightLiveCost'};attempt.properties.elapsedMs={type:'number',minimum:0};attempt.required.push('cost','retrievalCost','elapsedMs');
attempt.properties.completionLatencies={type:'array',items:{type:'number',minimum:0}};attempt.required.push('completionLatencies');
attempt.properties.physicalRequests={type:'integer',minimum:0};attempt.required.push('physicalRequests');
attempt.$query={$and:[{$eq:['$.tokens','$.cost.tokens']},{$eq:['$.ms','$.cost.ms']},{$eq:['$.replayed','$.cost.replayed']},{$eq:['$.attempts','$.cost.turns']},{$eq:[{$count:'$.completionLatencies[*]'},'$.cost.turns']}]};
attempt.$comment='Derived from grounding liveQuestionResult; questionId is its id and cost fields are graph instrument observations.';
schema.$defs.lightLiveAttempt=attempt;
const summary=project(ground.$defs.liveRow);delete summary.$query;delete summary.properties.key;summary.required=summary.required.filter((key:string)=>key!=='key');
delete summary.properties.questions.properties.results;summary.properties.questions.required=summary.properties.questions.required.filter((key:string)=>key!=='results');
summary.$comment='Derived from grounding liveRow; shared rowBlock owns aggregates, attempts remain in the containing graph row.';
schema.$defs.lightLiveSummary=summary;
const outputs=new Map([[path,JSON.stringify(schema,null,2)+'\n'],['benchmark/lib/lightrag.types.ts',emitTypeScript(schema,{name:'Lightrag',source:path}).trimEnd()+'\n']]);
for(const [file,bytes]of outputs){if(args.includes('--check')){if(await readFile(file,'utf8')!==bytes)throw Error('Graph instrument schema drift: '+file);}else await writeFile(file,bytes);}
