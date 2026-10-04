/** Reproduce the authored registration and its raw oracle artifacts; never select seeds by outcome. */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { mulberry32 } from '@jarenjs/core/random';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { researchBytesSha256, RESEARCH_FIXTURE_PATH, type LoadedResearchFixture } from '../lib/research-fixture.ts';
import { RESEARCH_PROGRAM_IDS } from '../lib/research-programs.ts';
import { RESEARCH_EVALUATOR, researchComparison } from '../lib/research-evaluator.ts';
import { runResearchFixture } from '../lib/research-runner.ts';
import { createResearchLifecycleFixture } from '../lib/research-lifecycle-fixture.ts';
import { researchDiscoveryTranscripts } from '../lib/research-discovery-fixture.ts';
import { verifyResearchBundle } from '../lib/research-oracle.ts';
import { requireResearchShape } from '../lib/research-validation.ts';
import type { ResearchDataset, ResearchFixtureTopic, ResearchFixtureManifest, ResearchHiddenLabels,
  LiteratureRecord, ResearchBundle, ResearchContract, ExperimentPlan } from '../lib/research.types.ts';

const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => arg !== '--check')) throw new Error('Usage: research-fixtures.ts [--check]');
const check = args.includes('--check'), root = process.cwd(), files = new Map<string, Uint8Array>();
const bytes = (value: string) => new TextEncoder().encode(value);
const put = (path: string, value: unknown) => files.set(path, bytes(JSON.stringify(value, null, 2) + '\n'));
const licence = { spdx: 'MIT', provenance: 'tangle-authored-synthetic', source: 'LICENSE.md' } as const;
files.set('LICENSE.md', await readFile(join(root, 'LICENSE')));
put('prompts/fixture-writer.json', { id: 'fixture-writer-v1', instructions: [
  'Report every registered condition and seed with its evaluator observation and raw output.',
  'Make no causal or general method claim. Stop unless the frozen paired interval clears the threshold.',
  'The no-model floor emits only metric statements. Scripted oracle approval is not human review.' ] });

// Registration constants precede any program execution. The generated points are committed, not resampled at runtime.
const random = mulberry32(17753);
const blobs: ResearchDataset = { id: 'fixture-blobs-v1', kind: 'blobs', points: [[0, 0], [12, 0], [0, 12]].flatMap((center, cluster) =>
  Array.from({ length: 40 }, (_, index) => ({ id: 'point-' + cluster + '-' + index,
    vector: center.map(coordinate => coordinate + (random() - 0.5) * 4) }))) };
const pairs = [['planet', 'orbit'], ['forest', 'canopy'], ['ocean', 'coral'], ['desert', 'dune'],
  ['glacier', 'ice'], ['volcano', 'lava'], ['river', 'delta']];
const corpus: ResearchDataset = { id: 'fixture-corpus-v1', kind: 'corpus',
  documents: [...pairs.map((pair, index) => ({ id: 'doc-' + (index + 1), text: pair.join(' ') })),
    ...Array.from({ length: 5 }, (_, index) => ({ id: 'doc-' + (index + 8),
      text: Array.from({ length: 10 }, () => pairs.map(pair => pair[0]).join(' ')).join(' ') }))],
  queries: [...pairs, ['orbit', 'planet']].map((pair, index) => ({ id: 'query-' + (index + 1), text: pair.join(' ') })) };
