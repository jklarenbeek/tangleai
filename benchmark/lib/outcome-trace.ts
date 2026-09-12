/** Independently join measured rows to immutable decision, evidence and score bytes. */
import { equalsJson } from '@jarenjs/core/object';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { validateRecord } from '@tangleai/outcomes';
import { baselineScore, utilityOf } from './outcome-conformance.ts';
import quality from '../fixtures/outcome/quality.json' with { type: 'json' };
import { validateActivationRecords } from './outcome-activation-trace.ts';
import type { Row, Trace } from './outcome-conformance.types.ts';
import type { OutcomeRecord } from '@tangleai/outcomes';

export async function validateOutcomeTrace(row: Row, trace: Trace): Promise<void> {
  if (row.id !== trace.rowId || row.counts.writes !== trace.writes) throw Error('Outcome trace ownership or write count differs');
  const records: OutcomeRecord[] = [];
  for (const raw of trace.records) records.push(await validateRecord(raw));
  const ids = new Map(records.map(r => [r.id, r]));
  if (ids.size !== records.length) throw Error('Outcome trace repeats a record');
  const get = <K extends OutcomeRecord['kind']>(id: string, kind: K): Extract<OutcomeRecord, { kind: K }> => {
    const record = ids.get(id); if (!record || record.kind !== kind) throw Error(`Outcome trace missing ${kind}`);
    return record as Extract<OutcomeRecord, { kind: K }>;
  };
  let applied = 0, missing = 0, changed = 0;
  const decisions = records.filter(r => r.kind === 'decision');
  if (decisions.length !== row.cases.length) throw Error('Outcome trace decision denominator differs');
  for (const c of row.cases) {
    const fixture = quality.find(f => f.id === c.id); if (!fixture) throw Error('Outcome trace unregistered case');
    const matching = decisions.filter(d => d.decisionKey === c.id); if (matching.length !== 1) throw Error('Outcome trace nonunique decision');
    const decision = matching[0];
    if (decision.scope.domain !== c.domain || decision.usedVersionId !== c.versionId || !equalsJson(decision.input, fixture.input) || decision.decidedAt !== fixture.decidedAt) throw Error('Outcome trace case binding differs');
    const resolutions = records.filter(r => r.kind === 'resolution' && r.decisionId === decision.id);
    const scores = records.filter(r => r.kind === 'score' && r.decisionId === decision.id);
    if (!c.available) { if (resolutions.length || scores.length || fixture.outcome !== null) throw Error('Outcome trace resolved a pending case'); continue; }
    if (resolutions.length !== 1 || scores.length !== 1) throw Error('Outcome trace has missing or duplicate truth');
    const resolution = get(resolutions[0].id, 'resolution'), score = get(scores[0].id, 'score');
    if (resolution.scopeId !== decision.scopeId || resolution.artifactKey !== decision.artifactKey || !equalsJson(resolution.payload, fixture.outcome)) throw Error('Outcome trace resolution binding differs');
    for (const source of resolution.sources) {
      const { digest, ...bytes } = source;
      if (await canonicalSha256(bytes) !== digest || source.decisionId !== decision.id || source.scopeId !== decision.scopeId || source.subject !== decision.scope.subject || source.observedAt !== fixture.observedAt || !equalsJson(source.payload, fixture.outcome)) throw Error('Outcome trace evidence bytes differ');
    }
    if (score.resolutionId !== resolution.id || score.scopeId !== decision.scopeId || score.scorerRevision !== decision.adapter.scorerRevision || score.outcome !== baselineScore(c.domain, decision.output, resolution.payload) || score.utility !== utilityOf(score.outcome) || c.outcome !== score.outcome || c.utility !== score.utility) throw Error('Outcome trace score is not supported by its evidence');
    const intents = records.filter(r => r.kind === 'projectionIntent' && r.scoreId === score.id), projections = records.filter(r => r.kind === 'projectionReceipt' && r.scoreId === score.id);
    if (intents.length !== 1 || projections.length !== (row.id === 'projection-disabled' ? 0 : 1)) throw Error('Outcome trace projection coverage differs');
    const intent = get(intents[0].id, 'projectionIntent');
    if (intent.scopeId !== score.scopeId || intent.artifactKey !== score.artifactKey || intent.policyId !== score.policyId || !equalsJson(intent.memoryIds, [...new Set(decision.memoryIds)].sort())) throw Error('Outcome trace intent joins differ');
    if (row.id === 'projection-disabled') continue;
    const p = get(projections[0].id, 'projectionReceipt');
    if (p.intentId !== intent.id || p.policyId !== score.policyId || intent.policyId !== score.policyId || !equalsJson(intent.memoryIds, [...new Set(decision.memoryIds)].sort()) || !equalsJson(p.items.map(i => i.memoryId), intent.memoryIds)) throw Error('Outcome trace projection joins differ');
    if (p.applied !== p.items.filter(i => i.status === 'applied').length || p.missing !== p.items.filter(i => i.status === 'missing').length || p.changedMemoryWrites !== p.items.filter(i => i.changed).length) throw Error('Outcome trace projection counts differ');
    applied += p.applied; missing += p.missing; changed += p.changedMemoryWrites;
    for (const item of p.items.filter(i => i.status === 'applied')) {
      const memory = trace.memories.find(m => m && typeof m === 'object' && !Array.isArray(m) && m.id === item.memoryId);
      if (!memory || await canonicalSha256(memory) !== item.after) throw Error('Outcome trace memory does not match its terminal projection');
    }
  }
  if (row.counts.projectionApplied !== applied || row.counts.projectionMissing !== missing || row.counts.projectionChanged !== changed) throw Error('Outcome trace projection totals differ');
  for (const receipt of records.filter(r => r.kind === 'operationReceipt')) {
    if (receipt.result.ok && typeof receipt.result.value === 'object' && receipt.result.value && !Array.isArray(receipt.result.value)) {
      for (const [name, id] of Object.entries(receipt.result.value)) if (name.endsWith('Id') && name !== 'caseReportId' && typeof id === 'string' && !ids.has(id)) throw Error('Outcome operation result references missing bytes');
    }
  }
  const receipts = records.filter(r => r.kind === 'operationReceipt');
  for (const receipt of receipts) {
    const reservations = records.filter(r => r.kind === 'attemptEvent' && r.stage === 'reserved' && r.requestId === receipt.requestId && r.inputDigest === receipt.inputDigest);
    if (!reservations.length) throw Error('Outcome trace is missing the durable reservation');
  }
  const resolverReads = records.filter(r => r.kind === 'resolution').reduce((n, r) => n + r.sources.length, 0)
    + records.filter(r => r.kind === 'evaluationRegistration').reduce((n, r) => n + r.cases.length, 0);
  if (trace.resolverReads !== resolverReads) throw Error('Outcome evidence-read count differs from retained snapshots');
  const writes = records.filter(r => r.kind === 'operationReceipt').reduce((n, r) => n + (r.result.ok ? r.result.writes : 7), 0);
  if (writes !== trace.writes) throw Error('Outcome trace write receipts do not reconcile');
  const grouped = new Map<string, number>();
  for (const v of records.filter(r => r.kind === 'artifactVersion')) { const key = v.scopeId + ':' + v.artifactKey; grouped.set(key, (grouped.get(key) ?? 0) + 1); if (grouped.get(key)! > v.policy.maxVersions) throw Error('Outcome trace exceeds retained version capacity'); }
  const expected = {
    proposed: records.filter(r => r.kind === 'reflection').length,
    evaluated: records.filter(r => r.kind === 'evaluation').length,
    eligible: records.filter(r => r.kind === 'evaluation' && r.eligible).length,
    approved: records.filter(r => r.kind === 'approval' && r.action === 'promote').length,
    maxVersions: Math.max(0, ...grouped.values()),
    reflectionBytes: records.filter(r => r.kind === 'reflection').reduce((n, r) => n + new TextEncoder().encode(r.text).length, 0),
    projectionReplayed: records.filter(r => r.kind === 'operationReceipt' && r.operation === 'project' && r.result.ok).length,
    projectionFailed: records.filter(r => r.kind === 'operationReceipt' && r.operation === 'project' && !r.result.ok).length,
  };
  for (const [key, value] of Object.entries(expected)) if (row.counts[key as keyof typeof expected] !== value) throw Error('Outcome activity counts differ from receipts');
  await validateActivationRecords(row, records);
}
