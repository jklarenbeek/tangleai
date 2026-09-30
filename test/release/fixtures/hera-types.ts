import {createMemoryHeraStore,assertTaskSplit,planHeraHeadTransition,emptyHeraHead,type HeraAgentDefinition,type HeraPromptVersion} from '@tangleai/hera';
import schema from '@tangleai/hera/schemas/hera' with {type:'json'};
import artifacts from '@tangleai/hera/artifacts' with {type:'json'};
declare const agent:HeraAgentDefinition,prompt:HeraPromptVersion;
const store=createMemoryHeraStore({scope:'typed'});
await store.putAgent(agent,{scope:'typed',mode:'learn'});await store.putPromptVersion(prompt,{scope:'typed',mode:'learn'});
// @ts-expect-error mode authority has three registered modes
await store.putAgent(agent,{scope:'typed',mode:'administrator'});
// @ts-expect-error task split comes from the adapter, not an arbitrary model label
assertTaskSplit({split:'approved-by-model'},'learn');
const head=emptyHeraHead('typed','library');planHeraHeadTransition(head,head,'a'.repeat(64));
void [schema,artifacts];