put('datasets/blobs.json', blobs); put('datasets/corpus.json', corpus);
const datasets = new Map<string, ResearchDataset>([['datasets/blobs.json', blobs], ['datasets/corpus.json', corpus]]);
const replicatePolicy = { seeds: [1, 2, 3, 4, 5], minimum: 5, resamples: 2000, bootstrapSeed: 17753 };
const specifications = [
  { id: 'kmeans-seeding', title: 'Uniform random and k-means++ initialization', datasetPath: 'datasets/blobs.json',
    baseline: 'kmeans-seeding/random', candidate: 'kmeans-seeding/plusplus', metric: 'inertia', unit: 'squared-distance',
    direction: 'minimize' as const, params: { k: 3, maxIterations: 100 }, seeds: [1, 2, 3, 4, 5], truth: 'improvement' as const },
  { id: 'lexical-ranking', title: 'Plain term frequency and native BM25+ ranking', datasetPath: 'datasets/corpus.json',
    baseline: 'lexical-ranking/tf', candidate: 'lexical-ranking/bm25plus', metric: 'recall-at-5', unit: 'fraction',
    direction: 'maximize' as const, params: { limit: 5 }, seeds: [1], truth: 'improvement' as const },
  { id: 'embedder-width', title: 'Hash embedding width on a saturated corpus', datasetPath: 'datasets/corpus.json',
    baseline: 'embedder-width/64', candidate: 'embedder-width/256', metric: 'recall-at-5', unit: 'fraction',
    direction: 'maximize' as const, params: { limit: 5 }, seeds: [1], truth: 'SATURATED' as const },
];
const topics: ResearchFixtureTopic[] = [], hidden = new Map<string, ResearchHiddenLabels>(), literature: LiteratureRecord[] = [];
for (const spec of specifications) {
  const projectId = spec.id + '-project', dataset = datasets.get(spec.datasetPath)!;
  const contractBody: Omit<ResearchContract, 'contractHash'> = { id: spec.id + '-contract', projectId,
    hypothesisSpace: [spec.candidate + ' improves ' + spec.metric + ' over ' + spec.baseline + ' on this fixture.'],
    successRule: { metric: spec.metric, baseline: 'baseline', condition: 'candidate', minImprovement: 0, confidenceLevel: 0.95 },
    failureRule: 'stop-on-invalid', metrics: [{ id: spec.metric, unit: spec.unit, direction: spec.direction }],
    datasets: [{ id: dataset.id, sha256: researchBytesSha256(files.get(spec.datasetPath)!) }],
    splits: { train: [], test: dataset.kind === 'blobs' ? dataset.points.map(point => point.id) : dataset.queries.map(query => query.id) },
    requiredBaselines: [{ condition: 'baseline', programId: spec.baseline, source: 'benchmark/lib/research-programs.ts', licence }],
    replicatePolicy: { ...replicatePolicy, seeds: spec.seeds, minimum: spec.seeds.length },
    attemptCap: 1, pivotCap: 1, reviewCap: 1, selectionRule: { kind: 'all', n: spec.seeds.length, metric: spec.metric },
    stopConditions: ['invalid evidence', 'registered budget reached', 'no positive paired interval', 'saturated metric'] };
  const contract = { ...contractBody, contractHash: await canonicalSha256(contractBody) };
  const planBody: Omit<ExperimentPlan, 'planHash'> = { id: spec.id + '-plan', projectId, contractHash: contract.contractHash,
    hypothesisHash: await canonicalSha256(contract.hypothesisSpace),
    conditions: [{ id: 'baseline', programId: spec.baseline, datasetId: dataset.id, params: spec.params },
      { id: 'candidate', programId: spec.candidate, datasetId: dataset.id, params: spec.params }],
    inputPaths: [spec.datasetPath], evaluator: RESEARCH_EVALUATOR };
  const topic = { id: spec.id, title: spec.title, datasetPath: spec.datasetPath, hiddenPath: 'hidden/' + spec.id + '.json',
    contract, plan: { ...planBody, planHash: await canonicalSha256(planBody) }, licence };
  topics.push(topic); put('topics/' + spec.id + '.json', topic);
  const labels: ResearchHiddenLabels = { topicId: spec.id,
    relevantLiterature: [1, 2, 3, 4, 5, 6, 9, 10].map(index => spec.id + '-paper-' + index),
    requiredClaims: [
      { id: spec.id + '-literature', kind: 'literature', text: 'The synthetic ' + spec.id + ' protocol compares the same feature inputs under two declared methods.',
        literatureId: spec.id + '-paper-1', observationCondition: null, strength: 'descriptive' },
      { id: spec.id + '-limitation', kind: 'interpretation', text: 'These synthetic results do not establish a general method advantage.',
        literatureId: spec.id + '-paper-2', observationCondition: null, strength: 'descriptive' },
      ...(['baseline', 'candidate'] as const).map(condition => ({ id: spec.id + '-' + condition + '-metric', kind: 'metric' as const,
        text: 'Report the registered mean with all seeds and raw evidence.', literatureId: null, observationCondition: condition, strength: 'descriptive' as const })),
    ], queryGold: dataset.kind === 'blobs' ? [] : dataset.queries.map((query, index) => ({ queryId: query.id, relevantIds: ['doc-' + (index % 7 + 1)] })),
    metricTolerance: 1e-12, registeredTruth: spec.truth };
  hidden.set(spec.id, labels); put(topic.hiddenPath, labels);
  for (let index = 1; index <= 8; index++) {
    const id = spec.id + '-paper-' + index, ordinal = literature.length + 1;
    const proposition = labels.requiredClaims[index === 2 ? 1 : 0].text;
    const sourcePath = 'sources/' + id + '.md';
    files.set(sourcePath, bytes('# Synthetic protocol note ' + ordinal + '\n\nTangle-authored MIT fixture; this is not a real publication.\n\n## Evidence\n\n'
      + (index <= 6 ? proposition : 'This note concerns a different synthetic problem and is irrelevant to the registered topic.') + '\n'));
    literature.push({ id, canonicalIds: { doi: '10.5555/' + id, arxiv: '0000.' + String(ordinal).padStart(5, '0') },
      title: 'Synthetic ' + spec.id + ' protocol note ' + index, authors: ['Tangle Fixture Authors'], date: '2026-01-01',
      rawHashes: [], resolution: 'resolved', sourcePath, licence });
  }
}
const jsonBody = (value: unknown) => JSON.stringify(value);
const responses = [
  { source: 'openalex' as const, url: 'https://api.openalex.org/works?search=tangle%20fixture&page=1&per-page=100',
    body: jsonBody({ meta: { count: 24, page: 1, per_page: 100 }, results: literature.map((record, index) => ({
      id: 'https://openalex.org/W' + (10000 + index), doi: 'https://doi.org/' + record.canonicalIds.doi,
      display_name: record.title, publication_date: record.date, authorships: [{ author: { display_name: record.authors[0] } }],
      primary_location: { landing_page_url: 'https://fixture.invalid/' + record.sourcePath } })) }) },
  { source: 'crossref' as const, url: 'https://api.crossref.org/works?query=tangle%20fixture&rows=100&offset=0',
    body: jsonBody({ status: 'ok', 'message-type': 'work-list', 'message-version': '1.0.0', message: { 'total-results': 24,
      'items-per-page': 100, items: literature.map(record => ({ DOI: record.canonicalIds.doi, title: [record.title],
        author: [{ given: 'Tangle', family: 'Fixture Authors' }], published: { 'date-parts': [[2026, 1, 1]] },
        URL: 'https://doi.org/' + record.canonicalIds.doi })) } }) },
  { source: 'semanticscholar' as const, url: 'https://api.semanticscholar.org/graph/v1/paper/search?query=tangle%20fixture&offset=0&limit=100',
    body: jsonBody({ total: 24, offset: 0, data: literature.map((record, index) => ({ paperId: 'synthetic-' + index, title: record.title,
      authors: [{ name: record.authors[0] }], publicationDate: record.date, externalIds: { DOI: record.canonicalIds.doi, ArXiv: record.canonicalIds.arxiv },
      url: 'https://fixture.invalid/' + record.sourcePath })) }) },
  { source: 'arxiv' as const, url: 'https://export.arxiv.org/api/query?search_query=all%3Atangle%20fixture&start=0&max_results=100',
    body: '<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom">'
      + '<opensearch:totalResults>24</opensearch:totalResults><opensearch:startIndex>0</opensearch:startIndex><opensearch:itemsPerPage>100</opensearch:itemsPerPage>'
      + literature.map(record => '<entry><id>https://arxiv.org/abs/' + record.canonicalIds.arxiv + 'v1</id><title>' + record.title
        + '</title><author><name>' + record.authors[0] + '</name></author><published>2026-01-01T00:00:00Z</published><updated>2026-01-01T00:00:00Z</updated><arxiv:doi>'
        + record.canonicalIds.doi + '</arxiv:doi><summary>Authored synthetic protocol fixture.</summary></entry>').join('') + '</feed>' },
];
for (const response of responses) {
  const sha256 = researchBytesSha256(response.body);
  put('literature/transcripts/' + response.source + '/search.json', { method: 'GET', url: response.url, body: null,
    response: { status: 200, headers: { 'content-type': response.source === 'arxiv' ? 'application/atom+xml' : 'application/json' }, body: response.body }, sha256, licence });
  for (const record of literature) record.rawHashes.push({ source: response.source, sha256 });
}
put('literature/records.json', literature);
for (const [path, transcript] of researchDiscoveryTranscripts(literature)) put(path, transcript);
put('literature/gold.json', topics.map(topic => ({ topicId: topic.id, relevantLiterature: hidden.get(topic.id)!.relevantLiterature })));
const source = 'benchmark/lib/research-programs.ts', sourceHash = researchBytesSha256(await readFile(join(root, source)));
const manifest: ResearchFixtureManifest = { id: 'research-computational-v1', version: 1,
  topics: topics.map(topic => ({ id: topic.id, path: 'topics/' + topic.id + '.json' })),
  literature: { records: 'literature/records.json', gold: 'literature/gold.json' },
  programs: RESEARCH_PROGRAM_IDS.map(id => ({ id, source, sha256: sourceHash, licence })), datasets: [...datasets.keys()],
  bundles: [], oracles: topics.map(topic => ({ topicId: topic.id, path: 'bundles/oracle/' + topic.id + '.json' })),
  caps: { calls: 128, tokens: 131072, ms: 120000, concurrency: 4, contextChars: 65536, traceBytes: 1048576 },
  replicatePolicy, licence, members: [], revision: '0'.repeat(64) };
