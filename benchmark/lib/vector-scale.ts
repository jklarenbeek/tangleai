/** Registered graph controls; deterministic evidence and physical clocks stay separate. */
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir, cpus, loadavg } from 'node:os';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { equalsJson } from '@jarenjs/core/object';
import { createBudgetAccount } from '@tangleai/agents';
import { openTangleDb, createLightRagStore, createDocumentStore, createGraphVectorRank, applyGraphVectorMigrations, verifyVectorPlan } from '@tangleai/store';
import { createScriptedPlanner, retrieveLightRag, lightragMust, type LightRagRetrieval } from '@tangleai/lightrag';
import { loadLightRagFixture } from './lightrag.ts';
import { LIGHTRAG_LADDER_REGISTRATION, validateLightRagLadder } from './lightrag-ladder.ts';
import { createLightRagLadderCorpus } from './lightrag-ladder-corpus.ts';
import { createResidentGraphOracle } from './vector-resident.ts';
import { createVectorSqlObserver, observeVectorReads } from './vector-observation.ts';
import { compareGraphRetrieval, vectorRetrievalEvidence } from './vector-parity.ts';
import { vectorScaleControls } from './vector-controls.ts';
import { qualifyNativeGraph } from './vector-native-parity.ts';
import { vectorReadDeclaration, vectorReadMigration, vectorStorageBytes, measureVectorStaging } from './vector-staging-cost.ts';
import { sourceManifest } from './source-manifest.ts';
import { createReportValidator, describeErrors } from './validate.ts';
import { latency } from './stats.ts';
import schema from '../schemas/vector-scale.schema.json' with { type: 'json' };
import registered from '../fixtures/vector/registration.json' with { type: 'json' };
import type { VectorRegistration, VectorTrigger, VectorScaleReport, VectorScaleReceipt,
  VectorScaleRow, VectorBackendTiming, VectorBuildCost, VectorTimingSample } from './vector-scale.types.ts';

