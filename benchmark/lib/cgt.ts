/** Registered CGT measurements and credential-free live planning. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { deepFreeze, equalsJson } from '@jarenjs/core/object';
import { runIdentitySchema } from '@tangleai/config';
import schema from '../schemas/cgt.schema.json' with { type: 'json' };
import { generateCgtFixture, validateCgtFixture, renderCgtRule } from './cgt-fixture.ts';
import { CGT_LIVE_ROWS, CGT_ROW_IDS, measureCgtRows } from './cgt-rows.ts';
import { cgtChanceBand, scoreAnswer } from './cgt-scorer.ts';
import { readAiEnv, envConfigIdentity } from './ai-env.ts';
import { analyticEnvelope } from './report-envelope.ts';
import { sourceManifest } from './source-manifest.ts';
import { createReportValidator } from './validate.ts';
import { table, score } from './table.ts';
import type { CgtFixture, CgtManifest, CgtReport, CgtSource } from './cgt.types.ts';

export const REPORT_PATH = 'benchmark/results/cgt.json';
export const DOCUMENT_PATH = 'docs/CGT_BENCHMARK.md';
export const MANIFEST_PATH = 'benchmark/fixtures/cgt/manifest.json';
export const SOURCE_FILES = ['package.json', 'package-lock.json', MANIFEST_PATH, 'benchmark/cgt.ts',
  'benchmark/lib/cgt.ts', 'benchmark/lib/cgt-fixture.ts', 'benchmark/lib/cgt-rows.ts', 'benchmark/lib/cgt-scorer.ts',
  'benchmark/lib/cgt.types.ts', 'benchmark/schemas/cgt.schema.json', 'scripts/cgt-schema.ts',
  'benchmark/lib/source-manifest.ts', 'benchmark/lib/report-envelope.ts', 'benchmark/lib/validate.ts',
  'benchmark/lib/args.ts', 'benchmark/lib/table.ts', 'benchmark/lib/locomo-parity.ts', 'benchmark/lib/porter.ts',
  'benchmark/lib/ai-env.ts', 'apps/desktop/src/ai-host.ts'];
export const SOURCE_ROOTS = ['packages/core', 'packages/config', 'packages/context', 'packages/models', 'packages/memory'];
export const validateCgtReportShape = createReportValidator(schema, [runIdentitySchema]);

export async function loadCgtFixture(root: string, options: { seed?: number; sessions?: number } = {}): Promise<CgtFixture> {
  const manifest = JSON.parse(await readFile(join(root, MANIFEST_PATH), 'utf8')) as CgtManifest;
  if (options.seed !== undefined) manifest.seed = options.seed;
  if (options.sessions !== undefined) manifest.sessions = options.sessions;
  return generateCgtFixture(manifest);
}
function capabilitiesOf(rows: CgtReport['rows'], band: CgtReport['registration']['chanceBand']): CgtReport['capabilities'] {
  const row = (id: string) => rows.find(value => value.rowId === id)!;
  const inBand = (n: number | null) => n !== null && n >= band.low && n <= band.high;
  const oracle = ['cgc', 'seenPair', 'paraphrase', 'retention'].every(key => row('oracle')[key as 'cgc'] === 1)
    && row('oracle').bySession.every(session => session.cgc === 1);
  return { oracle, scripted: oracle && inBand(row('seeded-random').cgc) && inBand(row('scripted-memorizer').cgc)
    && row('scripted-memorizer').seenPair === 1 && row('scripted-retrieval').seenPair === 1 && row('scripted-rule-follower').cgc === 1
    && row('scripted-rule-follower').bySession.every(session => session.cgc === 1),
  live: rows.some(value => value.tier === 'live' && value.status === 'run') };
}
async function measuredSource(root: string, supplied?: CgtSource): Promise<CgtSource> {
  const current = await sourceManifest(root, SOURCE_FILES, SOURCE_ROOTS);
  let previous = supplied;
  if (!previous) {
    try { previous = (JSON.parse(await readFile(join(root, REPORT_PATH), 'utf8')) as CgtReport).source; }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  }
  if (previous && equalsJson(previous.files, current.files)) {
    if (previous.sha256 !== await canonicalSha256({ head: previous.head, files: previous.files })) throw Error('cgt source: invalid receipt');
    return previous;
  }
  if (supplied) throw Error('cgt source: effective bytes differ from supplied receipt');
  return current;
}

export async function validateCgtReport(value: unknown): Promise<CgtReport> {
  const validation = validateCgtReportShape(value);
  if (!validation.valid) throw Error('cgt report schema: ' + JSON.stringify(validation.errors));
  const report = value as CgtReport, { reportId, ...body } = report;
  if (await canonicalSha256(body) !== reportId) throw Error('cgt report: identity mismatch');
  if (report.source.sha256 !== await canonicalSha256({ head: report.source.head, files: report.source.files })
    || new Set(report.source.files.map(file => file.path)).size !== report.source.files.length)
    throw Error('cgt report: invalid source receipt');
  const fixture = await generateCgtFixture(report.registration.manifest), guards = await validateCgtFixture(fixture);
  const experiences = fixture.sessions.flatMap(session => session.experiences);
  if (report.registration.manifestDigest !== await canonicalSha256(fixture.manifest)
    || report.registration.fixtureId !== fixture.fixtureId || report.registration.ruleDigest !== await canonicalSha256(renderCgtRule(fixture.rule))
    || !equalsJson(report.guards, guards)) throw Error('cgt report: fixture registration mismatch');
  const prefixes = fixture.sessions.map(session => fixture.sessions.filter(value => value.ordinal <= session.ordinal).reduce((n, value) => n + value.experiences.length, 0));
  const expectedPartitions = { exactPair: fixture.questions.filter(value => value.partition === 'exact-pair').length,
    paraphrase: fixture.questions.filter(value => value.partition === 'paraphrase').length,
    novel: fixture.questions.filter(value => value.partition === 'novel').length,
    retention: fixture.questions.filter(value => value.partition === 'retention').length };
  if (report.registration.concepts !== fixture.rule.concepts.length || report.registration.pairs !== fixture.manifest.concepts * (fixture.manifest.concepts - 1) / 2
    || report.registration.covered !== fixture.coveredPairs.length || report.registration.sessions !== fixture.sessions.length
    || report.registration.experienceBudget !== experiences.length || !equalsJson(report.registration.partitions, expectedPartitions)
    || !equalsJson(report.registration.experiencePrefixes, prefixes) || report.registration.poisonTraces !== fixture.poison.length
    || report.registration.crossScopeTraces !== fixture.crossScope.length) throw Error('cgt report: census mismatch');
  const band = cgtChanceBand(expectedPartitions.novel, fixture.manifest.answerVocabulary);
  if (!equalsJson(report.registration.chanceBand, band) || !equalsJson(report.capabilities, capabilitiesOf(report.rows, band))) throw Error('cgt report: unsupported capability or chance band');
  for (const row of report.rows) {
    if (row.seeds.fixture !== fixture.manifest.seed || row.seeds.random !== fixture.manifest.seed + 1) throw Error('cgt report: seed mismatch');
    if (row.status === 'not-run') continue;
    const checkObservations = (observed: typeof row.observations, expected: CgtFixture['questions'], available: typeof experiences) => {
      if (!equalsJson(observed.map(value => value.queryId), expected.map(value => value.id))) throw Error('cgt report: query census mismatch');
      const allowed = new Set(available.map(value => value.id));
      for (const [i, result] of observed.entries()) {
        if (result.truth !== expected[i].truth || result.partition !== expected[i].partition
          || result.score !== (result.failure === null ? scoreAnswer(result.prediction, result.truth) : 0)
          || result.retrievedIds.some(id => !allowed.has(id)) || result.retrievedIds.length > row.retrievalK)
          throw Error('cgt report: unreconciled observation');
      }
    };
    checkObservations(row.observations, fixture.questions, experiences);
    for (const [i, session] of row.bySession.entries()) {
      if (session.session !== i + 1 || session.experienceBudget !== prefixes[i]) throw Error('cgt report: session prefix mismatch');
      checkObservations(session.observations, fixture.questions.filter(value => value.partition === 'novel'),
        fixture.sessions.slice(0, i + 1).flatMap(value => value.experiences));
    }
    for (const key of ['unanswered', 'malformed', 'rateLimited', 'refused'] as const)
      if (row.failures[key] !== row.observations.filter(value => value.failure === key).length) throw Error('cgt report: failure census mismatch');
    if (row.tier !== 'live' && (row.cost !== null || row.training !== null)) throw Error('cgt report: analytic rows have no observed provider or training cost');
    if (row.rowId === 'scripted-retrieval') {
      const all = [...row.observations, ...row.bySession.flatMap(session => session.observations)];
      if (!row.retrieval || row.retrieval.queries !== all.length || row.retrieval.returned !== all.reduce((n, result) => n + result.retrievedIds.length, 0))
        throw Error('cgt report: retrieval count mismatch');
    } else if (row.retrieval !== null || row.observations.some(result => result.retrievedIds.length)) throw Error('cgt report: undeclared retrieval');
  }
  for (const alpha of report.alpha) {
    if (alpha.K !== fixture.manifest.retrievalK || (alpha.status === 'not-run' && (alpha.accuracy !== null || alpha.nonDiscriminating))
      || (alpha.status === 'run' && (alpha.accuracy === null || alpha.nonDiscriminating !== (alpha.accuracy >= fixture.manifest.discriminationCeiling))))
      throw Error('cgt report: invalid discrimination evidence');
  }
  return report;
}

export async function buildCgtReport(options: { root?: string; seed?: number; sessions?: number; source?: CgtSource;
  fixture?: CgtFixture; rows?: Parameters<typeof measureCgtRows>[1] } = {}): Promise<CgtReport> {
  const root = options.root ?? process.cwd();
  const fixture = options.fixture ? structuredClone(options.fixture) : await loadCgtFixture(root, options);
  const guards = await validateCgtFixture(fixture);
  const rows = await measureCgtRows(fixture, options.rows), measured = rows[0];
  const [tangle, jaren] = await Promise.all(['package.json', 'node_modules/@jarenjs/core/package.json'].map(async path => JSON.parse(await readFile(join(root, path), 'utf8')) as { version: string }));
  const body: Omit<CgtReport, 'reportId'> = {
    benchmark: 'cgt', schemaVersion: 1, source: await measuredSource(root, options.source),
    registration: { manifest: fixture.manifest, manifestDigest: await canonicalSha256(fixture.manifest), fixtureId: fixture.fixtureId,
      ruleDigest: await canonicalSha256(renderCgtRule(fixture.rule)), concepts: fixture.rule.concepts.length,
      pairs: fixture.manifest.concepts * (fixture.manifest.concepts - 1) / 2, covered: fixture.coveredPairs.length,
      sessions: fixture.sessions.length, experienceBudget: measured.experienceBudget,
      experiencePrefixes: measured.bySession.map(session => session.experienceBudget), partitions: measured.sampleCount,
      poisonTraces: fixture.poison.length, crossScopeTraces: fixture.crossScope.length,
      chanceBand: cgtChanceBand(measured.sampleCount.novel, fixture.manifest.answerVocabulary) },
    runtime: { node: process.versions.node, bun: process.versions.bun ?? null, tangle: tangle.version, jaren: jaren.version },
    rows, alpha: ['frozen-none', 'frozen-retrieval', 'frozen-distilled-rule'].map(rowId => ({
      rowId: rowId as CgtReport['alpha'][number]['rowId'], status: 'not-run', K: fixture.manifest.retrievalK,
      accuracy: null, nonDiscriminating: false, reason: 'Frozen model not measured; discrimination is unestablished.' })),
    nonDiscriminatingFixtures: 0, guards, envelope: analyticEnvelope(CGT_ROW_IDS),
    capabilities: capabilitiesOf(rows, cgtChanceBand(measured.sampleCount.novel, fixture.manifest.answerVocabulary)),
    limitations: [
      'Primary CGC is accuracy conditional on novel unordered pairs, not the paper’s uniform-all-pairs CGC.',
      'Sessions demonstrate single concepts and covered compositions; this is not isolation-only exposure.',
      'The authored oracle and supplied rule reach the ceiling; neither establishes learned parameter quality.',
      'All answers are one of exactly 32 registered tokens; random answers remain fixed across session prefixes.',
      'Hash-trigram retrieval embeds the canonical pair/input key, uses native cosine ranking and stable experience-id ties, then performs exact lookup among at most K records.',
      'No provider or trainer ran. Every identity status is not-run; cost, training, live quality and alpha(K) remain unmeasured.',
      'Live planning has no executor. Matching authorization cannot train, infer, activate, or establish a learning claim.',
    ],
  };
  return validateCgtReport({ ...body, reportId: await canonicalSha256(body) });
}
export async function verifyCgtReport(value: unknown, root = process.cwd()): Promise<CgtReport> {
  const report = await validateCgtReport(value);
  const fresh = await buildCgtReport({ root, source: report.source, seed: report.registration.manifest.seed, sessions: report.registration.sessions });
  if (!equalsJson(report, fresh)) throw Error('cgt report: independent row execution differs');
  return report;
}
export function requireCapability(report: CgtReport, name: string): void {
  if (!Object.hasOwn(report.capabilities, name)) throw Error('unknown cgt capability: ' + name);
  if (!report.capabilities[name as keyof CgtReport['capabilities']]) throw Error('cgt capability not measured: ' + name);
}
export const renderReport = (report: CgtReport): string => JSON.stringify(report, null, 2) + '\n';
export function renderDocument(report: CgtReport): string {
  const r = report.registration, band = r.chanceBand;
  return '# Compositional generalization test\n\nGenerated by `npm run benchmark:cgt`.\n\n'
    + `Registration: \`${r.manifestDigest}\`. Fixture: \`${r.fixtureId}\`. Report: \`${report.reportId}\`.\n\n`
    + `Tangle ${report.runtime.tangle}; Jaren ${report.runtime.jaren}. ${r.concepts} concepts, ${r.pairs} unordered pairs, ${r.covered} covered pairs, ${r.sessions} sessions, ${r.experienceBudget} experience records, retrieval K=${r.manifest.retrievalK}.\n\n`
    + table({ head: ['Row', 'Tier', 'Status', 'Novel CGC', 'Seen pair', 'Paraphrase', 'Retention', 'Failures'],
      rows: report.rows.map(row => [row.rowId, row.tier, row.status, score(row.cgc), score(row.seenPair), score(row.paraphrase), score(row.retention),
        row.status === 'run' ? Object.values(row.failures).reduce((n, v) => n + v, 0) : null]), numeric: [3, 4, 5, 6, 7] })
    + `\n\nChance p=1/${r.manifest.answerVocabulary}=${band.p}; ${band.n} novel questions; four-standard-error binomial normal band [${band.low.toFixed(6)}, ${band.high.toFixed(6)}]. It is a control band, not a model-quality confidence interval.\n\n`
    + `Exact pair ${r.partitions.exactPair}; paraphrase ${r.partitions.paraphrase}; novel ${r.partitions.novel}; retention ${r.partitions.retention}. Missing, malformed, rate-limited and refused answers remain in these denominators.\n\n`
    + table({ head: ['Row', ...r.experiencePrefixes.map((n, i) => `Session ${i + 1} (D=${n})`)],
      rows: report.rows.filter(row => row.status === 'run').map(row => [row.rowId, ...row.bySession.map(session => score(session.cgc))]) })
    + '\n\n' + table({ head: ['Guard', 'Checked', 'Violations'], rows: report.guards.map(guard => [guard.code, guard.checked, guard.violations]) })
    + `\n\nThe ${r.poisonTraces} poison and ${r.crossScopeTraces} foreign-scope traces are isolated controls; neither is admitted as experience or evaluation truth. All frozen alpha(K) rows are not-run; the ${r.manifest.discriminationCeiling} discrimination ceiling has not been tested on a model.\n\n`
    + report.limitations.map(value => '- ' + value).join('\n') + '\n';
}

/** Plans bind source, fixture, row census and hard ceilings without containing credentials. */
export async function planCgtLive(options: { root?: string; seed?: number; sessions?: number; env?: Record<string, string | undefined> } = {}) {
  const root = options.root ?? process.cwd(), fixture = await loadCgtFixture(root, options), env = readAiEnv(options.env);
  await validateCgtFixture(fixture);
  const identity = env.live ? await envConfigIdentity(env, null) : null;
  const freshPerRow = fixture.questions.length + fixture.manifest.sessions * fixture.questions.filter(value => value.partition === 'novel').length;
  const maximumFreshCalls = CGT_LIVE_ROWS.length * freshPerRow + 3 * fixture.questions.filter(value => value.partition === 'novel').length;
  const body = { schemaVersion: 1, benchmark: 'cgt-live-plan', source: await measuredSource(root),
    manifestDigest: await canonicalSha256(fixture.manifest), fixtureId: fixture.fixtureId, rows: [...CGT_LIVE_ROWS],
    K: fixture.manifest.retrievalK, T: fixture.manifest.sessions, maximumFreshCalls, maxCalls: env.maxCalls,
    modelIdentity: identity, configured: env.live, executable: false,
    reason: !env.live ? env.reason : maximumFreshCalls > env.maxCalls ? 'planned requests exceed TANGLE_AI_MAX_CALLS; no executor is installed' : 'No live executor is installed.' };
  return deepFreeze({ ...body, planId: await canonicalSha256(body) });
}
export function authorizeCgtLive(plan: Awaited<ReturnType<typeof planCgtLive>>, authorization?: string): 'dry-run' | 'skipped' | 'implementation-missing' {
  if (authorization !== undefined && authorization !== plan.planId) throw Error('cgt live authorization: plan-id mismatch');
  if (!plan.configured) return 'skipped';
  return authorization === undefined ? 'dry-run' : 'implementation-missing';
}
