/** Evidence scope and ledger preservation; citation validity does not prove entailment. */
import {equalsJson} from '@jarenjs/core/object';
import {validateGmplShape} from './schema.ts';
import {gmplRefuse,type GmplOutcome} from './errors.ts';
import type {GmplPatternResult,GmplEvidenceUnit,GmplFinding} from './contracts.gen.ts';
export function validateGmplEvidence(result:unknown,evidence:readonly GmplEvidenceUnit[],prior:readonly GmplFinding[]=[]):GmplOutcome<GmplPatternResult>{
  const shape=validateGmplShape<GmplPatternResult>('gmplPatternResult',result);if(!shape.valid)return shape;
  const ids=new Set<string>();
  for(const [i,e] of evidence.entries()){
    const s=validateGmplShape<GmplEvidenceUnit>('gmplEvidenceUnit',e);
    if(!s.valid||ids.has(e.id))return gmplRefuse('TGMPL1005',`/evidence/${i}`,'invalid or duplicate visible evidence');ids.add(e.id);
  }
  const value=shape.value;
  for(const group of ['claims','findings'] as const)for(const [i,item] of value[group].entries()){
    for(const [j,c] of item.citations.entries())if(!evidence.some(e=>e.id===c.id&&e.digest===c.digest))return gmplRefuse('TGMPL1005',`/${group}/${i}/citations/${j}`,'citation is absent from this role visibility or its digest changed');
  }
  if(new Set(value.findings.map(f=>f.id)).size!==value.findings.length)return gmplRefuse('TGMPL1005','/findings','finding ids must be unique');
  for(const f of prior){
    if(f.disposition!=='supported'&&f.disposition!=='contested'&&f.disposition!=='unresolved')continue;
    const next=value.findings.find(n=>n.id===f.id);
    if(!next||next.origin!==f.origin||!next.reason.trim()||!next.citations.length)return gmplRefuse('TGMPL1005','/findings',`finding '${f.id}' was silently lost or reattributed`);
    if((f.critical&&!next.critical)||(f.contradictory&&!next.contradictory))return gmplRefuse('TGMPL1005','/findings',`finding '${f.id}' lost its original criticality or contradiction marker`);
    if(next.disposition!==f.disposition&&next.reason===f.reason)return gmplRefuse('TGMPL1005','/findings',`finding '${f.id}' changed disposition without a new evidenced reason`);
  }
  return shape;
}
export function mergeGmplFindings(groups:readonly (readonly GmplFinding[])[]):GmplOutcome<GmplFinding[]>{
  const ledger=new Map<string,GmplFinding>();
  for(const group of groups)for(const f of group){
    const old=ledger.get(f.id);
    if(old&&!equalsJson(old,f))return gmplRefuse('TGMPL1005','/findings',`conflicting concurrent versions of finding '${f.id}' require an explicit disposition`);
    ledger.set(f.id,f);
  }
  return {valid:true,value:[...ledger.values()]};
}
