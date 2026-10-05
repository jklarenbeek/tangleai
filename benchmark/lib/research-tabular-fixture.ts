/** Pinned authored CSVs and hypotheses share the research fixture's strict byte inventory. */
import { readFile, readdir } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { mulberry32, randomInt } from '@jarenjs/core/random';
import { stringifyCsv } from '@jarenjs/josl';
import { equalsJson } from '@jarenjs/core/object';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { runIdentitySchema } from '@tangleai/config';
import { researchSchema, researchSchemaReferences, researchValue, validateResearchShape, parseTabularSamples,
  TABULAR_EVALUATOR, TABULAR_PROGRAM_IDS, TABULAR_RUBRIC, TABULAR_UNITS, validateTabularPlan,
  type ResearchContract, type ExperimentPlan, type TabularSample } from '@tangleai/research';
import { createReportValidator } from './validate.ts';
import { RESEARCH_DOMAINS_SCHEMA } from './research-domains-schema.ts';
import { RESEARCH_LESSONS_SCHEMA } from './research-lessons-schema.ts';
import { researchBytesSha256, RESEARCH_FIXTURE_PATH } from './research-fixture.ts';
import type { TabularFixtureManifest, TabularResearchTopic } from './research-domains.types.ts';

export const TABULAR_FIXTURE_PATH = 'domains/tabular-statistics';
const programSource = 'packages/research/src/domains/tabular-statistics.ts';
const licence = { spdx: 'MIT', provenance: 'tangle-authored-synthetic', source: 'LICENSE.md' } as const;
const encoded = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n');
const validators = new Map<string, ReturnType<typeof createReportValidator>>();
export function tabularFixtureShape<T>(name: 'TabularFixtureManifest' | 'TabularResearchTopic', value: unknown): T {
  let validate = validators.get(name);
  if (!validate) {
    validate = createReportValidator({ $ref: RESEARCH_DOMAINS_SCHEMA.$id + '#/$defs/' + name },
      [RESEARCH_DOMAINS_SCHEMA, RESEARCH_LESSONS_SCHEMA, runIdentitySchema, researchSchema, ...researchSchemaReferences]); validators.set(name, validate);
  }
  const result = validate(value); if (!result.valid) throw Error('Tabular fixture refused: ' + JSON.stringify(result.errors));
  return value as T;
}

export async function tabularStatisticsFixtureFiles(root = process.cwd()): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>(), random = mulberry32(17753);
  const specs = [{ id: 'positive', effect: 4 }, { id: 'null', effect: 0 }, { id: 'negative', effect: -3 }];
  const rowsById = new Map<string, TabularSample[]>();
  for (const spec of specs) {
    const rows: TabularSample[] = [];
    for (let i = 0; i < 24; i++) {
      const pairId = 'pair-' + String(i + 1).padStart(2, '0'), base = randomInt(random, 20, 80);
      const noise = randomInt(random, -2, 3), effect = spec.effect === 0 ? 0 : spec.effect + noise;
      rows.push({ id: pairId + '-a', pairId, group: 'A', value: base + effect, unit: 'points' },
        { id: pairId + '-b', pairId, group: 'B', value: base, unit: 'points' });
    }
    const csv = stringifyCsv(rows, { fields: ['id', 'pairId', 'group', 'value', 'unit'], newline: '\n' });
    researchValue(parseTabularSamples(csv));
    rowsById.set(spec.id, rows); files.set('datasets/' + spec.id + '.csv', new TextEncoder().encode(csv));
  }
  const topics: Array<{ id: string; path: string }> = [];
  for (const spec of [{ id: 'positive-effect', dataset: 'positive', delta: 1 }, { id: 'null-effect', dataset: 'null', delta: 0 },
    { id: 'negative-effect', dataset: 'negative', delta: 0 }, { id: 'threshold-failure', dataset: 'positive', delta: 8 }]) {
    const id = 'tabular-' + spec.id, projectId = id + '-project', datasetId = 'tabular-' + spec.dataset;
    const datasetPath = TABULAR_FIXTURE_PATH + '/datasets/' + spec.dataset + '.csv';
    const hypothesis = { H1: 'mean(A) - mean(B) > ' + spec.delta + ' points', H0: 'mean(A) - mean(B) <= ' + spec.delta + ' points', delta: spec.delta };
    const body: Omit<ResearchContract, 'contractHash'> = { id: id + '-contract', projectId, hypothesisSpace: [hypothesis.H1, hypothesis.H0],
      successRule: { metric: 'meanDifference', baseline: 'baseline', condition: 'candidate', minImprovement: spec.delta, confidenceLevel: 0.95 },
      failureRule: 'stop-on-invalid', metrics: [{ id: 'meanDifference', unit: 'points', direction: 'maximize' }],
      datasets: [{ id: datasetId, sha256: researchBytesSha256(files.get('datasets/' + spec.dataset + '.csv')!) }],
      splits: { train: [], test: rowsById.get(spec.dataset)!.map(row => row.id) },
      requiredBaselines: [{ condition: 'baseline', programId: TABULAR_PROGRAM_IDS.null, source: programSource, licence }],
      replicatePolicy: { seeds: [1, 2, 3], minimum: 3, resamples: 2000, bootstrapSeed: 17753 },
      attemptCap: 1, pivotCap: 1, reviewCap: 1, selectionRule: { kind: 'all', n: 3, metric: 'meanDifference' },
      stopConditions: ['invalid evidence', 'registered attempt cap', 'retain every negative result', 'paired sample interval does not clear delta'] };
    const contract = researchValue(validateResearchShape<ResearchContract>('ResearchContract', { ...body, contractHash: await canonicalSha256(body) }));
    const planBody: Omit<ExperimentPlan, 'planHash'> = { id: id + '-plan', projectId, contractHash: contract.contractHash,
      hypothesisHash: await canonicalSha256(contract.hypothesisSpace), conditions: [
        { id: 'baseline', programId: TABULAR_PROGRAM_IDS.null, datasetId, params: { delta: spec.delta } },
        { id: 'candidate', programId: TABULAR_PROGRAM_IDS.observed, datasetId, params: { delta: spec.delta } }],
      inputPaths: [datasetPath], evaluator: TABULAR_EVALUATOR };
    const plan = researchValue(validateResearchShape<ExperimentPlan>('ExperimentPlan', { ...planBody, planHash: await canonicalSha256(planBody) }));
    const topic = tabularFixtureShape<TabularResearchTopic>('TabularResearchTopic', { id, title: spec.id.replaceAll('-', ' '),
      taskFamily: 'group-difference', datasetPath, hypothesis, contract, plan, licence });
    files.set('topics/' + spec.id + '.json', encoded(topic)); topics.push({ id, path: 'topics/' + spec.id + '.json' });
  }
  files.set('rubric.json', encoded(TABULAR_RUBRIC)); files.set('units.json', encoded(TABULAR_UNITS));
  const body: Omit<TabularFixtureManifest, 'revision'> = { document: 'tabular-statistics-fixture', seed: 17753, licence,
    datasets: specs.map(row => ({ id: 'tabular-' + row.id, path: 'datasets/' + row.id + '.csv' })), topics,
    members: [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => ({ path, sha256: researchBytesSha256(bytes) })),
    program: { source: programSource, sha256: researchBytesSha256(await readFile(join(root, programSource))) } };
  files.set('manifest.json', encoded(tabularFixtureShape('TabularFixtureManifest', { ...body, revision: await canonicalSha256(body) })));
  return new Map([...files].map(([path, bytes]) => [TABULAR_FIXTURE_PATH + '/' + path, bytes]));
}

