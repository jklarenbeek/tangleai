/** Explicit bounded display records; transcripts and tool-result bodies stay private. */
import type * as C from './contracts.gen.ts';
import { reject } from './errors.ts';
import { forecastGuidanceRef } from './refiner.ts';

const text = (value: string, max = 512) => Array.from(value).slice(0,max).join('');
const scalar = (value: string | number) => typeof value === 'string' ? text(value,4096) : value;
const hashes = (values: readonly string[], max = 10000) => values.slice(0,max).map(v => text(v,64));
const strings = (values: readonly string[], max: number, length = 128) => values.slice(0,max).map(v => text(v,length));
function address(value: C.EvidenceAddress): C.ForecastReadAddress {
  return 'url' in value ? { url: text(value.url,4096) } : { corpus: text(value.corpus),snapshotId: text(value.snapshotId) };
}
function adapter(value: C.ForecastAdapter): C.ForecastReadAdapter {
  return value.id === 'choice/v1' ? { id: value.id,version: text(value.version,256),options: strings(value.options,1000,512) }
    : { id: value.id,version: text(value.version,256),tolerance: value.tolerance,range: value.range.slice(0,2),...(value.unit === undefined ? {} : { unit: text(value.unit,256) }) };
}
function issue(value: C.ForecastIssue): C.ForecastReadDomainIssue {
  if (value.cause !== undefined && !Array.isArray(value.cause)) reject('TFCT1001','The retained issue cause is not a supported outcome issue list.');
  return { code: value.code,path: text(value.path),detail: text(value.detail,4096),retryable: value.retryable,...(Array.isArray(value.cause) ? { cause: value.cause.slice(0,1000).map(outcomeIssue) } : {}) };
}
function outcomeIssue(value: unknown): C.ForecastReadIssue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject('TFCT1001','The retained outcome issue is not an object.');
  const r = value as Record<string,unknown>;
  if (typeof r.code !== 'string' || typeof r.path !== 'string' || typeof r.detail !== 'string' || typeof r.retryable !== 'boolean') reject('TFCT1001','The retained outcome issue lacks required fields.');
  return { code: text(r.code,32),path: text(r.path),detail: text(r.detail,4096),retryable: r.retryable };
}
function spend(value: C.Spend): C.Spend { return { calls: value.calls,tokens: value.tokens,ms: value.ms,usageKnown: value.usageKnown }; }
function failure(value: C.CheckpointFailure | null): C.ForecastReadFailure | null { return value ? { code: text(value.code,32),detail: text(value.detail,2048) } : null; }
export function projectQuestionSummary(q: C.ForecastQuestion, checkpoints: readonly C.ForecastCheckpoint[]): C.ForecastReadQuestionSummary {
  return { id: q.id,scopeKey: text(q.scopeKey),status: q.status,ordinalsPlanned: q.checkpointPolicy.ordinals.slice(0,1000),ordinalsFinished: checkpoints.filter(c => c.questionId === q.id && ['finalized','failed'].includes(c.status)).map(c => c.ordinal).sort((a,b) => a-b).slice(0,1000),startedFromCheckedVersionId: q.startedFromCheckedVersionId };
}
export function projectCheckpointSummary(c: C.ForecastCheckpoint): C.ForecastReadCheckpointSummary {
  return { id: c.id,questionId: c.questionId,ordinal: c.ordinal,scheduledAt: c.scheduledAt,cutoffAt: c.cutoffAt,status: c.status,stopReason: c.stopReason === null ? null : text(c.stopReason),spend: spend(c.spend) };
}
export function projectQuestion(q: C.ForecastQuestion, checkpoints: readonly C.ForecastCheckpoint[], lineage: readonly C.ForecastHarnessVersion[]): NonNullable<C.ForecastReadQuestion> {
  return { ...projectQuestionSummary(q,checkpoints),prompt: text(q.prompt,16384),issuedAt: q.issuedAt,expectedResolutionAt: q.expectedResolutionAt,latestProvisionalVersionId: q.latestProvisionalVersionId,promptRevision: q.promptRevision,toolsetRevision: q.toolsetRevision,adapter: adapter(q.adapter),checkpointPolicy: { ordinals: q.checkpointPolicy.ordinals.slice(0,1000),scheduledAt: q.checkpointPolicy.scheduledAt.slice(0,1000) },checkpoints: checkpoints.filter(c => c.questionId === q.id).sort((a,b) => a.ordinal-b.ordinal).slice(0,1000).map(projectCheckpointSummary),harnessLineageIds: lineage.filter(h => h.scopeKey === q.scopeKey && (h.questionId === q.id || h.id === q.startedFromCheckedVersionId || h.checkedVersionId === q.startedFromCheckedVersionId || h.provenance.seed)).slice(0,10000).map(h => h.id) };
}
export function projectEvidence(e: C.ForecastEvidence): C.ForecastReadEvidence {
  const excerpt = text(e.excerpt,2048);
  return { id: e.id,checkpointId: e.checkpointId,kind: e.kind,address: address(e.address),availableAt: e.availableAt,fetchedAt: e.fetchedAt,claimedPublishedAt: e.claimedPublishedAt,sha256: e.sha256,bytes: e.bytes,admitted: e.admitted,refusal: e.refusal ? { code: text(e.refusal.code,32),reason: text(e.refusal.reason,1024) } : null,excerpt,excerptTruncated: excerpt !== e.excerpt };
}
export function projectCheckpoint(c: C.ForecastCheckpoint, prediction: C.ForecastPrediction | null, evidence: readonly C.ForecastEvidence[], revisions: readonly C.HarnessRevision[]): NonNullable<C.ForecastReadCheckpoint> {
  const own = evidence.filter(e => e.checkpointId === c.id), p = prediction?.checkpointId === c.id ? prediction : null;
  return { ...projectCheckpointSummary(c),startedAt: c.startedAt,endedAt: c.endedAt,inputHarnessVersionId: c.inputHarnessVersionId,inputHarnessDigest: c.inputHarnessDigest,traceId: c.traceId,noteId: c.noteId,decisionId: c.decisionId,treatment: c.treatment,configuration: c.configuration.kind === 'scripted' ? { kind: 'scripted',revision: c.configuration.revision } : { kind: 'model',identityId: c.configuration.identityId },promptRevision: c.promptRevision,toolsetRevision: c.toolsetRevision,noteSchemaRevision: c.noteSchemaRevision,prediction: p ? { id: p.id,normalized: scalar(p.normalized),normalizedTruncated: scalar(p.normalized) !== p.normalized,adapterId: text(p.adapterId,128),adapterVersion: text(p.adapterVersion,128),uncertainty: p.uncertainty ? { probability: p.uncertainty.probability } : null } : null,evidence: { total: own.length,admitted: own.filter(e => e.admitted).length,refused: own.filter(e => !e.admitted).length,refusals: own.filter(e => e.refusal).slice(0,10000).map(e => ({ id: e.id,code: text(e.refusal!.code,32),reason: text(e.refusal!.reason,1024) })) },revisionIds: revisions.filter(r => r.checkpointId === c.id).slice(0,10000).map(r => r.id),failure: failure(c.failure),noteFailure: failure(c.noteFailure) };
}
export function projectNote(n: C.CheckpointNote): NonNullable<C.ForecastReadNote> {
  return { id: n.id,checkpointId: n.checkpointId,traceId: n.traceId,noteSchemaRevision: n.noteSchemaRevision,evidenceIds: hashes(n.evidenceIds),sections: { questionState: text(n.sections.questionState,8192),keyEvidence: text(n.sections.keyEvidence,8192),mainJudgmentTrajectory: text(n.sections.mainJudgmentTrajectory,8192),helpfulSignals: text(n.sections.helpfulSignals,8192),misleadingOrFragileSignals: text(n.sections.misleadingOrFragileSignals,8192),unresolvedRisks: text(n.sections.unresolvedRisks,8192) } };
}
export function projectTrace(trace: C.ForecastTrace, cursor = 0, limit = 2048): NonNullable<C.ForecastReadTrace> {
  if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 4096) reject('TFCT1001','Invalid trace page bounds.');
  const steps = trace.steps.slice(0,1000).map((value,index) => {
    const r = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const names = [typeof r.tool === 'string' ? r.tool : null,...(Array.isArray(r.toolCalls) ? r.toolCalls.map(t => t && typeof t === 'object' && !Array.isArray(t) && typeof t.name === 'string' ? t.name : null) : [])].filter((s): s is string => typeof s === 'string');
    return { name: text(typeof r.type === 'string' ? r.type : typeof r.name === 'string' ? r.name : 'step-' + index,128),tools: strings(names,100,128) };
  });
  const chars = Array.from(steps.map((s,i) => `${i}: ${s.name}${s.tools.length ? ' [' + s.tools.join(', ') + ']' : ''}`).join('\n'));
  if (cursor > chars.length) reject('TFCT1001','The trace cursor is outside its projected metadata.');
  const next = Math.min(chars.length,cursor + limit);
  return { id: trace.id,checkpointId: trace.checkpointId,bytes: trace.bytes,truncated: { steps: trace.truncated.steps,chars: trace.truncated.chars },omittedSteps: Math.max(0,trace.steps.length-steps.length),steps,excerpt: chars.slice(cursor,next).join(''),cursor,nextCursor: next < chars.length ? next : null,totalChars: chars.length };
}
const guidance = (g: C.Guidance): C.ForecastReadGuidance => ({ text: text(g.text,4096),sources: strings(g.sources,32) });
export async function projectRevision(r: C.HarnessRevision): Promise<NonNullable<C.ForecastReadRevision>> {
  return { id: r.id,questionId: r.questionId,checkpointId: r.checkpointId,comparedNoteIds: hashes(r.comparedNoteIds),candidateVersionId: r.candidateVersionId,traceReads: r.traceReads,provisionalDiagnoses: r.provisionalDiagnoses.slice(0,32).map(guidance),committedGuidance: await Promise.all(r.committedGuidance.slice(0,32).map(async g => ({ ...guidance(g),component: g.component,guidanceRef: await forecastGuidanceRef(r.id,g) }))),deferredFeedback: r.deferredFeedback.slice(0,32).map(g => ({ ...guidance(g),...(g.component === undefined ? {} : { component: g.component }),reason: text(g.reason) })),patchOpCount: r.patch.length,gate: { volatileFact: { refused: r.gate.volatileFact.refused,items: strings(r.gate.volatileFact.items,1000,512) },semantic: { stage: text(r.gate.semantic.stage,128),revision: r.gate.semantic.revision } },validation: { ok: r.validation.ok,issues: r.validation.issues.slice(0,1000).map(issue) } };
}
export function projectHarness(h: C.ForecastHarnessVersion): NonNullable<C.ForecastReadHarness> {
  return { id: h.id,scopeKey: text(h.scopeKey),questionId: h.questionId,parentVersionId: h.parentVersionId,document: { factorTracking: text(h.document.factorTracking,4096),evidenceHandling: text(h.document.evidenceHandling,4096),uncertaintyHandling: text(h.document.uncertaintyHandling,4096) },digest: h.digest,status: h.status,checkedVersionId: h.checkedVersionId,provenance: { revisionId: h.provenance.revisionId,retrospectiveId: h.provenance.retrospectiveId,seed: h.provenance.seed },recordedAt: h.recordedAt };
}
export function projectHead(head: { versionId: string; digest: string; revision: number } | null): C.ForecastReadHead | null { return head ? { versionId: head.versionId,digest: head.digest,revision: head.revision } : null; }
function resolutionFact(r: C.ForecastResolution): C.ForecastReadResolutionFact { return { id: r.id,questionId: r.questionId,observedAt: r.observedAt,receivedAt: r.receivedAt,outcome: scalar(r.outcome),evidence: r.evidence.slice(0,1000).map(e => ({ address: address(e.address),sha256: e.sha256 })) }; }
export function projectResolution(r: C.ForecastResolution, disputed: boolean, corrections: readonly C.ForecastResolution[] = []): NonNullable<C.ForecastReadResolution> {
  return { ...resolutionFact(r),scorerId: text(r.scorerId,128),scorerVersion: text(r.scorerVersion,128),scoringStatus: r.scoringStatus ?? 'legacy',disputed,correctionsTruncated: corrections.filter(c => c.correctionOf === r.id && c.questionId === r.questionId).length > 1000,losses: r.losses.slice(0,1000).map(l => ({ checkpointId: l.checkpointId,decisionId: l.decisionId,resolutionId: l.resolutionId,scoreId: l.scoreId,category: l.category,utility: l.utility })),skipped: r.skipped.slice(0,1000).map(s => ({ checkpointId: s.checkpointId,reason: s.reason })),corrections: corrections.filter(c => c.correctionOf === r.id && c.questionId === r.questionId).slice(0,1000).map(c => ({ ...resolutionFact(c),correctionOf: c.correctionOf! })) };
}
export function projectRetrospective(r: C.RetrospectiveCheck): NonNullable<C.ForecastReadRetrospective> {
  return { id: r.id,questionId: r.questionId,resolutionId: r.resolutionId,candidateVersionId: r.candidateVersionId,outcome: r.outcome,verdicts: r.verdicts.slice(0,1000).map(v => ({ guidanceRef: text(v.guidanceRef,128),verdict: v.verdict,reason: text(v.reason),sources: strings(v.sources,32),refinedText: v.refinedText === null ? null : text(v.refinedText) })),reflect: r.reflect ? { reflectionId: r.reflect.reflectionId,versionId: r.reflect.versionId,noOp: r.reflect.noOp } : null,evaluation: r.evaluation ? { evaluationId: r.evaluation.evaluationId,eligible: r.evaluation.eligible,issues: r.evaluation.issues.slice(0,1000).map(outcomeIssue) } : null,promotion: r.promotion ? { approvalId: r.promotion.approvalId,activationEventId: r.promotion.activationEventId,head: { versionId: r.promotion.head.versionId,revision: r.promotion.head.revision } } : null,issues: (r.issues ?? []).slice(0,1000).map(issue) };
}
export function projectDue(s: C.ForecastSchedule): C.ForecastReadDue { return { id: s.id,questionId: s.questionId,ordinal: s.ordinal,scheduledAt: s.scheduledAt,cutoffAt: s.cutoffAt,status: s.status }; }