export const VECTOR_REGISTRATION = registered as VectorRegistration;
const exec = promisify(execFile), hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export class VectorScaleRefusal extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions) { super(message, options); this.code = code; }
}
const refuse = (code: string, message: string): never => { throw new VectorScaleRefusal(code, message); };
const validateShape = createReportValidator(schema);
export async function loadVectorTrigger(root = process.cwd()): Promise<VectorTrigger> {
  try {
    const trigger = JSON.parse(await readFile(join(root, 'benchmark/fixtures/vector/trigger.json'), 'utf8')) as VectorTrigger;
    const bytes = await readFile(join(root, 'benchmark/fixtures/vector/trigger-ladder.json'));
    const receipt = await validateLightRagLadder(JSON.parse(bytes.toString()));
    if (!/^[a-f0-9]{40}$/.test(trigger.releaseCommit) || hash(bytes) !== trigger.receiptSha256
      || trigger.receiptId !== receipt.receiptId || trigger.fixtureId !== receipt.fixtureId
      || trigger.sourceSha256 !== receipt.source.sha256 || trigger.registrationId !== receipt.registrationId
      || receipt.status !== 'measured' || receipt.backendDecision !== 'scale-row-registered'
      || receipt.rows.at(-1)!.chunks !== 10000 || receipt.rows.at(-1)!.retrieval.p95Ms <= 250
      || !equalsJson(receipt.registration, LIGHTRAG_LADDER_REGISTRATION)) refuse('TVEC1006', 'The registered released graph trigger differs.');
    const show = async (path: string) => (await exec('git', ['show', trigger.releaseCommit + ':' + path], { cwd: root, maxBuffer: 16 * 1024 * 1024 })).stdout;
    if (hash(await show('benchmark/results/lightrag-ladder.json')) !== trigger.receiptSha256
      || JSON.parse(await show('package.json')).version !== trigger.releaseVersion)
      refuse('TVEC1006', 'The trigger does not reproduce the registered release bytes.');
    for (const file of receipt.source.files) if (hash(await show(file.path)) !== file.sha256)
      refuse('TVEC1006', 'The released trigger contains a stale source binding: ' + file.path);
    return trigger;
  } catch (cause) {
    if (cause instanceof VectorScaleRefusal) throw cause;
    throw new VectorScaleRefusal('TVEC1006', 'The released graph trigger is missing or invalid.', { cause });
  }
}
export async function vectorScaleSource(root = process.cwd()) {
  const paths = ['package.json', 'package-lock.json', 'benchmark/vector-scale.ts', 'benchmark/lib/vector-scale.ts',
    'benchmark/lib/vector-scale.types.ts', 'benchmark/lib/vector-controls.ts', 'benchmark/lib/vector-parity.ts',
    'benchmark/lib/vector-resident.ts', 'benchmark/lib/vector-observation.ts', 'benchmark/lib/vector-native-parity.ts',
    'benchmark/lib/vector-staging-cost.ts', 'benchmark/lib/lightrag-ladder.ts',
    'benchmark/lib/lightrag-ladder-corpus.ts', 'benchmark/lib/lightrag.ts', 'benchmark/lib/lightrag-corpus.ts',
    'benchmark/lib/stats.ts', 'benchmark/lib/validate.ts', 'benchmark/lib/source-manifest.ts',
    'benchmark/schemas/vector-scale.schema.json', 'benchmark/fixtures/vector/registration.json',
    'benchmark/fixtures/vector/trigger.json', 'benchmark/fixtures/vector/trigger-ladder.json',
    'benchmark/fixtures/lightrag/manifest.json', 'benchmark/fixtures/lightrag/ladder-registration.json'];
  const { files } = await sourceManifest(root, paths, ['packages/lightrag', 'packages/store', 'packages/documents', 'packages/models', 'packages/outcomes', 'packages/agents', 'packages/context', 'packages/core']);
  return { files, sha256: await canonicalSha256({ files }) };
}
export async function measureVectorScale(options: { root?: string; sizes?: number[]; timer?: () => number; physicalRequests?: () => number; onProgress?: (line: string) => void } = {}) {
  const root = options.root ?? process.cwd(), trigger = await loadVectorTrigger(root), source = await vectorScaleSource(root);
  const sizes = options.sizes ?? [...VECTOR_REGISTRATION.sizes], timer = options.timer ?? (() => performance.now());
  if (!sizes.length || sizes.some((size, index) => !Number.isSafeInteger(size) || size < 1 || size > 10000 || index > 0 && size <= sizes[index - 1]))
    refuse('TVEC1006', 'Graph sizes must increase within the registered bound.');
  const loaded = await loadLightRagFixture(root), controls = await vectorScaleControls();
  const qualification = await qualifyNativeGraph(root);
  if (!controls.golden.equal || !controls.randomOverlapPassed) refuse('TVEC1005', 'A registered ranking control failed.');
  const rows: VectorScaleRow[] = [], timings: VectorBackendTiming[] = [], costs: VectorBuildCost[] = [];
  for (const size of sizes) {
    const directory = await mkdtemp(join(tmpdir(), 'tangle-vector-')), path = join(directory, 'graph.sqlite');
    const observer = createVectorSqlObserver(timer); let db = await openTangleDb({ path, driver: observer.driver }), closed = false;
    const close = async () => { if (!closed) { await db.close(); closed = true; } };
    try {
      observer.reset();
      const corpus = await createLightRagLadderCorpus(loaded, size, db, timer), buildSql = observer.snapshot();
      const start = timer(), resident = await createResidentGraphOracle(db, corpus.documents), snapshotMs = timer() - start;
      let storageBytes = 0;
      let migrationMs = 0, migrationSteps = 0, migrationSql: VectorBuildCost['migrationSql'] = {}, nativeStorageBytes = 0;
      const planner = createScriptedPlanner(loaded.fixture.questions), expected = new Map<string, LightRagRetrieval>();
      const row: VectorScaleRow = { chunks: size, ...corpus.canonicals, claims: corpus.claims,
        corpusSha256: await canonicalSha256(corpus.corpus), questions: [], nativeStatus: 'measured',
        nativeReason: 'Explicit native columns preserve the complete candidate trace; production selection follows the registered decision.' };
      for (const backend of ['resident', 'sqlite-sweep', 'sqlite-native'] as const) {
        if (backend === 'sqlite-native') {
          await close(); storageBytes = await vectorStorageBytes(path); observer.reset(); const started = timer(), migration = vectorReadMigration();
          const result = await applyGraphVectorMigrations({ driver: observer.driver, path }, [migration], { baseline: null, driver: observer.driver });
          migrationMs = timer() - started; migrationSteps = migration.migration.steps.length; migrationSql = observer.snapshot();
          if (!('applied' in result.result) || result.result.applied.length !== 1 || !result.status?.upToDate)
            refuse('TVEC1004', 'The registered native graph column migration did not settle.');
          nativeStorageBytes = await vectorStorageBytes(path);
          db = await openTangleDb({ path, driver: observer.driver, graphVectors: vectorReadDeclaration }); closed = false;
        }
        const nativeRank = backend === 'sqlite-native' ? createGraphVectorRank(db, vectorReadDeclaration) : null;
        const graph = backend === 'resident' ? resident.graph : nativeRank ? { ...createLightRagStore(db), rankRows: nativeRank.rows } : corpus.graph;
        const documents = backend === 'resident' ? resident.documents : nativeRank ? createDocumentStore(db) : corpus.documents;
        const reads = observeVectorReads(graph, documents, timer);
        const samples: VectorTimingSample[] = [];
        for (const [index, question] of [loaded.fixture.questions[0], ...loaded.fixture.questions].entries()) {
          const plan = lightragMust(await planner(question.text, { mode: 'hybrid', limits: LIGHTRAG_LADDER_REGISTRATION.limits }));
          observer.reset(); reads.reset(); nativeRank?.reset(); const started = timer();
          const result = lightragMust(await retrieveLightRag({ store: reads.graph, documents: reads.documents, embedder: corpus.embedder, plan,
            budget: createBudgetAccount({ turns: 4, tokens: 16000 }, () => 0), clock: timer }));
          const totalMs = timer() - started, sql = observer.snapshot();
          if (!Number.isFinite(totalMs) || totalMs < 0) refuse('TVEC1006', 'A monotonic complete-caller clock is required.');
          if (index === 0) continue;
          if (backend === 'resident') expected.set(question.id, result);
          const reference = expected.get(question.id)!, parity = compareGraphRetrieval(reference, result);
          if (!parity.equal) refuse('TVEC1005', 'Complete graph parity failed: ' + parity.paths.join(', '));
          const observed = nativeRank?.diagnostics();
          samples.push({ questionId: question.id, totalMs, rankingMs: Math.max(0, result.timings!.rankingMs - reads.snapshot().rankingFetchMs),
            fetchMs: reads.snapshot().fetchMs, sql,
            spendMs: result.spend.ms, planSpendMs: result.plan.spend.ms,
            native: observed ? { calls: observed.calls, ...observed.native, fallback: observed.fallback, refused: observed.refused,
              unrankable: observed.unrankable, proofs: observed.proofs.map(proof => JSON.stringify(proof)) } : null,
            traceRows: result.trace.length, citations: result.citations.length, parity });
          if (backend === 'sqlite-sweep') {
            const canonical = vectorRetrievalEvidence(result), oracle = vectorRetrievalEvidence(reference);
            row.questions.push({ questionId: question.id, resultDigest: await canonicalSha256(canonical), residentDigest: await canonicalSha256(oracle),
              nativeDigest: '', parity, traceRows: result.trace.length, pruned: result.pruned, skipped: result.skipped,
              citations: result.citations.map(citation => citation.chunkId), selectedScores: result.chunks.map(chunk => ({ id: chunk.id, score: chunk.score })) });
          }
          if (backend === 'sqlite-native') row.questions[index - 1].nativeDigest = await canonicalSha256(vectorRetrievalEvidence(result));
        }
        const measured = latency(samples.map(sample => sample.totalMs));
        timings.push({ backend, chunks: size, samples, p50Ms: measured.medianMs!, p95Ms: measured.p95Ms!, peakRssBytes: process.resourceUsage().maxRSS * 1024 });
        options.onProgress?.(`${backend} ${size} chunks: complete hybrid p95 ${measured.p95Ms!.toFixed(2)} ms; full parity passed.`);
      }
      await close();
      options.onProgress?.(`Preparing the complete isolated 128-D stage for ${size} chunks.`);
      const staging = await measureVectorStaging({ path, stagingPath: join(directory, 'staging.sqlite'), size, corpus: corpus.corpus, observer, timer });
      costs.push({ chunks: size, prepareMs: corpus.indexingMs, promoteMs: corpus.promotionMs, snapshotMs, storageBytes,
        sql: buildSql, embeddingCalls: corpus.indexing.embeddingCalls, embeddingTexts: corpus.indexing.embeddingTexts,
        migrationMs, migrationSteps, migrationSql, nativeStorageBytes, stagingMs: staging.totalMs, staging, migrationStatus: 'measured' });
      options.onProgress?.(`Completed isolated stage for ${size} chunks: ${staging.staged} source, ${staging.embeddingCalls} embedding calls.`);
      rows.push(row);
    } finally { await close(); await rm(directory, { recursive: true, force: true }); }
  }
  if (!equalsJson(source, await vectorScaleSource(root))) refuse('TVEC1006', 'Graph instrument inputs changed during measurement.');
  if ((options.physicalRequests?.() ?? 0) !== 0) refuse('TVEC1006', 'The keyless graph instrument attempted a network request.');
  const body: Omit<VectorScaleReport, 'reportId'> = { document: 'vector-scale', schemaVersion: 1,
    status: equalsJson(sizes, VECTOR_REGISTRATION.sizes) ? 'measured' : 'probe', registration: VECTOR_REGISTRATION,
    registrationId: await canonicalSha256(VECTOR_REGISTRATION), trigger, source, controls, qualification, rows,
    untriggered: ['memory', 'documents', 'locomo', 'ledger'], physicalRequests: 0, nativeQualification: 'parity-passed' };
  const report: VectorScaleReport = { ...body, reportId: await canonicalSha256(body) };
  const observation: Omit<VectorScaleReceipt, 'receiptId'> = { document: 'vector-scale-receipt', schemaVersion: 1,
    reportId: report.reportId, at: new Date().toISOString(), host: { platform: process.platform, arch: process.arch,
      cpu: cpus()[0]?.model ?? 'unknown', logicalCpus: cpus().length, runtime: process.version, loadAverage: loadavg() },
    rows: timings, costs, qualificationPassed: qualification.passed, ...vectorDecision(report, timings, costs), physicalRequests: 0 };
  const receipt: VectorScaleReceipt = { ...observation, receiptId: await canonicalSha256(observation) };
  await validateVectorScale(report, receipt, { root }); return { report, receipt };
}

