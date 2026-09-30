/** Evidence stays pinned and enters role messages only through MAS context or tools. */
import { validateGmplEvidence, validateGmplShape, gmplTextDigest, type GmplPatternResult, type GmplEvidenceUnit } from '@tangleai/gmpl';
import { validateClaimEvidence } from '@tangleai/context';
import type { ClaimEvidenceEnvelope } from '@tangleai/context/schemas/evidence';
import { heraIssue, heraRefuse, type HeraOutcome } from './errors.ts';
import { heraRevisionOf } from './identity.ts';
import type { HeraIssue } from './contracts.gen.ts';
export interface HeraEvidenceUnit extends GmplEvidenceUnit { address: string; }
export interface HeraEvidenceProvider {
  /** Identity of the provider policy as well as its corpus; no credential or path. */
  revision: string;
  /** The host names the native lane; documents is the default for plain fixture providers. */
  contextAdapter?: 'documents' | 'memory';
  currentCorpusRevision(): string | Promise<string>;
  recall(query: string, options: {k: number; signal: AbortSignal; idempotencyKey?: string | null}): Promise<HeraEvidenceUnit[]>;
}
export interface HeraAnswerEvidence {
  answer: string;
  citations: Array<{id:string;digest:string}>;
  citationRecall: number;
  unsupported: HeraIssue[];
  envelope: ClaimEvidenceEnvelope;
  envelopeId: string;
}
export async function validateHeraEvidenceUnits(value: readonly HeraEvidenceUnit[]): Promise<HeraOutcome<HeraEvidenceUnit[]>> {
  const seen = new Set<string>();
  for (const [index, unit] of value.entries()) {
    const {address,...evidence} = unit;
    if (typeof address !== 'string' || !address || seen.has(unit.id) || !validateGmplShape('gmplEvidenceUnit',evidence).valid || unit.digest !== await gmplTextDigest(unit.text))
      return heraRefuse('THERA1002','/evidence/' + index,'Evidence must have unique ids, exact text digests and durable addresses.');
    seen.add(unit.id);
  }
  return {valid:true,value:structuredClone([...value])};
}
export async function assertHeraCorpus(provider: HeraEvidenceProvider, revision: string): Promise<HeraOutcome<true>> {
  return await provider.currentCorpusRevision() === revision ? {valid:true,value:true}
    : heraRefuse('THERA1002','/corpusRevision','The pinned corpus has been superseded.');
}
/** Unsupported citations survive as counted values; the scorer decides their effect. */
export async function validateHeraAnswer(result: GmplPatternResult, visible: readonly HeraEvidenceUnit[]): Promise<HeraAnswerEvidence> {
  const evidence = visible.map(({id,digest,text})=>({id,digest,text}));
  const gate = validateGmplEvidence(result,evidence);
  const proposed = [...result.claims,...result.findings].flatMap(c=>c.citations);
  const known = (c:{id:string;digest:string}) => visible.some(e=>e.id===c.id && e.digest===c.digest);
  const unsupported: HeraIssue[] = proposed.flatMap((c,index)=>known(c)?[]:[heraIssue('THERA1005','/citations/'+index,'Citation is absent from the final role visibility or its digest changed.')]);
  if (!gate.valid && unsupported.length===0) unsupported.push(heraIssue('THERA1005','/answer','The final evidence ledger failed GMPL validation.',gate.issues));
  const citations = [...new Map(proposed.filter(known).map(c=>[c.id,c])).values()];
  const envelope: ClaimEvidenceEnvelope = {version:1,
    artifacts:visible.map(e=>({id:e.id,kind:'hera-evidence',locator:e.address,digest:e.digest})),
    evidence:visible.map(e=>({id:e.id,artifact:e.id,quote:e.text})),visibleEvidence:visible.map(e=>e.id),
    claims:result.claims.map((claim,index)=>({id:'claim-'+(index+1),text:claim.text,critical:false,
      status:claim.citations.length>0 && claim.citations.every(known)?'supported':'unresolved',
      evidence:[...new Set(claim.citations.filter(known).map(c=>c.id))]}))};
  const checked = validateClaimEvidence(envelope,{artifacts:envelope.artifacts});
  if (!checked.valid) throw new TypeError('HERA claim projection failed: '+JSON.stringify(checked.errors));
  return {answer:result.answer,citations,citationRecall:proposed.length?proposed.filter(known).length/proposed.length:result.disposition==='needs-information'?1:0,
    unsupported,envelope,envelopeId:await heraRevisionOf(envelope)};
}

