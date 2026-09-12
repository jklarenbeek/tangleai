/** Snapshot-bounded audit paging and finite immutable ancestry inspection. */
import { checkShape } from './schema.ts';
import { keyId, outcomeRevision } from './identity.ts';
import { readRecord } from './persistence.ts';
import { reject } from './errors.ts';
import type { ServiceContext } from './service-context.ts';
import type { HistoryCommand, HistoryPage, InspectCommand, Inspection, OutcomeRecord, ArtifactVersion } from './outcomes.contracts.gen.ts';

export async function historyPage(context: ServiceContext, command: HistoryCommand): Promise<HistoryPage> {
  return context.atomic().transaction(async tx => {
    const { scopeId, artifactKey, input } = command;
    const sequenceId = await keyId(scopeId, 'sequence', null);
    const sequence = await tx.get('keys', sequenceId);
    const current = sequence?.value ?? 0;
    if (!Number.isSafeInteger(current) || Number(current) < 0 || (sequence && (sequence.id !== sequenceId || sequence.scopeId !== scopeId))) reject('OUTC1002', 'Audit sequence is corrupted.');
    const filterId = await outcomeRevision({ scopeId, artifactKey, revision: 'outcome-history/v1', kind: 'all' });
    const cursor = input.cursor;
    if (cursor && (cursor.scopeId !== scopeId || cursor.artifactKey !== artifactKey || cursor.filterId !== filterId)) reject('OUTC1003', 'Cursor scope or filter differs.');
    const upper = cursor?.upper ?? Number(current), after = cursor?.after ?? 0;
    if (after > upper || upper > Number(current)) reject('OUTC1001', 'Cursor sequence is invalid.');
    const pageSize = input.pageSize ?? 50;
    const rows = await tx.query('records', { scopeId, artifactKey, after, upper, limit: pageSize + 1 });
    const entries = [];
    let previous = after;
    for (const row of rows.slice(0, pageSize)) {
      checkShape('storedRecord', row);
      if (row.seq <= previous || row.seq > upper) reject('OUTC1002', 'Audit ordering is corrupted.');
      entries.push({ sequence: row.seq, record: await readRecord(tx, row.id, scopeId, artifactKey) });
      previous = row.seq;
    }
    return { entries, upper, cursor: rows.length > pageSize ? { scopeId, artifactKey, filterId, after: previous, upper } : null };
  });
}

export async function inspectRecord(context: ServiceContext, command: InspectCommand): Promise<OutcomeRecord | Inspection> {
  return context.atomic().transaction(async tx => {
    const record = await readRecord(tx, command.input.id, command.scopeId, command.artifactKey);
    if (!command.input.includeLineage) return record;
    const lineage: ArtifactVersion[] = [], visited = new Set<string>();
    let next = record.kind === 'artifactVersion' ? record.id : null;
    while (next !== null) {
      if (visited.has(next) || lineage.length >= context.policy.maxVersions) reject('OUTC1002', 'Artifact ancestry cycles or exceeds its retained bound.');
      visited.add(next);
      const version = await readRecord(tx, next, command.scopeId, command.artifactKey);
      if (version.kind !== 'artifactVersion') reject('OUTC1002', 'Artifact ancestry points to another record kind.');
      if (record.kind === 'artifactVersion' && (version.policyId !== record.policyId || version.adapter.revision !== record.adapter.revision || version.payloadSchema !== record.payloadSchema)) reject('OUTC1002', 'Artifact ancestry revisions differ.');
      lineage.push(version); next = version.parentVersionId;
    }
    return { record, lineage };
  });
}
