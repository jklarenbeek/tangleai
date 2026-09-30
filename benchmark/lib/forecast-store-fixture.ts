import { loadForecastFixtures } from './forecast-fixtures.ts';
import { sealForecastRecord, forecastRevision, forecastBytes, type ForecastTables, type ForecastCommandResult } from '@tangleai/forecast';

export const at = '2025-01-10T00:00:00.000Z', end = '2025-01-10T00:00:01.000Z';
export const revision = 'a'.repeat(64), hash = 'b'.repeat(64);
export const identity = { configuration: { kind: 'scripted' as const, revision }, promptRevision: revision, toolsetRevision: revision, noteSchemaRevision: revision };
export function must<T>(result: ForecastCommandResult<T>): T {
  if (!result.ok) throw Error(JSON.stringify(result.issues));
  return result.value;
}
export async function makeForecastFixture(suffix = ''): Promise<ForecastTables> {
  const f = await loadForecastFixtures(), q = f.questions[0];
  const questions = await sealForecastRecord('questions', {
    scopeKey: q.scopeKey, prompt: q.prompt + suffix, issuedAt: q.issuedAt, expectedResolutionAt: q.expectedResolutionAt,
    status: 'open', adapter: { ...q.adapter, version: '1' }, checkpointPolicy: { ordinals: q.checkpoints.map(c => c.ordinal), scheduledAt: q.checkpoints.map(c => c.scheduledAt) },
    startedFromCheckedVersionId: null, latestProvisionalVersionId: null, promptRevision: revision, toolsetRevision: revision,
  });
  const schedules = await sealForecastRecord('schedules', { questionId: questions.id, ordinal: 1, scheduledAt: at, cutoffAt: at, status: 'due' });
  const harnesses = await sealForecastRecord('harnesses', { scopeKey: q.scopeKey, questionId: null, parentVersionId: null, document: f.seed, digest: await forecastRevision(f.seed),
    status: 'staged', checkedVersionId: null, provenance: { seed: true, revisionId: null, retrospectiveId: null }, recordedAt: q.issuedAt });
  const checkpoints = await sealForecastRecord('checkpoints', { questionId: questions.id, ordinal: 1, scheduledAt: at, cutoffAt: at, startedAt: null, endedAt: null,
    inputHarnessVersionId: harnesses.id, inputHarnessDigest: harnesses.digest, traceId: null, noteId: null, predictionId: null, evidenceIds: [],
    spend: { calls: 0, tokens: 0, ms: 0, usageKnown: true }, stopReason: null, status: 'planned', failure: null, ...identity, decisionId: null });
  const snapshot = f.snapshots.find(s => s.id === q.checkpoints[0].snapshotIds[0])!;
  const evidence = await sealForecastRecord('evidence', { checkpointId: checkpoints.id, kind: 'snapshot', address: { corpus: 'tidewater', snapshotId: snapshot.id },
    availableAt: snapshot.availableAt, fetchedAt: null, claimedPublishedAt: null, sha256: snapshot.sha256, bytes: new TextEncoder().encode(snapshot.excerpt).length,
    excerpt: snapshot.excerpt, citationId: snapshot.id, admitted: true, refusal: null });
  const predictions = await sealForecastRecord('predictions', { checkpointId: checkpoints.id, raw: '\\boxed{approve}', normalized: 'approve', adapterId: q.adapter.id, adapterVersion: '1', uncertainty: null });
  const trace = { messages: [{ role: 'assistant', content: predictions.raw }], steps: [] };
  const traces = await sealForecastRecord('traces', { checkpointId: checkpoints.id, ...trace, bytes: forecastBytes(trace), truncated: { steps: 0, chars: 0 } });
  const notes = await sealForecastRecord('notes', { checkpointId: checkpoints.id, ...identity, sections: f.notes['q01-c1'] as ForecastTables['notes']['sections'], evidenceIds: [evidence.id], traceId: traces.id });
  const revisions = await sealForecastRecord('revisions', { questionId: questions.id, checkpointId: checkpoints.id, comparedNoteIds: [notes.id], provisionalDiagnoses: [],
    committedGuidance: [{ text: 'Keep independent evidence and uncertainty separate.', sources: ['note:' + notes.id] }], deferredFeedback: [], patch: [], candidateVersionId: null,
    gate: { volatileFact: { refused: 0, items: [] }, semantic: { stage: 'skipped', revision, result: null } }, validation: { ok: true, issues: [] }, traceReads: 0, ...identity });
  const resolutions = await sealForecastRecord('resolutions', { questionId: questions.id, observedAt: f.resolutions[0].observedAt, receivedAt: f.resolutions[0].observedAt,
    outcome: f.resolutions[0].outcome, evidence: [{ address: evidence.address, sha256: evidence.sha256, excerpt: evidence.excerpt }], scorerId: 'forecast-utility', scorerVersion: '1', losses: [], skipped: [] });
  const retrospectives = await sealForecastRecord('retrospectives', { questionId: questions.id, resolutionId: resolutions.id, revisionIds: [revisions.id], noteIds: [notes.id],
    verdicts: [], candidateVersionId: null, reflect: null, evaluation: null, promotion: null, outcome: 'retained', ...identity });
  return { questions, schedules, harnesses, checkpoints, evidence, predictions, traces, notes, revisions, resolutions, retrospectives };
}
