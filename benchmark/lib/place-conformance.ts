/** Registered denominators, exact scoring and source-bound keyless measurements. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { mulberry32 } from '@jarenjs/core/random';
import { analyticEnvelope } from './report-envelope.ts';
import { sourceManifest } from './source-manifest.ts';
import { loadPlaceFixture, PLACE_FIXTURE_PATH, PLACE_MEMBERS, placeHash, type LoadedPlaceFixture, type PlaceInput } from './place-fixture.ts';
import { placeOracle, placeGateFixtures } from './place-oracle.ts';
import { preparePlaceBaselines, meaningOnly, meaningTime, type PlaceBaselineContext } from './place-baselines.ts';
import { validatePlaceShape } from './place-validation.ts';
import type { Report, Source, Outcome, Measurement, Counts, Summary } from './place-report.types.ts';

export interface PlaceContext { loaded: LoadedPlaceFixture; source: Source; locomo: Report['locomo']; }
export type PlaceAdapter = (question: PlaceInput) => Promise<Outcome | { unavailable: string }>;
export type PlaceAdapters = Partial<Record<string, PlaceAdapter>>;
export async function placeContext(loaded?: LoadedPlaceFixture, root = process.cwd()): Promise<PlaceContext> {
  return { loaded: loaded ?? await loadPlaceFixture({ root }), source: await sourceManifest(root,
    ['package.json', 'package-lock.json', 'benchmark/place.ts', 'benchmark/schemas/place.schema.json',
      'benchmark/lib/place-validation.ts', 'benchmark/lib/place-fixture.ts', 'benchmark/lib/place-oracle.ts', 'benchmark/lib/place-projection.ts',
      'benchmark/lib/place-baselines.ts', 'benchmark/lib/place-conformance.ts', 'benchmark/lib/place-report.types.ts', 'benchmark/lib/place-render.ts',
      'benchmark/lib/locomo.ts', 'benchmark/lib/locomo-corpus.ts', 'benchmark/lib/validate.ts', 'benchmark/lib/source-manifest.ts', 'benchmark/lib/report-envelope.ts',
      `${PLACE_FIXTURE_PATH}/manifest.json`, ...PLACE_MEMBERS.map(p => `${PLACE_FIXTURE_PATH}/${p}`)],
    ['packages/core', 'packages/memory', 'packages/models', 'packages/jaren', 'packages/store']),
    locomo: { recallSha256: placeHash(await readFile(join(root, 'benchmark/results/locomo-recall.json'))),
      qaSha256: placeHash(await readFile(join(root, 'benchmark/results/locomo-qa.json'))) } };
}
export function scorePlace(expected: Outcome, actual: Outcome): boolean {
  try { return canonicalizeJson(expected) === canonicalizeJson(actual); }
  catch (cause) { if (cause instanceof TypeError) return false; throw cause; }
}
export function placeCounts(rows: readonly Measurement[]): Counts {
  return { planned: rows.length, measured: rows.filter(r => r.status === 'measured').length, passed: rows.filter(r => r.passed === true).length,
    incorrect: rows.filter(r => r.status === 'measured' && r.passed === false).length, failed: rows.filter(r => r.status === 'failed').length,
    implementationMissing: rows.filter(r => r.status === 'implementation-missing').length, unavailable: rows.filter(r => r.status === 'unavailable').length };
}
export function placeSummaries(rows: readonly Measurement[], loaded: LoadedPlaceFixture): Summary[] {
  return loaded.fixture.manifest.registration.rows.flatMap(({ row, backend }) => (['all', ...Object.keys(loaded.fixture.manifest.census.byKind)] as Summary['kind'][]).map(kind => {
    const counts = placeCounts(rows.filter(r => r.row === row && r.backend === backend && (kind === 'all' || r.kind === kind)));
    return { row, backend, kind, counts, exactness: counts.measured ? counts.passed / counts.planned : null };
  }));
}
export function placeRefusals(rows: readonly Measurement[]): Report['refusals'] {
  const byCode: Record<string, number> = {}, byCause: Record<string, number> = {};
  for (const { actual } of rows) if (actual && 'refused' in actual) {
    byCode[actual.refused] = (byCode[actual.refused] ?? 0) + 1;
    if (actual.cause) byCause[actual.cause] = (byCause[actual.cause] ?? 0) + 1;
  }
  // A successful counterexample question still exercised a refused authored query.
  for (const { actual } of rows) if (actual && 'gate' in actual && actual.gate.startsWith('AI023')) byCause[actual.gate] = (byCause[actual.gate] ?? 0) + 1;
  return { byCode, byCause, unmatchedJoins: byCode.TPLC1008 ?? 0 };
}
function randomFloor(rows: readonly Measurement[], loaded: LoadedPlaceFixture): Report['randomFloor'] {
  const random = rows.filter(r => r.row === 'seeded-random'), measured = random.filter(r => r.status === 'measured');
  const trials = measured.filter(r => r.kind === 'location-at-event').length, p = 1 / loaded.fixture.entries.length;
  const expectedPasses = trials * p, standardDeviation = Math.sqrt(trials * p * (1 - p));
  const lowerPasses = Math.max(0, expectedPasses - 4 * standardDeviation - 1), upperPasses = expectedPasses + 4 * standardDeviation + 1;
  const passed = measured.filter(r => r.passed).length;
  return { planned: random.length, passed, expectedPasses, standardDeviation, lowerPasses, upperPasses, holds: passed >= lowerPasses && passed <= upperPasses };
}
export async function runPlaceConformance(context: PlaceContext, adapters: PlaceAdapters = {}, prepared?: PlaceBaselineContext): Promise<Report> {
  const { loaded, source, locomo } = context, { fixture, corpus } = loaded;
  const before = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('network forbidden in the keyless place instrument'); };
  try {
    const baselines = prepared ?? await preparePlaceBaselines(loaded), random = mulberry32(fixture.manifest.registration.seed);
    const rows: Measurement[] = [];
    for (const { row, backend } of fixture.manifest.registration.rows) for (const question of fixture.questions) {
      const { expected, ...input } = question;
      const base = { row, backend, kind: question.kind, questionId: question.id, expected,
        projectionId: 'sampleId' in question ? baselines.projections.get(question.sampleId)?.bundle.projection.versionId ?? null : null };
      const adapter = adapters[`${row}/${backend}`] ?? (row === 'oracle' ? async (q: PlaceInput) => placeOracle(loaded, q) :
        row === 'seeded-random' ? async () => ({ entryId: fixture.entries[Math.floor(random() * fixture.entries.length)].id }) :
          row === 'meaning-only' ? (q: PlaceInput) => meaningOnly(baselines, q) : row === 'meaning-time' ? (q: PlaceInput) => meaningTime(baselines, q) : undefined);
      if (!adapter) { rows.push({ ...base, status: 'implementation-missing', actual: null, passed: null, detail: 'place runtime adapter is not implemented' }); continue; }
      if (corpus.status === 'unavailable' && 'sampleId' in question) { rows.push({ ...base, status: 'unavailable', actual: null, passed: null, detail: corpus.detail }); continue; }
      try {
        const actual = await adapter(structuredClone(input));
        if ('unavailable' in actual) rows.push({ ...base, status: 'unavailable', actual: null, passed: null, detail: actual.unavailable });
        else rows.push({ ...base, status: 'measured', actual, passed: scorePlace(expected, actual), detail: null });
      } catch (cause) { rows.push({ ...base, status: 'failed', actual: null, passed: false, detail: cause instanceof Error ? cause.message : String(cause) }); }
    }
    if (requests) throw new Error(`place network guard observed ${requests} forbidden requests`);
    const body: Omit<Report, 'sha256'> = { instrument: 'place-conformance-v1', fixtureHash: loaded.fixtureHash,
      census: structuredClone(fixture.manifest.census), coverage: structuredClone(fixture.manifest.coverage), floor: structuredClone(fixture.manifest.floor),
      registration: structuredClone(fixture.manifest.registration), scale: structuredClone(fixture.manifest.scale),
      corpus: { status: corpus.status, detail: corpus.detail, unresolvedMentions: corpus.unresolvedMentions },
      rows, counts: placeCounts(rows), summaries: placeSummaries(rows, loaded), refusals: placeRefusals(rows),
      wrongControls: fixture.wrongControls.map(c => ({ id: c.id, questionId: c.questionId, rejected: !scorePlace(fixture.questions.find(q => q.id === c.questionId)!.expected, c.actual) })),
      gateFixtures: placeGateFixtures(loaded), randomFloor: randomFloor(rows, loaded), locomo,
      identity: analyticEnvelope(fixture.manifest.registration.rows.map(r => `${r.row}/${r.backend}`)), source, liveRequests: 0, default: 'off' };
    const report = { ...body, sha256: await canonicalSha256(body) };
    if (!await validatePlaceReport(report, loaded)) throw new Error(`place report refused: ${JSON.stringify(validatePlaceShape(report).errors?.slice(-3) ?? report.rows.filter(r => r.row === 'oracle' && r.passed !== true).slice(0, 3))}`);
    return report;
  } finally { globalThis.fetch = before; }
}

export async function validatePlaceReport(value: unknown, loaded: LoadedPlaceFixture): Promise<boolean> {
  if (!validatePlaceShape(value).valid || (value as Report).instrument !== 'place-conformance-v1') return false;
  const r = value as Report, f = loaded.fixture, equal = (a: unknown, b: unknown) => canonicalizeJson(a) === canonicalizeJson(b);
  const { sha256, ...body } = r;
  if (sha256 !== await canonicalSha256(body) || r.fixtureHash !== loaded.fixtureHash || !equal(r.census, f.manifest.census) ||
    !equal(r.coverage, f.manifest.coverage) || !equal(r.floor, f.manifest.floor) || !equal(r.registration, f.manifest.registration) || !equal(r.scale, f.manifest.scale)) return false;
  if (!equal(r.corpus, { status: loaded.corpus.status, detail: loaded.corpus.detail, unresolvedMentions: loaded.corpus.unresolvedMentions })) return false;
  const keys = f.manifest.registration.rows.flatMap(row => f.questions.map(q => `${row.row}/${row.backend}/${q.id}`)).sort();
  if (!equal(keys, r.rows.map(row => `${row.row}/${row.backend}/${row.questionId}`).sort())) return false;
  const projections = new Map<string, string>();
  for (const row of r.rows) {
    const question = f.questions.find(q => q.id === row.questionId);
    if (!question || question.kind !== row.kind || !equal(row.expected, question.expected)) return false;
    if ('sampleId' in question && loaded.corpus.status === 'available') {
      if (row.projectionId === null || projections.has(question.sampleId) && projections.get(question.sampleId) !== row.projectionId) return false;
      projections.set(question.sampleId, row.projectionId);
    } else if (row.projectionId !== null) return false;
    if (row.status === 'measured' ? row.actual === null || row.passed !== scorePlace(question.expected, row.actual) || row.detail !== null
      : row.actual !== null || row.passed !== (row.status === 'failed' ? false : null) || !row.detail) return false;
    if (loaded.corpus.status === 'unavailable' && 'sampleId' in question && row.status !== 'unavailable' && row.status !== 'implementation-missing') return false;
    const { expected: _expected, ...input } = question;
    if (row.row === 'oracle') {
      const needsMissingCorpus = loaded.corpus.status === 'unavailable' && 'sampleId' in question;
      if (needsMissingCorpus ? row.status !== 'unavailable'
        : row.status !== 'measured' || !equal(row.actual, placeOracle(loaded, input)) || row.passed !== true) return false;
    }
  }
  const wrong = f.wrongControls.map(c => ({ id: c.id, questionId: c.questionId, rejected: !scorePlace(f.questions.find(q => q.id === c.questionId)!.expected, c.actual) }));
  const gates = placeGateFixtures(loaded), floor = randomFloor(r.rows, loaded);
  return equal(r.counts, placeCounts(r.rows)) && equal(r.summaries, placeSummaries(r.rows, loaded)) && equal(r.refusals, placeRefusals(r.rows)) &&
    equal(r.wrongControls, wrong) && wrong.every(c => c.rejected) && equal(r.gateFixtures, gates) && gates.every(g => g.passed) && equal(r.randomFloor, floor) && floor.holds &&
    equal(r.identity, analyticEnvelope(f.manifest.registration.rows.map(row => `${row.row}/${row.backend}`))) &&
    r.source.sha256 === await canonicalSha256({ head: r.source.head, files: r.source.files }) &&
    new Set(r.source.files.map(file => file.path)).size === r.source.files.length && r.source.files.every(file => !file.path.startsWith('/') && !file.path.split('/').includes('..'));
}

export { renderPlaceReport } from './place-render.ts';