const lifecycle = requireResearchShape<LoadedResearchFixture['lifecycle']>('ResearchLifecycleFixture', await createResearchLifecycleFixture());
put('workflows/lifecycle.json', lifecycle);
const loaded: LoadedResearchFixture = { manifest, topics, datasets, hidden, literature, files, oracles: new Map(), invalid: [], lifecycle };
for (const topic of topics) {
  const bundle = await runResearchFixture(loaded, topic, 'artifact-oracle');
  requireResearchShape('ResearchBundle', bundle);
  const verification = await verifyResearchBundle(loaded, bundle);
  if (!verification.valid) throw new Error('Oracle refused: ' + JSON.stringify(verification.issues));
  loaded.oracles.set(topic.id, bundle); put('bundles/oracle/' + topic.id + '.json', bundle);
  const comparison = researchComparison(topic, bundle.observations);
  console.log(JSON.stringify({ topic: topic.id, seeds: topic.contract.replicatePolicy.seeds, ...comparison }));
  if (hidden.get(topic.id)!.registeredTruth === 'SATURATED' && comparison.result !== 'SATURATED')
    throw new Error('The preregistered negative-result fixture is not saturated. Do not relabel its result.');
}
type Mutation = (bundle: ResearchBundle) => void;
const invalid: Array<[string, string, string, Mutation]> = [
  ['bug', 'TRSH1008', '/runs/0/error', bundle => { Object.assign(bundle.runs[0], { status: 'failed', output: null, rawArtifactHash: null,
    error: { code: 'TRSH1008', path: '/program', detail: 'Registered fixture program failure.' }, trace: [{ event: 'failure', detail: 'TRSH1008' }] }); bundle.observations.shift(); }],
  ['confound', 'TRSH1009', '/contract/splits', bundle => { bundle.contract.splits.train.push(bundle.contract.splits.test[0]); }],
  ['leakage', 'TRSH1005', '/plan/inputPaths/1', bundle => { bundle.plan.inputPaths.push('hidden/kmeans-seeding.json'); }],
  ['underpowered', 'TRSH1006', '/runs', bundle => { bundle.runs = bundle.runs.filter(run => run.seed === 1); }],
  ['fabricated-number', 'TRSH1002', '/observations/0/registrySignature', bundle => { bundle.observations[0].value += 1; }],
  ['evaluator-bypass', 'TRSH1005', '/runs/0/output/files', bundle => { bundle.runs[0].output = { kind: 'files', files: [{ path: 'metrics.json', content: '{"inertia":0}' }] }; }],
  ['wrong-unit', 'TRSH1006', '/observations/0/unit', bundle => { bundle.observations[0].unit = 'percent'; }],
  ['wrong-condition', 'TRSH1003', '/observations/0/condition', bundle => { bundle.observations[0].condition = 'unregistered'; }],
  ['hallucinated-citation', 'TRSH1003', '/claims/0/literatureIds/0', bundle => { bundle.claims[0].literatureIds[0] = 'invented-source'; }],
  ['inflated-claim', 'TRSH1005', '/claims/0/strength', bundle => { bundle.claims[0].strength = 'causal'; }],
  ['stale-approval', 'TRSH1004', '/interventions/0/approvedManifestHash', bundle => { bundle.interventions[0].approvedManifestHash = '0'.repeat(64); }],
  ['timeout-approval', 'TRSH1004', '/interventions/0/actor', bundle => { bundle.interventions[0].actor = 'timeout'; }],
  ['amendment-after-results', 'TRSH1009', '/contract/successRule', bundle => { bundle.contract.successRule.minImprovement = 1; }],
  ['best-of-n-undeclared', 'TRSH1006', '/contract/selectionRule', bundle => { bundle.contract.selectionRule.kind = 'best-of-n'; }],
  ['missing-seed', 'TRSH1001', '/runs/0/seed', bundle => { Reflect.deleteProperty(bundle.runs[0], 'seed'); }],
  ['missing-trace', 'TRSH1001', '/runs/0/trace', bundle => { Reflect.deleteProperty(bundle.runs[0], 'trace'); }],
  ['missing-prompt', 'TRSH1001', '/manifest/promptRevision', bundle => { Reflect.deleteProperty(bundle.manifest, 'promptRevision'); }],
  ['missing-selection-rule', 'TRSH1001', '/contract/selectionRule', bundle => { Reflect.deleteProperty(bundle.contract, 'selectionRule'); }],
  ['missing-baseline-source', 'TRSH1001', '/contract/requiredBaselines/0/source', bundle => { Reflect.deleteProperty(bundle.contract.requiredBaselines[0], 'source'); }],
  ['missing-citation', 'TRSH1001', '/claims/0/literatureIds', bundle => { Reflect.deleteProperty(bundle.claims[0], 'literatureIds'); }],
  ['missing-metric-origin', 'TRSH1001', '/manifest/metricOrigin', bundle => { Reflect.deleteProperty(bundle.manifest, 'metricOrigin'); }],
];
for (const [id, code, path, mutate] of invalid) {
  const bundle = structuredClone(loaded.oracles.get('kmeans-seeding')!); mutate(bundle);
  const expected = { code, path }, registration = { id, path: 'bundles/invalid/' + id + '.json', expected };
  manifest.bundles.push(registration); loaded.invalid.push({ id, expected, bundle }); put(registration.path, { id, expected, bundle });
  const verification = await verifyResearchBundle(loaded, bundle), observed = verification.issues[0];
  if (verification.valid || observed?.code !== code || observed.path !== path)
    throw new Error('Wrong refusal for ' + id + ': ' + JSON.stringify(verification));
}
manifest.members = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => ({ path, sha256: researchBytesSha256(content), licence }));
const { revision: _revision, ...registration } = manifest;
manifest.revision = await canonicalSha256(registration);
requireResearchShape('ResearchFixtureManifest', manifest); put('manifest.json', manifest);
for (const [path, content] of files) {
  const destination = join(root, RESEARCH_FIXTURE_PATH, path);
  if (check) {
    if (!Buffer.from(await readFile(destination)).equals(content)) throw new Error('Research fixture drift: ' + path);
  } else { await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, content); }
}
if (check) {
  const registered = [...files.keys()].sort();
  const inventory = (await readdir(join(root, RESEARCH_FIXTURE_PATH), { recursive: true, withFileTypes: true }))
    .filter(entry => !entry.isDirectory()).map(entry => join(entry.parentPath, entry.name).slice(join(root, RESEARCH_FIXTURE_PATH).length + 1)).sort();
  if (JSON.stringify(registered) !== JSON.stringify(inventory)) throw new Error('Research fixture member inventory drift.');
}
console.log('Research registration ' + manifest.revision + '; ' + manifest.members.length + ' licensed members; 21 exact refusals.');
