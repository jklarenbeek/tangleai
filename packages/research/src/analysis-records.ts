import { equalsJson } from '@jarenjs/core/object';
import type { ResearchStageOperation, ResearchStageAccess } from './handlers.ts';
import type { ResearchRecordWrite, ResearchRecordMap, ResearchRecordKind } from './records.ts';
import { validateResearchRecord } from './records.ts';
import { researchValue, researchFail } from './workflow-contract.ts';

export const RESEARCH_EXECUTION_RECORDS_MEDIA = 'application/vnd.tangleai.research-execution-records+json';
export const RESEARCH_ANALYSIS_RECORDS_MEDIA = 'application/vnd.tangleai.research-analysis-records+json';
/** Read only admissions carried by this stage, never an ambient record-store scan. */
export async function readResearchAnalysisInputs(operation: Pick<ResearchStageOperation, 'frame'>, access: ResearchStageAccess) {
  const records = new Map<string, ResearchRecordWrite>();
  for (const ref of operation.frame.artifacts) {
    const descriptor = await access.describeArtifact(ref);
    if (![RESEARCH_EXECUTION_RECORDS_MEDIA, RESEARCH_ANALYSIS_RECORDS_MEDIA].includes(descriptor.mediaType)) continue;
    const envelope = JSON.parse(new TextDecoder().decode(await access.readArtifact(ref))) as { kind: string; value: ResearchRecordWrite[] };
    if (!['execution-records', 'analysis-records'].includes(envelope.kind) || !Array.isArray(envelope.value))
      researchFail('TRSH1001', '/records', 'Analysis needs a complete committed record envelope.');
    for (const row of envelope.value) {
      researchValue(validateResearchRecord(row.kind, row.value));
      if (!('id' in row.value) || 'projectId' in row.value && row.value.projectId !== operation.frame.projectId)
        researchFail('TRSH1005', '/records', 'Analysis evidence belongs to another project.');
      const key = row.kind + ':' + row.value.id, previous = records.get(key);
      if (previous && !equalsJson(row, previous)) researchFail('TRSH1002', '/records', 'Admitted record identity has conflicting content.');
      records.set(key, row);
    }
  }
  return { records: [...records.values()], of: <K extends ResearchRecordKind>(kind: K): ResearchRecordMap[K][] =>
    [...records.values()].filter(row => row.kind === kind).map(row => row.value as ResearchRecordMap[K]) };
}
