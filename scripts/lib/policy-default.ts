/** Derive runtime policy data only from a completed, eligible registered experiment. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { verifyPolicyReport, verifyPolicyDataset } from '../../benchmark/lib/policy-execution.ts';
import { createReportValidator, describeErrors } from '../../benchmark/lib/validate.ts';
import type { CellSpec, LocomoPolicy } from '../../benchmark/lib/locomo-policy.ts';
import type { LiveReport } from '../../benchmark/lib/locomo-qa.ts';
import SCHEMA from '../../benchmark/schemas/locomo-policy.schema.json' with { type: 'json' };
import RUN_IDENTITY_SCHEMA from '../../packages/config/schemas/run-identity.schema.json' with { type: 'json' };

export function valuesOf(cell: CellSpec, width = cell.embedding.dims) {
  return {
    novelty: { enabled: cell.ingest.novelty < 2, threshold: cell.ingest.novelty },
    contradiction: { enabled: cell.ingest.contradiction < 2, threshold: cell.ingest.contradiction, maxPairs: cell.ingest.maxPairs },
    crystallization: { enabled: cell.ingest.crystallize < 2, threshold: cell.ingest.crystallize },
    retrieval: { ...cell.retrieval },
    embedding: { model: `hash-trigram-${width}`, dims: width, tier: 'keyless' as const },
  };
}
export async function policyArtifactOf(report: LocomoPolicy) {
  const result = createReportValidator(SCHEMA, [RUN_IDENTITY_SCHEMA])(report);
  assert.ok(result.valid, describeErrors(result).join('\n'));
  await verifyPolicyReport(report);
  assert.ok(report.gate.passed && report.selection.state === 'confirmed', 'A completed confirmation is required');
  const { transition, decision } = report.selection;
  assert.ok(transition && decision && report.widthDecision && report.census, 'Policy decision evidence is missing');
  const inert = report.registration.cells.find(c => c.role === 'inert')!;
  const shipped = report.registration.cells.find(c => c.role === 'shipped')!;
  const expected = [inert.cellId, shipped.cellId, transition.challenger];
  for (const phase of ['selection', 'confirmation'] as const) {
    const required = phase === 'selection' ? report.selection.shortlist : expected;
    const actual = report.attempts.filter(a => a.run.tier === 'live' && a.phase === phase);
    assert.deepEqual(actual.map(a => a.cellId).sort(), [...required].sort(), `${phase} cells differ from the registration`);
    for (const attempt of actual) {
      assert.ok(attempt.eligibility.eligible, `Ineligible ${phase} cell cannot generate a default`);
      assert.equal(attempt.denominators.planned, report.registration.splits[phase].scorable, 'Registered denominator changed');
      assert.equal(attempt.denominators.answered, attempt.denominators.planned, 'Incomplete confirmation');
    }
  }
  const confirmation = report.comparisons.find(c => c.phase === 'confirmation' && c.metric === 'locomo-f1' && c.treatment === transition.challenger)!;
  assert.ok(confirmation?.eligible, 'Eligible held-out paired evidence is required');
  const selectedId = decision.qualifiesAsDefault ? transition.challenger : inert.cellId;
  assert.equal(decision.default, selectedId, 'Default differs from the registered decision');
  const cell = report.registration.cells.find(c => c.cellId === selectedId)!;
  const width = report.widthDecision.proposedDims;
  assert.ok(report.widthDecision.rows.some(r => r.dims === width), 'Offline width lacks lexical evidence');
  return {
    policy: valuesOf(cell, width),
    provenance: {
      reportId: report.reportId, registrationId: report.registration.registrationId, cellId: selectedId,
      sourceId: report.source.sha256, transitionId: transition.identity, challengerId: transition.challenger,
      ingestTier: 'live' as const, retrievalTier: 'live' as const, embeddingTier: 'keyless' as const,
      qualifiesAsDefault: decision.qualifiesAsDefault, statement: decision.statement,
      power: confirmation.power, interval: confirmation.interval, clauses: confirmation.verdict.clauses,
    },
    alternatives: Object.fromEntries(report.registration.cells.filter(c => report.attempts.some(a => a.cellId === c.cellId))
      .map(c => [c.cellId, { label: c.key, ...valuesOf(c) }])),
    shippedLegacyCellId: shipped.cellId,
  };
}

/** Raw replies remain independently hashed, including failed attempts and adversarial judgments. */
export async function readPolicyDecision(path: string) {
  const report = JSON.parse(await readFile(path, 'utf8')) as LocomoPolicy;
  assert.ok(report.liveEvidence?.length && report.purchases, 'Live evidence and purchase receipt are required');
  const rows: Array<{ phase: string, row: LiveReport['configurations'][number] }> = [];
  for (const reference of report.liveEvidence) {
    const bytes = await readFile(reference.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), reference.sha256, 'Raw live evidence changed');
    const raw = JSON.parse(bytes.toString()) as LiveReport;
    verifyPolicyDataset(report, raw.dataset);
    rows.push(...raw.configurations.map(row => ({ phase: reference.phase, row })));
  }
  const journal = await readFile(report.purchases.path);
  assert.equal(createHash('sha256').update(journal).digest('hex'), report.purchases.sha256, 'Purchase receipt changed');
  const purchases = JSON.parse(journal.toString()) as { requests: unknown[], ceiling: number };
  assert.equal(purchases.requests.length, report.purchases.physical, 'Physical request count differs');
  assert.ok(purchases.requests.length <= purchases.ceiling, 'Campaign ceiling exceeded');
  for (const attempt of report.attempts.filter(a => a.run.tier === 'live')) {
    const key = report.registration.cells.find(c => c.cellId === attempt.cellId)!.key;
    const row = [...rows].reverse().find(r => r.phase === attempt.phase && r.row.key === key)?.row;
    assert.ok(row, 'Attempt has no raw live evidence');
    assert.deepEqual(attempt.operations, row.ingest, 'Policy operation census changed');
    assert.deepEqual(attempt.results.map(r => [r.id, r.f1, r.promptSha256, r.tokens, r.calls]),
      row.questions.results.filter(r => !r.invalid).map(r => [r.id, r.f1, r.promptSha256, r.tokens, r.calls ?? 1]), 'Scored answers differ from raw evidence');
    assert.equal(row.adversarial.judged, row.adversarial.planned, 'Missing required judgments');
    assert.equal(row.adversarial.judgeFailed, 0, 'Invalid required judgments');
  }
  return { report, artifact: await policyArtifactOf(report) };
}
