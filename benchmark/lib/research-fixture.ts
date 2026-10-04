/** Load registered fixture bytes, refusing path, licence, shape and source drift. */
import { readFile, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, posix } from 'node:path';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createMasRegistrySnapshot, createMasConfigCatalog, validateMasWorkflow, planMasWorkflow, projectMasPlan } from '@tangleai/mas';
import { requireResearchShape, researchShape } from './research-validation.ts';
import { RESEARCH_PROGRAM_IDS } from './research-programs.ts';
import type { ResearchFixtureManifest, ResearchFixtureTopic, ResearchDataset, ResearchHiddenLabels,
  ResearchBundle, LiteratureRecord, ResearchIssue, ResearchLicence, ResearchLifecycleFixture } from './research.types.ts';

export const RESEARCH_FIXTURE_PATH = 'benchmark/fixtures/research';
export const MANIFEST_PATH = RESEARCH_FIXTURE_PATH + '/manifest.json';
export function researchBytesSha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}
export interface LoadedResearchFixture {
  manifest: ResearchFixtureManifest;
  topics: ResearchFixtureTopic[];
  datasets: Map<string, ResearchDataset>;
  hidden: Map<string, ResearchHiddenLabels>;
  literature: LiteratureRecord[];
  files: Map<string, Uint8Array>;
  oracles: Map<string, ResearchBundle>;
  invalid: Array<{ id: string; expected: { code: string; path: string }; bundle: unknown }>;
  lifecycle: ResearchLifecycleFixture;
}
const parse = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
function memberPath(path: string): void {
  if (!path || path.includes('\\') || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')
    || posix.normalize(path) !== path) throw new Error('Invalid research member path: ' + path);
}
export async function loadResearchFixture(root = process.cwd()): Promise<LoadedResearchFixture> {
  const directory = join(root, RESEARCH_FIXTURE_PATH);
  const manifest = requireResearchShape<ResearchFixtureManifest>('ResearchFixtureManifest',
    JSON.parse(await readFile(join(root, MANIFEST_PATH), 'utf8')));
  const { revision, ...registration } = manifest;
  if (revision !== await canonicalSha256(registration)) throw new Error('Research manifest revision drift.');
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  if (entries.some(entry => entry.isSymbolicLink())) throw new Error('Research fixtures cannot redirect through symbolic links.');
  const files = new Map<string, Uint8Array>();
  for (const member of manifest.members) {
    memberPath(member.path);
    if (files.has(member.path)) throw new Error('Duplicate research member: ' + member.path);
    const path = join(directory, member.path);
    if (!(await lstat(path)).isFile()) throw new Error('Research member is not a regular file: ' + member.path);
    const bytes = await readFile(path);
    if (researchBytesSha256(bytes) !== member.sha256) throw new Error('Research member byte drift: ' + member.path);
    files.set(member.path, bytes);
  }
  const inventory = entries
    .filter(entry => !entry.isDirectory()).map(entry => posix.join(entry.parentPath.slice(directory.length + 1).replaceAll('\\', '/'), entry.name))
    .filter(path => path !== 'manifest.json').sort();
  if (JSON.stringify(inventory) !== JSON.stringify([...files.keys()].sort())) throw new Error('Research fixture contains unregistered or missing members.');
  const checkLicence = (licence: ResearchLicence) => {
    if (licence.source !== 'LICENSE.md' || !files.has(licence.source)) throw new Error('Research licence does not resolve to the registered MIT grant.');
  };
  checkLicence(manifest.licence);
  for (const member of manifest.members) checkLicence(member.licence);
  const json = (path: string): unknown => {
    const bytes = files.get(path);
    if (!bytes) throw new Error('Unregistered research input: ' + path);
    return parse(bytes);
  };
  const topics = manifest.topics.map(entry => {
    const topic = requireResearchShape<ResearchFixtureTopic>('ResearchFixtureTopic', json(entry.path));
    if (topic.id !== entry.id) throw new Error('Research topic identity mismatch.');
    return topic;
  });
  if (new Set(topics.map(topic => topic.id)).size !== topics.length) throw new Error('Duplicate research topic.');
  if (JSON.stringify(manifest.programs.map(program => program.id)) !== JSON.stringify(RESEARCH_PROGRAM_IDS)) throw new Error('Research program registration drift.');
  for (const program of manifest.programs) {
    checkLicence(program.licence);
    memberPath(program.source);
    if (researchBytesSha256(await readFile(join(root, program.source))) !== program.sha256) throw new Error('Research program source drift: ' + program.id);
  }
  const datasets = new Map(manifest.datasets.map(path => {
    const value = json(path), issues = researchDatasetIssues(value);
    if (issues.length) throw new Error('Research dataset refused: ' + JSON.stringify(issues));
    return [path, value as ResearchDataset];
  }));
  const hidden = new Map(topics.map(topic => [topic.id, requireResearchShape<ResearchHiddenLabels>('ResearchHiddenLabels', json(topic.hiddenPath))]));
  const literatureValue = json(manifest.literature.records);
  if (!Array.isArray(literatureValue) || literatureValue.length < 24) throw new Error('Research literature snapshot needs at least 24 records.');
  const literature = literatureValue.map(value => requireResearchShape<LiteratureRecord>('LiteratureRecord', value));
  if (new Set(literature.map(record => record.id)).size !== literature.length) throw new Error('Duplicate literature identity.');
  for (const record of literature) if (!files.has(record.sourcePath)) throw new Error('Unregistered literature source: ' + record.id);
  for (const record of literature) checkLicence(record.licence);
  const gold = json(manifest.literature.gold);
  if (!Array.isArray(gold) || JSON.stringify(gold) !== JSON.stringify(topics.map(topic =>
    ({ topicId: topic.id, relevantLiterature: hidden.get(topic.id)!.relevantLiterature })))) throw new Error('Research gold projection drift.');
  for (const topic of topics) {
    checkLicence(topic.licence);
    for (const baseline of topic.contract.requiredBaselines) checkLicence(baseline.licence);
    const { contractHash, ...contractBody } = topic.contract, { planHash, ...planBody } = topic.plan;
    if (contractHash !== await canonicalSha256(contractBody)) throw new Error('Research contract hash drift: ' + topic.id);
    if (planHash !== await canonicalSha256(planBody) || topic.plan.contractHash !== contractHash
      || topic.plan.projectId !== topic.contract.projectId || topic.plan.hypothesisHash !== await canonicalSha256(topic.contract.hypothesisSpace))
      throw new Error('Research plan hash or project binding drift: ' + topic.id);
    if (!datasets.has(topic.datasetPath)) throw new Error('Missing topic dataset: ' + topic.id);
    const dataset = datasets.get(topic.datasetPath)!;
    if (topic.contract.datasets.length !== 1 || topic.contract.datasets[0].id !== dataset.id
      || topic.contract.datasets[0].sha256 !== researchBytesSha256(files.get(topic.datasetPath)!)
      || JSON.stringify(topic.plan.inputPaths) !== JSON.stringify([topic.datasetPath])
      || topic.plan.conditions.some(condition => condition.datasetId !== dataset.id || !manifest.programs.some(program => program.id === condition.programId)))
      throw new Error('Research dataset or feature allow-list binding drift: ' + topic.id);
    if (topic.contract.replicatePolicy.seeds.length < topic.contract.replicatePolicy.minimum
      || topic.contract.splits.train.some(id => topic.contract.splits.test.includes(id)))
      throw new Error('Research registration has insufficient replicates or confounded splits: ' + topic.id);
    for (const baseline of topic.contract.requiredBaselines) if (!topic.plan.conditions.some(condition => condition.id === baseline.condition
      && condition.programId === baseline.programId) || !manifest.programs.some(program => program.id === baseline.programId && program.source === baseline.source))
      throw new Error('Research baseline source is not registered: ' + topic.id);
    if (hidden.get(topic.id)!.topicId !== topic.id) throw new Error('Hidden label identity mismatch.');
    if (hidden.get(topic.id)!.relevantLiterature.filter(id => !literature.some(record => record.id === id)).length !== 2)
      throw new Error('Each topic registers exactly two absent relevant sources.');
  }
  const oracles = new Map(manifest.oracles.map(entry => [entry.topicId, requireResearchShape<ResearchBundle>('ResearchBundle', json(entry.path))]));
  if (oracles.size !== topics.length || topics.some(topic => !oracles.has(topic.id))) throw new Error('Research oracle census drift.');
  const invalid = manifest.bundles.map(entry => {
    const value = json(entry.path) as { id?: unknown; expected?: unknown; bundle?: unknown };
    if (!value || value.id !== entry.id || JSON.stringify(value.expected) !== JSON.stringify(entry.expected)
      || !Object.hasOwn(value, 'bundle') || Object.keys(value).some(key => !['id', 'expected', 'bundle'].includes(key)))
      throw new Error('Invalid-bundle registration drift: ' + entry.id);
    return { id: entry.id, expected: entry.expected, bundle: value.bundle };
  });
  if (new Set(invalid.map(bundle => bundle.id)).size !== invalid.length) throw new Error('Duplicate invalid-bundle identity.');
  const lifecycle = requireResearchShape<ResearchLifecycleFixture>('ResearchLifecycleFixture', json('workflows/lifecycle.json'));
  const registry = await createMasRegistrySnapshot(lifecycle.registry), { revision: catalogRevision, ...catalogBody } = lifecycle.catalog;
  const catalog = await createMasConfigCatalog(catalogBody);
  if (!registry.valid || !catalog.valid || catalog.value.revision !== catalogRevision) throw Error('Research lifecycle registry/catalog drift.');
  const validated = await validateMasWorkflow(lifecycle.workflow, registry.value, catalog.value);
  if (!validated.valid) throw Error('Research lifecycle validation refused: ' + JSON.stringify(validated.issues));
  const planned = await planMasWorkflow(validated.value);
  if (!planned.valid || planned.value.executableRevision !== lifecycle.executableRevision
    || await canonicalSha256(projectMasPlan(planned.value)) !== await canonicalSha256(JSON.parse(lifecycle.projectionJson)))
    throw Error('Research lifecycle executable/projection drift.');
  return { manifest, topics, datasets, hidden, literature, files, oracles, invalid, lifecycle };
}
export function researchDatasetIssues(value: unknown): ResearchIssue[] {
  const issues = researchShape('ResearchDataset', value);
  if (issues.length) return issues;
  const dataset = value as ResearchDataset;
  const ids = dataset.kind === 'blobs' ? dataset.points.map(point => point.id) : [...dataset.documents, ...dataset.queries].map(row => row.id);
  return new Set(ids).size === ids.length ? [] : [{ code: 'TRSH1001', path: '/dataset', detail: 'Duplicate dataset id.' }];
}