export async function loadTabularStatisticsFixture(root = process.cwd()) {
  const directory = join(root, RESEARCH_FIXTURE_PATH, TABULAR_FIXTURE_PATH);
  const manifest = tabularFixtureShape<TabularFixtureManifest>('TabularFixtureManifest', JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')));
  const { revision, ...body } = manifest;
  if (revision !== await canonicalSha256(body) || !equalsJson(manifest.licence, licence)) throw Error('Tabular manifest identity or licence drift.');
  if (manifest.program.source !== programSource || manifest.program.sha256 !== researchBytesSha256(await readFile(join(root, programSource))))
    throw Error('Tabular program source drift.');
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  if (entries.some(row => row.isSymbolicLink() || !row.isDirectory() && !row.isFile())) throw Error('Tabular fixtures need regular files and directories.');
  const paths = entries.filter(row => row.isFile()).map(row => posix.join(row.parentPath.slice(directory.length + 1), row.name)).sort();
  if (!equalsJson(paths, ['manifest.json', ...manifest.members.map(row => row.path)].sort())) throw Error('Tabular fixture member census drift.');
  const files = new Map<string, Uint8Array>();
  for (const row of manifest.members) {
    const bytes = await readFile(join(directory, row.path));
    if (files.has(row.path) || researchBytesSha256(bytes) !== row.sha256) throw Error('Tabular member byte drift: ' + row.path);
    files.set(row.path, bytes);
  }
  const json = (path: string) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files.get(path)!));
  if (!equalsJson(json('rubric.json'), TABULAR_RUBRIC) || !equalsJson(json('units.json'), TABULAR_UNITS)) throw Error('Tabular unit or rubric drift.');
  const datasets = Object.fromEntries(manifest.datasets.map(row => {
    const bytes = files.get(row.path); if (!bytes) throw Error('Unregistered tabular dataset.');
    const csv = new TextDecoder('utf-8', { fatal: true }).decode(bytes); researchValue(parseTabularSamples(csv)); return [row.id, csv];
  }));
  const topics = manifest.topics.map(row => {
    const topic = tabularFixtureShape<TabularResearchTopic>('TabularResearchTopic', json(row.path));
    const { contractHash, ...contract } = topic.contract, { planHash, ...plan } = topic.plan;
    return { row, topic, contractHash, contract, planHash, plan };
  });
  for (const { row, topic, contractHash, contract, planHash, plan } of topics) {
    const dataset = manifest.datasets.find(value => value.id === contract.datasets[0].id);
    if (row.id !== topic.id || !dataset || topic.datasetPath !== TABULAR_FIXTURE_PATH + '/' + dataset.path
      || !equalsJson(plan.inputPaths, [topic.datasetPath]) || contract.datasets[0].sha256 !== researchBytesSha256(files.get(dataset.path)!)
      || contractHash !== await canonicalSha256(contract) || planHash !== await canonicalSha256(plan) || plan.contractHash !== contractHash
      || plan.hypothesisHash !== await canonicalSha256(contract.hypothesisSpace) || topic.hypothesis.delta !== contract.successRule.minImprovement
      || !equalsJson(contract.hypothesisSpace, [topic.hypothesis.H1, topic.hypothesis.H0]) || plan.projectId !== contract.projectId
      || !equalsJson(topic.licence, licence) || validateTabularPlan(topic.contract, topic.plan).length)
      throw Error('Tabular preregistration does not reproduce: ' + row.id);
  }
  if (new Set(manifest.datasets.map(row => row.id)).size !== 3 || new Set(topics.map(row => row.topic.id)).size !== 4)
    throw Error('Tabular fixture repeats dataset or topic identities.');
  return { manifest, files: new Map([...files].map(([path, bytes]) => [TABULAR_FIXTURE_PATH + '/' + path, bytes])),
    datasets, topics: topics.map(row => row.topic) };
}
