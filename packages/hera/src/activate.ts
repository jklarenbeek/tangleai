/** Role activation and rollback use the existing prompt and snapshot fences. */
import {planPromptActivation,planPromptRollback,emptyHeraHead,planHeraHeadTransition} from './heads.ts';
import {prepareHeraPromptRegistry} from './executor.ts';
import {prepareHeraSnapshot,activateSnapshot} from './snapshot.ts';
import {HeraRefusal,heraIssue,type HeraOutcome} from './errors.ts';
import type {HeraTransaction,HeraStore} from './store.ts';
import type {HeraAuthority} from './modes.ts';
import type {HeraHead,HeraPromptVersion} from './contracts.gen.ts';
const must=<T>(value:HeraOutcome<T>):T=>{if(!value.valid)throw new HeraRefusal(value.issues);return value.value;};
export async function activatePromptVersion(tx:HeraTransaction,expected:HeraHead,candidate:HeraPromptVersion){
  const current=await tx.get('head',expected.id)??emptyHeraHead(expected.scope,'prompt',candidate.agentId),previous=current.versionId?await tx.get('promptVersion',current.versionId):undefined;
  return tx.transitionHead(must(planPromptActivation(current,expected,candidate,previous)));
}
export async function rollbackPromptVersion(store:HeraStore,input:{agentId:string;toVersionId:string;expectedPrompt:HeraHead;expectedSnapshot:HeraHead},authority:HeraAuthority){
  return store.transaction(authority,async tx=>{
    const current=await tx.get('head',input.expectedPrompt.id)??emptyHeraHead(authority.scope,'prompt',input.agentId),snapshotHead=await tx.get('head',input.expectedSnapshot.id)??emptyHeraHead(authority.scope,'snapshot');
    const target=await tx.get('promptVersion',input.toVersionId),previous=current.versionId?await tx.get('promptVersion',current.versionId):undefined,parent=snapshotHead.versionId?await tx.get('snapshot',snapshotHead.versionId):undefined;
    if(!target||!previous||!parent||target.agentId!==input.agentId||parent.scope!==authority.scope||parent.activePromptVersionIds[input.agentId]!==previous.id)
      throw new HeraRefusal([heraIssue('THERA1006','/rollback','Rollback requires a retained current snapshot and both role versions.')]);
    must(planHeraHeadTransition(snapshotHead,input.expectedSnapshot,parent.id));
    const promptPlan=must(planPromptRollback(current,input.expectedPrompt,target,previous)),promptIds={...parent.activePromptVersionIds,[input.agentId]:target.id};
    const registry=must(await prepareHeraPromptRegistry({getAgent:id=>tx.get('agent',id),getPromptVersion:id=>tx.get('promptVersion',id)},authority.scope,promptIds));
    const staged=must(await prepareHeraSnapshot(parent,{activePromptVersionIds:promptIds,registryRevision:registry.registry.revision}));
    await tx.transitionHead(promptPlan);await tx.put('snapshot',staged.snapshot);await activateSnapshot(tx,input.expectedSnapshot,staged.snapshot);
    return {promptVersion:{...target,status:'active' as const},snapshot:{...staged.snapshot,status:'active' as const}};
  });
}