export function vectorDecision(report: VectorScaleReport, rows: VectorBackendTiming[], costs: VectorBuildCost[]) {
  const gates = { completeLadder: report.status === 'measured', parity: report.nativeQualification === 'parity-passed' && report.qualification.passed
      && report.rows.every(row => row.questions.every(question => question.parity.equal && question.nativeDigest === question.resultDigest)),
    latency: rows.some(row => row.backend === 'sqlite-native' && row.chunks === 10000 && row.p95Ms <= VECTOR_REGISTRATION.maxP95Ms),
    costs: costs.length === report.rows.length && costs.every(cost => cost.migrationStatus === 'measured' && cost.migrationMs !== null
      && cost.migrationSteps !== null && cost.stagingMs !== null && cost.staging.staged === 1 && cost.staging.failed === 0) };
  const reasons = [!gates.completeLadder && 'The measured sizes do not complete the registered ladder.',
    !gates.parity && 'Required exact native parity did not pass.',
    !gates.latency && 'Complete native hybrid p95 at 10,000 chunks does not meet the registered 250 ms target.',
    !gates.costs && 'Required build, storage, backfill and complete staging costs are missing.'].filter((value): value is string => typeof value === 'string');
  const decision = !gates.completeLadder ? 'not-applicable' as const : gates.parity && gates.latency && gates.costs ? 'keep-native' as const : 'restore-sweep' as const;
  if (!reasons.length) reasons.push('All registered exact parity, complete-caller latency and operational cost gates passed.');
  return { gates, decision, reasons };
}

