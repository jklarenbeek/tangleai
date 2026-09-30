import {createMemoryHeraStore,assertTaskSplit,planHeraHeadTransition,emptyHeraHead,type HeraAgentDefinition,type HeraPromptVersion} from '@tangleai/hera';
import schema from '@tangleai/hera/schemas/hera' with {type:'json'};
import artifacts from '@tangleai/hera/artifacts' with {type:'json'};
import {createHeraContract,createHeraHandlers,type HeraReadStore} from '@tangleai/hera/contract';
import contractSchema from '@tangleai/hera/schemas/contract' with {type:'json'};
declare const agent:HeraAgentDefinition,prompt:HeraPromptVersion;
const store=createMemoryHeraStore({scope:'typed'});
await store.putAgent(agent,{scope:'typed',mode:'learn'});await store.putPromptVersion(prompt,{scope:'typed',mode:'learn'});
// @ts-expect-error mode authority has three registered modes
await store.putAgent(agent,{scope:'typed',mode:'administrator'});
// @ts-expect-error task split comes from the adapter, not an arbitrary model label
assertTaskSplit({split:'approved-by-model'},'learn');
const head=emptyHeraHead('typed','library');planHeraHeadTransition(head,head,'a'.repeat(64));
void [schema,artifacts];
const readStore:HeraReadStore={scope:store.scope,get:store.get,query:store.query,readHead:store.readHead};
const contract=createHeraContract(),handlers=createHeraHandlers({store:readStore});
// @ts-expect-error the review binding exposes no write capability
readStore.putAgent(agent,{scope:'typed',mode:'learn'});
void [contract,handlers,contractSchema];