import { CLAIM_EVIDENCE_SCHEMA } from '@tangleai/context';
import { createDocumentsContextProvider, createMemoryContextProvider, type MasContextProvider, type MasToolBinding } from '@tangleai/mas';
import { recallDocumentChunks } from '@tangleai/documents/retrieval';
import type { DocumentCorpusStore } from '@tangleai/documents/contracts';
import { recallByEmbedding } from '@tangleai/memory/retrieval';
import type { Embedder } from '@tangleai/models/embed';
type MemoryUnit = Parameters<typeof recallByEmbedding>[0][number];
import { heraSchemaOf } from './schema.ts';
export const HERA_ANSWER_SCHEMA = {type:'object',properties:{answer:{type:'string'},citations:{type:'array',items:heraSchemaOf('gmplCitation')},
  citationRecall:{type:'number',minimum:0,maximum:1},unsupported:{type:'array',items:heraSchemaOf('heraIssue')},
  envelope:CLAIM_EVIDENCE_SCHEMA,envelopeId:{type:'string',pattern:'^[0-9a-f]{64}$'}},
  required:['answer','citations','citationRecall','unsupported','envelope','envelopeId'],additionalProperties:false};
/** Native document recall supplies admitted units without a second ranking kernel. */
export function createHeraDocumentEvidenceProvider(options:{store:DocumentCorpusStore;embedder:Embedder;corpusRevision:string;currentCorpusRevision:()=>string|Promise<string>;revision:string}):HeraEvidenceProvider {
  return {contextAdapter:'documents',revision:options.revision,currentCorpusRevision:options.currentCorpusRevision,async recall(query,{k,signal}) {
    signal.throwIfAborted();
    if(await options.currentCorpusRevision()!==options.corpusRevision)throw Error('The HERA document corpus pin has been superseded.');
    const [vector]=await options.embedder.embed([query]);
    const identity={model:options.embedder.model,dims:options.embedder.dims??vector.length};
    const found=await recallDocumentChunks(options.store,vector,identity,{k,minScore:0,neighbours:0,maxPerSource:k});
    signal.throwIfAborted();
    if(await options.currentCorpusRevision()!==options.corpusRevision)throw Error('The HERA document corpus changed during recall.');
    return Promise.all(found.ranked.map(async ({chunk})=>({id:chunk.id,digest:await gmplTextDigest(chunk.text),text:chunk.text,address:`document:${chunk.sourceId}/${chunk.versionId}/${chunk.id}`})));
  }};
}
/** Native memory recall is offered as an explicit host capability. */
export function createHeraMemoryEvidenceProvider(options:{units:()=>Promise<MemoryUnit[]>;embedder:Embedder;corpusRevision:string;currentCorpusRevision:()=>string|Promise<string>;revision:string}):HeraEvidenceProvider {
  return {contextAdapter:'memory',revision:options.revision,currentCorpusRevision:options.currentCorpusRevision,async recall(query,{k,signal}) {
    signal.throwIfAborted();
    if(await options.currentCorpusRevision()!==options.corpusRevision)throw Error('The HERA memory corpus pin has been superseded.');
    const [vector]=await options.embedder.embed([query]),identity={model:options.embedder.model,dims:options.embedder.dims??vector.length};
    const found=recallByEmbedding(await options.units(),vector,{k,minScore:0,identity});
    signal.throwIfAborted();
    if(await options.currentCorpusRevision()!==options.corpusRevision)throw Error('The HERA memory corpus changed during recall.');
    return Promise.all(found.ranked.map(async ({unit})=>({id:unit.id,digest:await gmplTextDigest(unit.text),text:unit.text,address:`memory:${unit.id}`})));
  }};
}
/** The already admitted slice is persisted in the run; reopening never recalls a different slice. */
export function createHeraContextBindings(units:readonly HeraEvidenceUnit[],corpusRevision:string,lane:'documents'|'memory'='documents'):Record<string,MasContextProvider> {
  const source=lane==='documents'
    ?createDocumentsContextProvider({recallChunks:async()=>units.map(e=>({sourceId:'hera',versionId:corpusRevision,chunkId:e.id,text:JSON.stringify(e)}))})
    :createMemoryContextProvider({recall:async()=>units.map(e=>({id:e.id,text:JSON.stringify(e)}))});
  const bound:MasContextProvider={id:lane,async read(request,options){
    const outcome=await source.read(request,options);
    if(outcome.outcome!=='ok')return outcome;
    return {...outcome,units:outcome.units.map(unit=>({...unit,address:units.find(e=>e.id===unit.citation)!.address}))};
  }};
  return {documents:createDocumentsContextProvider(null),memory:createMemoryContextProvider(null),[lane]:bound};
}
export function createHeraEvidenceTool(provider:HeraEvidenceProvider,corpusRevision:string):MasToolBinding {
  return {idempotency:'honored',async handler(input,context){
    const pin=await assertHeraCorpus(provider,corpusRevision);if(!pin.valid)return {valid:false,issues:pin.issues};
    const {query,k}=input as {query:string;k:number};
    const found=await provider.recall(query,{k,signal:context.signal,idempotencyKey:context.idempotencyKey});
    const after=await assertHeraCorpus(provider,corpusRevision);if(!after.valid)return {valid:false,issues:after.issues};
    if(found.length>k)return heraRefuse('THERA1007','/evidence','The evidence provider exceeded the requested unit bound.');
    const checked=await validateHeraEvidenceUnits(found);return checked.valid?{units:checked.value}:{valid:false,issues:checked.issues};
  }};
}