export async function validateVectorScale(report: VectorScaleReport, receipt: VectorScaleReceipt, options: { root?: string } = {}) {
  for (const value of [report, receipt]) {
    const result = validateShape(value); if (!result.valid) refuse('TVEC1006', describeErrors(result).join('; '));
  }
  const { reportId, ...body } = report, { receiptId, ...observation } = receipt;
  if (reportId !== await canonicalSha256(body) || receiptId !== await canonicalSha256(observation) || receipt.reportId !== reportId
    || !equalsJson(report.registration, VECTOR_REGISTRATION) || report.registrationId !== await canonicalSha256(VECTOR_REGISTRATION)
    || report.source.sha256 !== await canonicalSha256({ files: report.source.files })) refuse('TVEC1006', 'Vector evidence identities differ.');
  if (report.status === 'measured' && !equalsJson(report.rows.map(row => row.chunks), VECTOR_REGISTRATION.sizes)) refuse('TVEC1006', 'The required registered ladder is incomplete.');
  if (!report.controls.golden.equal || !report.controls.randomOverlapPassed || !equalsJson(report.controls, await vectorScaleControls())) refuse('TVEC1005', 'Ranking controls do not reproduce.');
  const sizes = report.rows.map(row => row.chunks);
  if (!sizes.length || sizes.some((size, i) => size < 1 || size > 10000 || i > 0 && size <= sizes[i - 1])
    || !equalsJson(receipt.costs.map(cost => cost.chunks), sizes) || receipt.rows.length !== sizes.length * 3)
    refuse('TVEC1006', 'The graph size or physical cost census differs.');
  const paths = report.source.files.map(file => file.path);
  if (!paths.length || !equalsJson(paths, [...new Set(paths)].sort()) || paths.some(path => path.startsWith('/') || path.split('/').includes('..')))
    refuse('TVEC1006', 'Source paths must be unique, sorted and relative.');
  const questions = (await loadLightRagFixture(options.root)).fixture.questions.map(question => question.id);
  for (const row of report.rows) {
    if (row.entities !== row.chunks * 2 || row.relations !== row.chunks || row.claims !== row.chunks * 3
      || row.questions.length !== VECTOR_REGISTRATION.questions || !row.questions.every(q => q.parity.equal && q.parity.differences === 0
        && q.resultDigest === q.residentDigest && q.traceRows >= q.pruned)) refuse('TVEC1005', 'The complete graph census or parity differs.');
    if (!equalsJson(row.questions.map(q => q.questionId), questions) || row.nativeStatus !== 'measured'
      || row.questions.some(q => q.nativeDigest !== q.resultDigest))
      refuse('TVEC1006', 'The registered question or native implementation census differs.');
    const measured = receipt.rows.filter(r => r.chunks === row.chunks);
    if (!equalsJson(measured.map(r => r.backend), ['resident', 'sqlite-sweep', 'sqlite-native'])) refuse('TVEC1006', 'A required physical control is missing.');
    for (const run of measured) {
      const times = latency(run.samples.map(s => s.totalMs));
      if (run.p50Ms !== times.medianMs || run.p95Ms !== times.p95Ms || !equalsJson(run.samples.map(s => s.questionId), row.questions.map(q => q.questionId))
        || !run.samples.every(s => s.parity.equal && s.parity.differences === 0)) refuse('TVEC1006', 'Physical samples or their summaries differ.');
      for (const [index, sample] of run.samples.entries()) {
        if (sample.traceRows !== row.questions[index].traceRows || sample.citations !== row.questions[index].citations.length
          || sample.fetchMs > sample.totalMs || sample.rankingMs > sample.totalMs
          || Object.values(sample.sql).some(count => count.failures !== 0 || count.writes !== 0)
          || run.backend === 'resident' && Object.keys(sample.sql).length !== 0
          || run.backend !== 'resident' && ((sample.sql.lightrag_entities?.returnedRows ?? 0) < row.entities
            || (sample.sql.lightrag_relations?.returnedRows ?? 0) < row.relations))
          refuse('TVEC1006', 'Read costs or delivered graph rows contradict the complete caller.');
        if (run.backend === 'sqlite-native') {
          const native = sample.native;
          if (!native || !native.calls || native.calls !== native.queries || native.diverted || native.fallback || native.refused || native.unrankable
            || native.rows < row.entities + row.relations || native.candidates !== native.rows || native.fullFetches > native.queries || !native.proofs.length)
            refuse('TVEC1006', 'The native query census contradicts the complete trace.');
          for (const proof of native!.proofs) verifyVectorPlan(JSON.parse(proof).explain, VECTOR_REGISTRATION.dims);
        } else if (sample.native !== null) refuse('TVEC1006', 'A sweep cannot report native ranking.');
      }
    }
  }
  for (const proof of report.qualification.proofs) verifyVectorPlan(JSON.parse(proof).explain, VECTOR_REGISTRATION.dims);
  if (!report.qualification.passed || report.nativeQualification !== 'parity-passed' || receipt.qualificationPassed !== report.qualification.passed)
    refuse('TVEC1005', 'Native qualification is incomplete.');
  for (const cost of receipt.costs) if (cost.migrationStatus !== 'measured' || cost.migrationMs === null || cost.migrationSteps !== vectorReadMigration().migration.steps.length
    || cost.stagingMs !== cost.staging.totalMs || cost.staging.staged !== 1 || cost.staging.failed || cost.staging.interrupted || !cost.staging.abandoned
    || cost.staging.columnMigrationSteps !== 4 || cost.staging.copiedRows < cost.chunks || !cost.staging.embeddingCalls
    || Object.values(cost.staging.sql).some(count => count.failures !== 0)) refuse('TVEC1006', 'Complete graph operational costs differ.');
  const decision = vectorDecision(report, receipt.rows, receipt.costs);
  if (!equalsJson({ decision: receipt.decision, gates: receipt.gates, reasons: receipt.reasons }, decision))
    refuse('TVEC1006', 'The native production decision differs from its registered gates.');
  return { report, receipt };
}

