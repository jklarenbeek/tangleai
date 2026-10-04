/** Scientific evidence comes only from exact artifact admissions in the current frame. */
import { equalsJson } from '@jarenjs/core/object';
import type { ResearchStageOperation, ResearchStageAccess } from './handlers.ts';
import type { ResearchRecordWrite, ResearchRecordKind, ResearchRecordMap } from './records.ts';
import type { ResearchWritingInputs, Draft, ResearchClaimLedger } from './contracts.gen.ts';
import { validateResearchRecord } from './records.ts';
import { researchFail, researchValue } from './workflow-contract.ts';
import { validateResearchWritingInputs } from './stages/claims.ts';
import { RESEARCH_REASONING_MEDIA_TYPE } from './reasoning-records.ts';
import { RESEARCH_EXECUTION_RECORDS_MEDIA, RESEARCH_ANALYSIS_RECORDS_MEDIA } from './analysis-records.ts';
import type { ResearchWritingPolicy } from './writing-contract.ts';

export const RESEARCH_WRITING_RECORDS_MEDIA = 'application/vnd.tangleai.research-writing-records+json';
export async function readResearchWritingInputs(operation: ResearchStageOperation, access: ResearchStageAccess, policy: ResearchWritingPolicy) {
  const records = new Map<string, ResearchRecordWrite>(), drafts: Draft[] = [], ledgers: ResearchClaimLedger[] = [];
  const media = ['application/json', RESEARCH_REASONING_MEDIA_TYPE, RESEARCH_EXECUTION_RECORDS_MEDIA, RESEARCH_ANALYSIS_RECORDS_MEDIA, RESEARCH_WRITING_RECORDS_MEDIA];
  for (const ref of operation.frame.artifacts) {
    if (!media.includes((await access.describeArtifact(ref)).mediaType)) continue;
    const envelope = JSON.parse(new TextDecoder().decode(await access.readArtifact(ref))) as {
      kind?: string; pivot?: number; reviewOrdinal?: number; attemptId?: string; phase?: string; value?: ResearchRecordWrite[] };
    if (!['discovery-records', 'reasoning-records', 'execution-records', 'analysis-records', 'writing-records'].includes(envelope.kind ?? '')) continue;
    if (!Array.isArray(envelope.value)) researchFail('TRSH1001', '/records', 'Writing requires complete committed record envelopes.');
    if (envelope.kind === 'reasoning-records' && envelope.pivot !== operation.frame.pivot) continue;
    for (const row of envelope.value) {
      researchValue(validateResearchRecord(row.kind, row.value));
      if (!('id' in row.value) || 'projectId' in row.value && row.value.projectId !== operation.frame.projectId)
        researchFail('TRSH1005', '/records', 'Writing evidence belongs to another project or lacks an immutable identity.');
      const key = row.kind + ':' + row.value.id, prior = records.get(key);
      if (prior && !equalsJson(prior, row)) researchFail('TRSH1002', '/records', 'An admitted record identity has conflicting content.');
      records.set(key, row);
      if (envelope.kind === 'writing-records' && envelope.reviewOrdinal === operation.frame.review && envelope.phase === 'write') {
        if (!envelope.attemptId) researchFail('TRSH1005', '/records/attemptId', 'A draft must identify its committed writer attempt.');
        if (row.kind === 'Draft') drafts.push(row.value);
        if (row.kind === 'ResearchClaimLedger') ledgers.push(row.value);
      }
    }
  }
  const of = <K extends ResearchRecordKind>(kind: K): ResearchRecordMap[K][] => [...records.values()]
    .filter(row => row.kind === kind).map(row => row.value as ResearchRecordMap[K]);
  const unique = <T extends { id: string }>(rows: T[]): T[] => [...new Map(rows.map(row => [row.id, row])).values()];
  const one = <T>(rows: T[], path: string): T => { if (rows.length !== 1) researchFail('TRSH1005', path, 'Writing requires exactly one current admitted record.'); return rows[0]; };
  const contract = one(of('ResearchContract').filter(row => row.contractHash === operation.expectedState.contractHash), '/contract');
  const plan = one(of('ExperimentPlan').filter(row => row.planHash === operation.expectedState.planHash), '/plan');
  const decision = one(of('ResearchDecision').filter(row => row.contractHash === contract.contractHash
    && row.details?.attemptOrdinal === operation.frame.attempt && row.details.pivotOrdinal === operation.frame.pivot), '/decision');
  const analysis = one(of('Analysis').filter(row => row.id === decision.details?.analysisId && row.planHash === plan.planHash), '/analysis');
  const cards = of('EvidenceCard').sort((a, b) => a.id.localeCompare(b.id));
  if (!cards.length || cards.length > policy.maxCards) researchFail('TRSH1006', '/cards', 'The complete admitted card set exceeds the writer policy or is empty.');
  const input: ResearchWritingInputs = { projectId: operation.frame.projectId, scope: 'research-draft', contract, plan, decision, analysis,
    cards, literature: of('LiteratureRecord').filter(row => cards.some(card => card.literatureId === row.id)).sort((a, b) => a.id.localeCompare(b.id)),
    observations: of('MetricObservation').filter(row => analysis.observationIds.includes(row.id)) };
  return { input: researchValue(await validateResearchWritingInputs(input)),
    draft: operation.stage === 'verify' ? one(unique(drafts), '/draft') : null,
    ledger: operation.stage === 'verify' ? one(unique(ledgers), '/ledger') : null };
}
