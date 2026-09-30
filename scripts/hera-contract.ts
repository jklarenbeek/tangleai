/** Bundle read operations from the domain owner's generated definitions. */
import {readFile,writeFile} from 'node:fs/promises';
import schema from '../packages/hera/schemas/hera.schema.json' with {type:'json'};
const entries=[
  ['agents.list','heraSurfaceEmpty','heraSurfaceAgents'],
  ['snapshots.list','heraSurfaceScope','heraSurfaceSnapshots'],
  ['snapshots.get','heraSurfaceLookup','heraSurfaceSnapshot'],
  ['experiences.list','heraSurfaceExperienceQuery','heraSurfaceExperiences'],
  ['experiences.get','heraSurfaceLookup','heraSurfaceExperience'],
  ['prompts.history','heraSurfaceRole','heraSurfacePromptHistory'],
  ['prompts.get','heraSurfaceLookup','heraSurfacePrompt'],
  ['prompts.diff','heraSurfaceDiffInput','heraSurfaceDiff'],
  ['groups.get','heraSurfaceLookup','heraSurfaceGroup'],
  ['trajectories.get','heraSurfaceLookup','heraSurfaceTrajectory'],
  ['trajectories.mermaid','heraSurfaceLookup','heraSurfaceMermaid'],
  ['trials.list','heraSurfaceRole','heraSurfaceTrials'],
  ['trials.get','heraSurfaceLookup','heraPromptTrial'],
  ['mutations.list','heraSurfaceScope','heraSurfaceMutations'],
];
const operations=Object.fromEntries(entries.map(([name,input,output])=>['hera.'+name,{kind:'read',input:{$ref:'#/$defs/'+input},output:{$ref:'#/$defs/'+output},errors:{'not-found':{status:404}}}]));
const bytes=JSON.stringify({$contract:'0.1',id:'tangle-hera',version:'1',$defs:schema.$defs,operations},null,2)+'\n',path=new URL('../packages/hera/schemas/hera.contract.json',import.meta.url);
const args=process.argv.slice(2);if(args.some(arg=>arg!=='--check')||args.length>1)throw Error('Usage: hera-contract.ts [--check]');
if(args.includes('--check')){if(await readFile(path,'utf8')!==bytes)throw Error('HERA contract bundle is stale; run npm run emit:hera-contract');}
else await writeFile(path,bytes);
