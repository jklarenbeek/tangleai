/** Independent graph retrieval registration over an authored corpus and the shipped dense lane. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { drawDistinct, mulberry32 } from '@jarenjs/core/random';
import { mean } from '@jarenjs/core/stats';
import { recallDocumentChunks } from '@tangleai/documents';
import { createBudgetAccount } from '@tangleai/agents';
import { createScriptedPlanner, retrieveLightRag, lightRagPrompt, lightragMust, LIGHTRAG_LIMITS, type LightRagMode } from '@tangleai/lightrag';
import { createReportValidator, describeErrors } from './validate.ts';
import { analyticEnvelope } from './report-envelope.ts';
import { sourceManifest } from './source-manifest.ts';
import { relevanceMetrics } from './relevance.ts';
import { oracleCeiling, randomBand, type GoldQuestion } from './recall.ts';
import { table, score } from './table.ts';
import schema from '../schemas/lightrag.schema.json' with { type: 'json' };
import identitySchema from '../../packages/config/schemas/run-identity.schema.json' with { type: 'json' };
import type { LightragFixture, LightragReport, Row, Case, Metrics, Limits, RowIdentity } from './lightrag.types.ts';
import { createLightRagFixtureCorpus, graphFixturePrompts, LIGHTRAG_SCRIPTED_MODEL } from './lightrag-corpus.ts';
import { measureLightRagOneHop, LIGHTRAG_ONE_HOP_PATH } from './lightrag-controls.ts';
import { observeGraphCase, observeGraphRow, graphMetrics } from './lightrag-measure.ts';
export { createLightRagFixtureCorpus } from './lightrag-corpus.ts';

export const LIGHTRAG_ROWS = ['oracle', 'random', 'dense-chunk', 'lightrag-low', 'lightrag-high', 'lightrag-hybrid', 'lightrag-hybrid-no-original'] as const;
export const LIGHTRAG_SEED = 24105779;
export const LIGHTRAG_INSTRUMENT_LIMITS: Limits = { ks: [1, 3, 5], k: 5, minScore: 0, maxPerSource: 2, neighbours: 0, contextTokens: 4000,
    keywordsPerLevel: 8, candidatesPerKeyword: 10, expansionEntities: 20, expansionRelations: 40, chunksPerSource: 3 };
export const LIGHTRAG_FIXTURE_PATH = 'benchmark/fixtures/lightrag/manifest.json';
export const createLightRagValidator = () => createReportValidator(schema, [identitySchema]);
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function mustValidate(value: unknown) {
    const checked = createLightRagValidator()(value);
    if (!checked.valid) throw Error('Invalid LightRAG instrument record: ' + describeErrors(checked, 5).join('; '));
}
export interface LoadedLightRagFixture { fixture: LightragFixture; fixtureId: string; files: Array<{ path: string; sha256: string }>; bodies: Map<string, Uint8Array> }
export async function loadLightRagFixture(root = process.cwd()): Promise<LoadedLightRagFixture> {
    const bytes = await readFile(join(root, LIGHTRAG_FIXTURE_PATH)), fixture = JSON.parse(bytes.toString('utf8')) as LightragFixture;
    mustValidate(fixture);
    const files = [{ path: LIGHTRAG_FIXTURE_PATH, sha256: digest(bytes) }], bodies = new Map<string, Uint8Array>();
    for (const source of fixture.sources) {
        if (source.versions.filter(version => version.status === 'active').length !== 1 || source.versions.at(-1)!.status !== 'active')
            throw Error('The authored source must end in exactly one active version.');
        for (const version of source.versions) {
            const path = 'benchmark/fixtures/lightrag/' + version.file, body = await readFile(join(root, path));
            if (digest(body) !== version.sha256) throw Error('LightRAG fixture bytes do not match the manifest digest: ' + path);
            files.push({ path, sha256: digest(body) }); bodies.set(version.key, body);
        }
    }
    const versions = new Map(fixture.sources.flatMap(source => source.versions.map(version => [version.key, version] as const)));
    const chunks = new Map(fixture.chunks.map(chunk => [chunk.key, chunk])), entities = new Set(fixture.entities.map(row => row.key)), relations = new Set(fixture.relations.map(row => row.key));
    const requireChunk = (id: string, active = false) => {
        const chunk = chunks.get(id);
        if (!chunk || !versions.has(chunk.version) || active && versions.get(chunk.version)!.status !== 'active') throw Error('LightRAG oracle/support reference is unresolved: ' + id);
    };
    for (const chunk of fixture.chunks) requireChunk(chunk.key);
    for (const row of [...fixture.entities, ...fixture.relations]) for (const id of row.supportChunks) requireChunk(id, true);
    for (const relation of fixture.relations) if (!entities.has(relation.source) || !entities.has(relation.target)) throw Error('LightRAG relation endpoint is unresolved.');
    for (const question of fixture.questions) {
        for (const id of question.goldChunks) requireChunk(id, true);
        if (question.goldEntities.some(id => !entities.has(id)) || question.goldRelations.some(id => !relations.has(id))) throw Error('LightRAG oracle graph reference is unresolved.');
    }
    for (const collection of [fixture.extraction, fixture.chunkProfiles]) {
        if (new Set(collection.map(row => row.chunk)).size !== chunks.size) throw Error('LightRAG extraction/profile chunk coverage differs.');
        for (const row of collection) requireChunk(row.chunk);
    }
    const activeChunks = fixture.chunks.filter(chunk => versions.get(chunk.version)!.status === 'active').length;
    const duplicateElementPairs = fixture.chunks.slice(1).filter((chunk, i) => chunk.version === fixture.chunks[i].version && chunk.elementOrders.some(id => fixture.chunks[i].elementOrders.includes(id))).length;
    const aliasPairs = fixture.entities.reduce((n, entity) => n + entity.aliases.length, 0);
    const collisions = new Map<string, Set<string>>();
    for (const entity of fixture.entities) { const types = collisions.get(entity.name) ?? new Set<string>(); types.add(entity.type); collisions.set(entity.name, types); }
    const reversedEdgePairs = fixture.relations.filter(row => fixture.relations.some(other => other.source === row.target && other.target === row.source)).length / 2;
    const edges = new Map<string, number>(); for (const row of fixture.relations) { const pair = JSON.stringify([row.source, row.target]); edges.set(pair, (edges.get(pair) ?? 0) + 1); }
    for (const [name, value] of Object.entries({ activeChunks, duplicateElementPairs, aliasPairs, sameNameCollisions: [...collisions.values()].filter(types => types.size > 1).length,
        reversedEdgePairs, multipleRelationPairs: [...edges.values()].filter(count => count > 1).length }))
        if (fixture.census[name as keyof typeof fixture.census] !== value) throw Error('LightRAG fixture census differs: ' + name);
    return { fixture, fixtureId: await canonicalSha256(fixture), files: files.sort((a,b) => a.path.localeCompare(b.path)), bodies };
}

function recallOf(read: (k: 1 | 3 | 5) => number): Metrics['recall'] { return { '1': read(1), '3': read(3), '5': read(5) }; }
function metricsOf(cases: Case[]): Metrics {
    if (!cases.length) throw Error('LightRAG metrics require an observed question denominator.');
    return { count: cases.length, recall: recallOf(k => mean(cases.map(row => row.recall[k]))!), mrr: mean(cases.map(row => row.mrr))!, ...(cases[0].graph ? { graph: graphMetrics(cases) } : {}) };
}
/** The existing relevance scorer owns fractional recall and reciprocal rank. */
function scoreCase(question: LightragFixture['questions'][number], ranked: string[], available: Set<string>, skipped = 0): Case {
    const measured = relevanceMetrics([{ id: question.id, gold: question.goldChunks }], [ranked], [1,3,5]);
    if (measured.mrr === null) throw Error('A registered LightRAG claim question cannot have null MRR.');
    return { question: question.id, kind: question.kind, ranked, recall: recallOf(k => { const value = measured.recall[k]; if (value === null) throw Error('A registered LightRAG claim question cannot have null recall.'); return value; }), mrr: measured.mrr,
        resolved: ranked.filter(id => available.has(id)).length, unresolved: ranked.filter(id => !available.has(id)).length, skipped, failed: 0 };
}
export async function buildLightRagReport(options: { root?: string; loaded?: LoadedLightRagFixture } = {}): Promise<LightragReport> {
    const root = options.root ?? process.cwd(), loaded = options.loaded ?? await loadLightRagFixture(root), fixture = loaded.fixture;
    const questionSetId = await canonicalSha256(fixture.questions), limits = structuredClone(LIGHTRAG_INSTRUMENT_LIMITS);
    const flatHandoffSha256 = digest(await readFile(join(root, 'benchmark/results/grounding-handoff.json')));
    const registrationBody = { fixtureId: loaded.fixtureId, questionSetId, questionIds: fixture.questions.map(question => question.id), rows: [...LIGHTRAG_ROWS],
        seed: LIGHTRAG_SEED, limits, chunker: fixture.chunker, flatHandoffSha256 };
    const registration = { ...registrationBody, registrationId: await canonicalSha256(registrationBody) } as LightragReport['registration'];
    const activeVersions = new Set(fixture.sources.flatMap(source => source.versions.filter(version => version.status === 'active').map(version => version.key)));
    const universe = fixture.chunks.filter(chunk => activeVersions.has(chunk.version)).map(chunk => chunk.key), available = new Set(universe), random = mulberry32(LIGHTRAG_SEED);
    const corpus = await createLightRagFixtureCorpus(loaded, { graph: 'memory' }), rows: Row[] = [];
    const planner = createScriptedPlanner(fixture.questions), graphBuild = { backend: 'memory' as const, contributions: corpus.contributions.length,
        entities: (await corpus.graph!.listEntities()).length, relations: (await corpus.graph!.listRelations()).length,
        entityClaims: corpus.contributions.reduce((n, row) => n + row.plan.input.claims.entities.length, 0), relationClaims: corpus.contributions.reduce((n, row) => n + row.plan.input.claims.relations.length, 0),
        localCalls: corpus.indexing.calls, budgetTokens: corpus.indexing.tokens, providerCalls: 0 as const, providerTokens: 0 as const };
    try {
        for (const key of LIGHTRAG_ROWS) {
            const isGraph = key.startsWith('lightrag-'), cases: Case[] = [], mode = key.slice('lightrag-'.length) as LightRagMode;
            const identity: RowIdentity = { corpusId: loaded.fixtureId, questionSetId, retrievalMode: (isGraph ? mode : key) as RowIdentity['retrievalMode'],
                model: isGraph ? LIGHTRAG_SCRIPTED_MODEL as { provider: 'fixture'; model: 'scripted' } : null,
                prompts: isGraph ? { ...graphFixturePrompts(), planning: lightRagPrompt('graph-planner').revision } : null,
                chunker: fixture.chunker, embeddedBy: fixture.chunker.embeddedBy, providerStatus: isGraph ? 'scripted' : 'not-run' };
            for (const question of fixture.questions) {
                let ranked: string[], skipped = 0;
                if (isGraph) {
                    const plan = lightragMust(await planner(question.text, { mode, limits: LIGHTRAG_LIMITS }));
                    const value = lightragMust(await retrieveLightRag({ store: corpus.graph!, documents: corpus.store, embedder: corpus.embedder, plan,
                        budget: createBudgetAccount({ turns: 8, tokens: 100000 }, () => 0), clock: () => 0, includeTimings: false }));
                    const measured = observeGraphCase(question, value, corpus);
                    cases.push({ ...scoreCase(question, measured.ranked, available, measured.skipped), graph: measured.graph }); continue;
                }
                if (key === 'oracle') ranked = [...question.goldChunks.filter(id => available.has(id)), ...universe.filter(id => !question.goldChunks.includes(id))].slice(0, limits.k);
                else if (key === 'random') ranked = drawDistinct(random, universe.length, limits.k).map(index => universe[index]);
                else {
                    const [query] = await corpus.embedder.embed([question.text]);
                    const result = await recallDocumentChunks(corpus.store, query, fixture.chunker.embeddedBy, limits);
                    ranked = result.ranked.map(hit => corpus.keyById.get(hit.chunk.id)!); skipped = result.skipped;
                }
                cases.push(scoreCase(question, ranked, available, skipped));
            }
            rows.push({ key, status: 'executed', reason: null, identity, limits, cost: { calls: 0, tokens: 0, ms: 0 }, cases,
                metrics: metricsOf(cases), byKind: (['specific','abstract','one-hop'] as const).map(kind => ({ kind, metrics: metricsOf(cases.filter(row => row.kind === kind)) })),
                skipped: cases.reduce((n,row) => n + row.skipped, 0), failed: 0,
                citations: { resolved: cases.reduce((n,row) => n + row.resolved, 0), unresolved: cases.reduce((n,row) => n + row.unresolved, 0) },
                ...(isGraph ? { graph: observeGraphRow(mode, cases) } : {}) });
        }
    } finally { await corpus.close(); }
    const oneHop = await measureLightRagOneHop(root);
    const gold: GoldQuestion[] = fixture.questions.map(question => ({ category: ['specific','abstract','one-hop'].indexOf(question.kind), gold: question.goldChunks,
        resolvable: question.goldChunks.filter(id => available.has(id)).length, universe: universe.length }));
    const expected = recallOf(k => oracleCeiling(gold, k));
    const oracle = { expected, actual: rows[0].metrics!.recall, passed: limits.ks.every(k => expected[k as 1|3|5] === rows[0].metrics!.recall[k as 1|3|5]) };
    const bands = limits.ks.map(k => { const band = randomBand(gold, k), actual = rows[1].metrics!.recall[k as 1|3|5];
        return { k: k as 1|3|5, expected: band.floor, low: band.low, high: band.high, actual, passed: actual >= band.low && actual <= band.high }; });
    const references = [...fixture.questions.flatMap(question => question.goldChunks), ...fixture.entities.flatMap(row => row.supportChunks), ...fixture.relations.flatMap(row => row.supportChunks)];
    const unresolved = references.filter(id => !available.has(id)).length, resolution = { gold: fixture.questions.reduce((n,q) => n + q.goldChunks.length, 0), support: references.length - fixture.questions.reduce((n,q) => n + q.goldChunks.length, 0), unresolved, passed: unresolved === 0 };
    const failures = [...(!oracle.passed ? ['oracle does not equal its analytic ceiling'] : []), ...bands.filter(row => !row.passed).map(row => 'random recall@' + row.k + ' outside its analytic band'), ...(!resolution.passed ? ['oracle/support references unresolved'] : []), ...(!oneHop.passed ? ['registered one-hop control failed'] : [])];
    const manifest = await sourceManifest(root, [...loaded.files.map(file => file.path), 'benchmark/lightrag.ts', 'benchmark/lib/lightrag.ts', 'benchmark/lib/lightrag.types.ts',
        'benchmark/schemas/lightrag.schema.json', 'benchmark/lib/lightrag-corpus.ts', 'benchmark/lib/lightrag-controls.ts', 'benchmark/lib/lightrag-measure.ts', LIGHTRAG_ONE_HOP_PATH, ...['entity_extraction','entity_profiling','deduplication','keyword_planning'].map(name => 'prompts/graph/' + name + '.toml'), 'benchmark/lib/relevance.ts', 'benchmark/lib/recall.ts', 'benchmark/lib/source-manifest.ts', 'benchmark/lib/validate.ts', 'benchmark/lib/table.ts', 'scripts/lightrag-schema.ts', 'packages/documents/src/grounding.ts', 'packages/context/src/evidence.ts',
        'packages/documents/src/chunking.ts', 'packages/documents/src/retrieval.ts', 'packages/documents/src/ingest.ts', 'packages/documents/src/contracts.ts', 'packages/context/src/ledger.ts', 'packages/core/src/tokens.ts', 'packages/agents/src/recursive.ts', 'packages/models/src/structured.ts', 'packages/store/src/document-store.ts', 'packages/store/src/document-state.ts', 'packages/store/src/corpus-promotion.ts', 'packages/store/src/lightrag-store.ts', 'packages/store/src/lightrag-model.ts', 'packages/models/src/embed.ts'], ['packages/lightrag']);
    const source = { files: manifest.files, sha256: await canonicalSha256({ files: manifest.files }) };
    const body = { document: 'lightrag-report' as const, benchmark: 'lightrag' as const, schemaVersion: 1 as const, registration, fixture: fixture.census, source,
        configIdentities: analyticEnvelope(LIGHTRAG_ROWS), rows, graphBuild, gate: { passed: failures.length === 0, oracle, random: bands, resolution, failures, oneHop },
        decision: { state: 'not-evaluated' as const, defaultChanged: false as const, reason: 'Scripted graph mechanisms are measured; live answer quality is unmeasured.' as const } };
    const report = { ...body, reportId: await canonicalSha256(body) }; mustValidate(report); return report;
}
export function requireLightRagGate(report: LightragReport) {
    if (!report.gate.passed) throw Error('LightRAG gate failed: ' + report.gate.failures.join('; '));
}
export const renderLightRagReport = (report: LightragReport) => JSON.stringify(report, null, 2) + '\n';
export function renderLightRagDocument(report: LightragReport) {
    const dense = report.rows.find(row => row.key === 'dense-chunk')!, graph = report.rows.filter(row => row.graph);
    const losses = graph.flatMap(row => row.byKind.flatMap(group => {
        const baseline = dense.byKind.find(value => value.kind === group.kind)!.metrics;
        return [1,3,5].flatMap(k => group.metrics.recall[k as 1|3|5] < baseline.recall[k as 1|3|5] ? [[row.key, group.kind, 'Recall@'+k, score(group.metrics.recall[k as 1|3|5]), score(baseline.recall[k as 1|3|5])]] : [])
            .concat(group.metrics.mrr < baseline.mrr ? [[row.key, group.kind, 'MRR', score(group.metrics.mrr), score(baseline.mrr)]] : []);
    }));
    const control = report.gate.oneHop;
    return ['# Graph retrieval benchmark', '', 'Generated by `npm run benchmark:lightrag` from the original MIT fictional Windmere corpus.', '',
        'All seven rows execute without a provider. Graph extraction, profiling, co-reference and planning use frozen scripted replies; entity names, relation themes and query keywords use the shipped hash-trigram embedder. These are software mechanism measurements. Live answer quality and the paper dataset, judge and scores remain unmeasured.', '',
        '**The hybrid-no-original row has the same chunk recall as hybrid by construction:** both select the same candidates and citation targets under the same full-context budget; the ablation then removes verbatim chunk text. Its independent answer-quality meaning belongs to the live tier.', '',
        `Corpus: ${report.fixture.sources} sources, ${report.fixture.versions} versions, ${report.fixture.chunks} retained chunks (${report.fixture.activeChunks} active), ${report.fixture.entities} entities, ${report.fixture.relations} directed relations and ${report.fixture.questions} questions, six each specific, abstract and one-hop. Two alias pairs, two same-name/different-type collisions, one reversed-edge pair, one pair with distinct relation themes and ${report.fixture.duplicateElementPairs} adjacent pairs sharing source elements are registered.`, '',
        `Chunker \`${report.registration.chunker.version}\`, ${report.fixture.maxTokens}/${report.fixture.overlapTokens} token/overlap budgets; embedder \`${report.registration.chunker.embeddedBy.model}\`, ${report.registration.chunker.embeddedBy.dims} dimensions. Seed ${report.registration.seed}. The superseded source remains addressable and is excluded from active retrieval.`, '',
        table({ head: ['Row','Recall@1','Recall@3','Recall@5','MRR','Entity recall','Relation recall','Unresolved','Provider calls'], rows: report.rows.map(row => [row.key,
            ...[1,3,5].map(k => score(row.metrics.recall[k as 1|3|5])), score(row.metrics.mrr), row.metrics.graph?.entityRecall == null ? null : score(row.metrics.graph.entityRecall),
            row.metrics.graph?.relationRecall == null ? null : score(row.metrics.graph.relationRecall), row.citations.unresolved, row.cost.calls]) }), '',
        table({ head: ['Row / question kind','Questions','Recall@1','Recall@3','Recall@5','MRR','Entity recall (n)','Relation recall (n)'], rows: report.rows.flatMap(row => row.byKind.map(group => [row.key+' / '+group.kind,group.metrics.count,
            ...[1,3,5].map(k => score(group.metrics.recall[k as 1|3|5])),score(group.metrics.mrr), group.metrics.graph ? score(group.metrics.graph.entityRecall)+' ('+group.metrics.graph.entityQuestions+')' : null,
            group.metrics.graph ? score(group.metrics.graph.relationRecall)+' ('+group.metrics.graph.relationQuestions+')' : null])) }), '',
        'Every graph loss against dense retrieval is printed below, including individual cutoffs and MRR. Retrieving a relevant citation somewhere in the context does not imply a good position at a smaller cutoff.', '',
        table({ head: ['Graph row','Question kind','Metric','Graph','Dense'], rows: losses }), '',
        table({ head: ['Graph row','Name candidates','Theme candidates','Original text','Prune events','Skipped identity / width / unresolved','Local embedding calls','Estimated budget tokens'], rows: graph.map(row => [row.key,
            row.graph!.candidateSources.entityKeywords ? 'yes' : 'no', row.graph!.candidateSources.relationKeywords ? 'yes' : 'no', row.graph!.candidateSources.originalChunks ? 'yes' : 'no',
            Object.values(row.graph!.prune).reduce((n,value) => n+value,0), [row.graph!.skipped.identity,row.graph!.skipped.width,row.graph!.skipped.unresolvable].join(' / '), row.graph!.localCalls,row.graph!.budgetTokens]) }), '',
        'Pruning counts trace events, including candidates beyond per-keyword limits; skipped counts distinct canonical identities for each refusal reason. Each report case records every prune reason, the actual context token estimate and its selected graph ids. Entity and relation recall average only questions with corresponding gold ids; empty denominators remain null. Citation targets are ranked by their maximum supporting graph score, then their original chunk id, using the same deterministic order as retrieval.', '',
        `One shared graph build admits ${report.graphBuild.contributions} contributions with ${report.graphBuild.entityClaims} entity claims and ${report.graphBuild.relationClaims} relation claims: ${report.graphBuild.localCalls} local hash-embedding calls and ${report.graphBuild.budgetTokens} estimated budget tokens. Query rows count their own local work separately. Provider calls and provider tokens are zero. The clock-free cost field is zero by construction, not measured latency; runtime timings stay outside this report.`, '',
        table({ head: ['Cutoff','Oracle ceiling','Observed oracle','Random expectation','Random band','Observed random'], rows: report.gate.random.map(row => [row.k,
            score(report.gate.oracle.expected[row.k]),score(report.gate.oracle.actual[row.k]),score(row.expected),'['+score(row.low)+', '+score(row.high)+']',score(row.actual)]) }), '',
        'Fractional recall and MRR reuse the existing relevance scorer. Oracle ceilings depend on each question’s number of resolvable gold chunks; an oracle can fall below 1 at a smaller cutoff without losing reachable evidence. Random draws are without replacement and use the registered analytic band. Every gold and graph support reference resolves before publication. The oracle, random and dense row objects are unchanged from the pre-graph control.', '',
        `The separately preregistered one-hop control keeps marker facts in distinct source chunks. The reachable Bridge fact is found: **${control.oneHopFound}**; the Far fact two hops away is found: **${control.twoHopFound}**; Bridge is found without expansion: **${control.withoutExpansionOneHopFound}**. With expansion it returns ${control.withExpansion.chunkKeys.join(', ')}; without expansion it returns ${control.withoutExpansion.chunkKeys.join(', ')}. The Bridge–Far connection chunk contains an endpoint claim, but it cannot satisfy the separate Far marker fact. Registration bytes: \`${control.sha256}\`.`, '',
        `Limits: ${report.registration.limits.keywordsPerLevel} keywords per level, ${report.registration.limits.candidatesPerKeyword} candidates per keyword, ${report.registration.limits.expansionEntities} added entities, ${report.registration.limits.expansionRelations} added relations, ${report.registration.limits.chunksPerSource} citation chunks per source and ${report.registration.limits.contextTokens} estimated context tokens. Dense remains k ${report.registration.limits.k}, minimum score ${report.registration.limits.minScore}, at most ${report.registration.limits.maxPerSource} chunks per source, no neighbours. Host overrides are explicit and recorded.`, '',
        'Scale targets remain registered at 100, 1,000 and 10,000 chunks, with SQLite hybrid p95 at most 250 ms at 10,000. This mechanism report makes no scale-performance claim.', '',
        `The immutable flat handoff SHA-256 is \`${report.registration.flatHandoffSha256}\`. Gate: **${report.gate.passed ? 'passed' : 'failed'}**. Source \`${report.source.sha256}\`; registration \`${report.registration.registrationId}\`; report \`${report.reportId}\`.`, '',
        'Decision: **not-evaluated**; product default unchanged. Live paired, judge and separately licensed parity measurements require their own registered plans and explicit approval.', ''].join('\n');
}