export function renderVectorScale(report: VectorScaleReport, receipt: VectorScaleReceipt): string {
  const lines = ['# Graph vector scale', '',
    `Report \`${report.reportId}\`; dated receipt \`${receipt.receiptId}\` (${receipt.at}).`, '',
    `Released trigger: ${report.trigger.releaseVersion} at \`${report.trigger.releaseCommit}\`. The registered target remains complete hybrid p95 ≤ ${report.registration.maxP95Ms} ms at 10,000 source chunks, with ${report.registration.dims}-dimensional embeddings.`, '',
    `Status: **${report.status}**. Native qualification: **${report.nativeQualification}**. Decision: **${receipt.decision}**.`, '',
    ...receipt.reasons.map(reason => '- ' + reason), '',
    '| Source chunks | Entities | Relations | Backend | Complete p50 ms | Complete p95 ms | Peak process RSS bytes |',
    '| ---: | ---: | ---: | --- | ---: | ---: | ---: |'];
  for (const row of report.rows) for (const timing of receipt.rows.filter(run => run.chunks === row.chunks))
    lines.push(`| ${row.chunks} | ${row.entities} | ${row.relations} | ${timing.backend} | ${timing.p50Ms.toFixed(2)} | ${timing.p95Ms.toFixed(2)} | ${timing.peakRssBytes} |`);
  lines.push('', 'The resident oracle reads a detached snapshot of the exact same prepared corpus. Every result is compared, including ordered scores, all rejected candidates, context, citations and graph revision; only timing fields are excluded.', '',
    `Golden ranking: ${report.controls.golden.equal ? 'passed' : 'failed'}. Seeded random overlap: ${report.controls.randomOverlap} across ${report.controls.randomQueries} probes (registered band ${report.registration.randomOverlapMin}–${report.registration.randomOverlapMax}).`, '',
    `Native qualification: ${report.qualification.randomCases} seeded rank cases, ${report.qualification.goldenCases} golden cases, ${report.qualification.typedCases} typed-array comparisons, ${report.qualification.refusedProbes} refused probes, ${report.qualification.fallbackCases} no-column fallbacks, ${report.qualification.retrievalCases} complete retrieval comparisons and ${report.qualification.fenceCases} revision-fence cases. Actual diversions: ${report.qualification.diverted}.`, '',
    'Every raw sample is retained in the dated receipt. Fetch time measures awaited store reads, including decoding and projection. Ranking time measures the ranking phase minus its awaited store reads. Complete time surrounds the entire retrieval call, including final validation and copying. SQLite counters measure rows actually delivered by statements, not pages scanned; their elapsed time is nested within fetch time. RSS is the process lifetime high-water mark.', '',
    '| Source chunks | Prepare ms | Promote ms | Resident snapshot ms | Sweep files bytes | Native files bytes | 64-D migration ms | Embedding calls | Embedded texts |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const cost of receipt.costs) lines.push(`| ${cost.chunks} | ${cost.prepareMs.toFixed(2)} | ${cost.promoteMs.toFixed(2)} | ${cost.snapshotMs.toFixed(2)} | ${cost.storageBytes} | ${cost.nativeStorageBytes} | ${cost.migrationMs!.toFixed(2)} | ${cost.embeddingCalls} | ${cost.embeddingTexts} |`);
  lines.push('', 'Sweep and native storage are sampled with all database handles closed, before and after the 64-dimensional backfill. Sizes include any retained database, write-ahead log and shared-memory files. Native migrations include their real shadow validation, DDL and backfill; write counters and all physical samples remain in the receipt.', '',
    '| Source chunks | Add 128-D column ms | Initialize stage ms | Prepare full stage ms | Total stage ms | Copied rows | Stage writes | Stage embedding calls | Stage file bytes |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const cost of receipt.costs) { const stage = cost.staging; lines.push(`| ${cost.chunks} | ${stage.columnMigrationMs.toFixed(2)} | ${stage.initializeMs.toFixed(2)} | ${stage.prepareMs.toFixed(2)} | ${stage.totalMs.toFixed(2)} | ${stage.copiedRows} | ${stage.writes} | ${stage.embeddingCalls} | ${stage.storageBytes} |`); }
  lines.push('', 'The isolated 128-dimensional stage prepares every source through the existing document and graph owners, then explicitly abandons its primary reservation. It does not swap the live benchmark corpus. Staging file sizes are sampled before the staging handle closes and include its journal files; the receipt retains the full operation counters and journal digest. Atomic swap, exact zero-embedding rollback and disposal are separately qualified by the migration tests and disposable example.', '',
    `Physical provider requests: ${receipt.physicalRequests}. Untriggered corpora: ${report.untriggered.join(', ')}.`, '',
    `Runtime: ${receipt.host.runtime}; ${receipt.host.platform}/${receipt.host.arch}; ${receipt.host.cpu}; ${receipt.host.logicalCpus} logical CPUs. Operational clocks and host data do not enter the canonical report identity.`, '');
  return lines.join('\n');
}
