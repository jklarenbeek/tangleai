import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { runConsolidate, suppliedEvidence, compactionControls, validateConsolidate, renderConsolidate,
  emptyFailures, CONSOLIDATE_REGISTRATION, type Candidate, type EvidenceSource } from '../../benchmark/lib/consolidate.ts';
import { consolidateSourceHash } from '../../benchmark/lib/consolidate-source.ts';
import { loadLocomo } from '../../benchmark/lib/locomo.ts';

const sources: EvidenceSource[] = ['The train departs at noon.', 'Sam meets Alex in Paris.'].map((text, sequence) => ({
  key: `c/D1:${sequence + 1}`, sequence,
  unit: { id: `D1:${sequence + 1}`, text, evidence: `c/D1:${sequence + 1}`, tags: ['Sam'], kind: 'event', at: '2023-05-08T13:56:00Z' },
}));
const sample = {
  sample_id: 'c', conversation: { speaker_a: 'Sam', speaker_b: 'Alex', session_1_date_time: '1:56 pm on 8 May, 2023',
    session_1: sources.map(source => ({ speaker: 'Sam', dia_id: source.unit.id, text: source.unit.text })) },
  qa: [{ question: 'Where does Sam meet Alex?', answer: 'Paris', category: 4 as const, evidence: ['D1:2'] },
    { question: 'A missing reference?', answer: 'unavailable', category: 1 as const, evidence: ['D9:9'] },
    { question: 'No evidence?', answer: 'unknown', category: 2 as const, evidence: [] },
    { question: 'Adversarial?', category: 5 as const }],
};
const dataset = { samples: [sample], sha256: 'a'.repeat(64) };

it('credits only complete delivered source text, rejects foreign references and respects final formatting cost', () => {
  const full = suppliedEvidence(sources, ['artifact-with-many-citations', 'foreign/D1:2', 'c/D1:2', 'c/D1:2', 'c/D1:1']);
  assert.deepEqual(full.supplied.map(source => source.key), ['c/D1:2', 'c/D1:1']);
  assert.equal(full.missing, 2);
  assert.equal(full.duplicates, 1);
  const exact = suppliedEvidence(sources, ['c/D1:2']);
  assert.equal(suppliedEvidence(sources, ['c/D1:2'], { ...CONSOLIDATE_REGISTRATION.retrieval, contextChars: exact.chars }).supplied.length, 1);
  assert.equal(suppliedEvidence(sources, ['c/D1:2'], { ...CONSOLIDATE_REGISTRATION.retrieval, contextChars: exact.chars - 1 }).trimmed, 1);
  assert.equal(suppliedEvidence(sources, ['c/D1:2'], { ...CONSOLIDATE_REGISTRATION.retrieval, contextChars: 1 }).supplied.length, 0);
  assert.throws(() => suppliedEvidence([sources[0], sources[0]], []), /duplicate/);
});

it('produces byte-identical hand-fixture reports with honest unresolved, excluded and unmeasured rows', async () => {
  const first = await runConsolidate(dataset, { sourceHash: 'b'.repeat(64), compaction: false, storage: false });
  const second = await runConsolidate(dataset, { sourceHash: 'b'.repeat(64), compaction: false, storage: false });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(first.questionRows.map(row => row.recall), [1, 0, 1]);
  assert.equal(first.dataset.unresolvedGold, 1);
  assert.equal(first.dataset.emptyGold, 1);
  assert.equal(first.dataset.excluded, 1);
  assert.equal(first.physicalRequests, 0);
  assert.equal(first.liveTokens, null);
  assert.equal(first.default.enabled, false);
  assert.deepEqual(first.unmeasured, ['deterministic', 'semantic', 'combined']);
  assert.ok(validateConsolidate(first));
  assert.equal(validateConsolidate({ ...first, physicalRequests: 1 }), false);
  const changed = structuredClone(first); changed.questionRows[0].recall = 0;
  assert.equal(validateConsolidate(changed), false, 'summaries must be derived from actual question rows');
  assert.throws(() => renderConsolidate(changed), /inconsistent/);
  assert.equal(first.registrationHash, await canonicalSha256(CONSOLIDATE_REGISTRATION));
});

it('does not let candidate preparation mutate the source text being credited or hide invalid counters', async () => {
  const candidate: Candidate = { key: 'scripted-refusal', origin: 'scripted', async prepare(input) {
    input[0].unit.text = 'forged Paris answer';
    return { rank: async () => [input[0].key], statistics: { artifacts: 0, retainedSources: input.length,
      outputChars: 0, logicalCalls: 1, embeddingItems: 0, failures: { ...emptyFailures(), refusal: 1 } } };
  } };
  const report = await runConsolidate(dataset, { sourceHash: 'b'.repeat(64), compaction: false, storage: false, candidates: [candidate] });
  assert.equal(report.questionRows[0].verbatimF1, 0);
  assert.equal(report.candidates[0].statistics.failures.refusal, 1);
  const broken: Candidate = { ...candidate, async prepare(input) {
    const prepared = await candidate.prepare(input); prepared.statistics.logicalCalls = -1; return prepared;
  } };
  await assert.rejects(runConsolidate(dataset, { sourceHash: 'b'.repeat(64), compaction: false, storage: false, candidates: [broken] }), /accounting/);
});

it('measures compressed late pairwise losses beside surviving front, archive and program controls', async () => {
  const report = await compactionControls();
  const late = report.rows.filter(row => row.shape === 'late' && row.compacted);
  assert.ok(late.length > 0 && late.every(row => row.pairwise === 0));
  assert.ok(report.rows.filter(row => row.variant === 'ledger').every(row => row.recoverable === 40));
  assert.ok(report.rows.some(row => row.shape === 'front' && row.compacted && row.pairwise === 1));
  assert.equal(report.program.pairwise, 1);
  assert.equal(report.program.correct, true);
});

it('publishes exactly the full current corpus report', async t => {
  const corpus = await loadLocomo();
  if (!corpus.available) { t.skip(corpus.reason); return; }
  assert.ok(corpus.valid);
  const doc = await readFile(new URL('../../docs/CONSOLIDATE_BENCHMARK.md', import.meta.url), 'utf8');
  const sourceHash = /Effective source: `([a-f0-9]{64})`/.exec(doc)![1];
  assert.equal(sourceHash, await consolidateSourceHash(), 'regenerate the source-bound consolidation report');
  const report = await runConsolidate(corpus, { sourceHash });
  assert.equal(report.questionRows.length, 1540);
  assert.equal(report.dataset.sources, 5882);
  assert.equal(renderConsolidate(report), doc);
});
