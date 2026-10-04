/** The keyless floor executes registered programs; only the explicit oracle sees the claim rubric. */
import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { mean } from '@jarenjs/core/stats';
import { executeResearchProgram, researchProgramInput } from './research-programs.ts';
import { evaluateResearchRun, researchExecutionHash, researchMechanicalDecision } from './research-evaluator.ts';
import { researchBytesSha256, type LoadedResearchFixture } from './research-fixture.ts';
import { metricClaimText, researchDisclosures, researchReviewedEvidenceHash } from './research-oracle.ts';
import type { ResearchBundle, ResearchFixtureTopic, ResearchDataset, ExperimentRun, MetricObservation, ResearchClaim, EvidenceCard } from './research.types.ts';

export async function runResearchFixture(loaded: LoadedResearchFixture, topic: ResearchFixtureTopic,
  mode: 'artifact-oracle' | 'no-model-runner'): Promise<ResearchBundle> {
  const runs = await executeResearchFixturePrograms(topic, loaded.datasets.get(topic.datasetPath)!);
  const observations = await evaluateResearchFixturePrograms(loaded, topic, runs);
  return assembleResearchFixtureBundle(loaded, topic, mode, runs, observations);
}
/** Feature-only execution, called by the native EXECUTE stage and the structural oracle. */
export async function executeResearchFixturePrograms(topic: ResearchFixtureTopic, dataset: ResearchDataset): Promise<ExperimentRun[]> {
  const inputHash = await canonicalSha256(researchProgramInput(dataset));
  const runs: ExperimentRun[] = [];
  for (const condition of topic.plan.conditions) for (const seed of topic.contract.replicatePolicy.seeds) {
    const executed = await executeResearchProgram(condition.programId, dataset, seed, condition.params);
    const output = executed.ok ? executed.output : null;
    const rawArtifactHash = output ? await canonicalSha256(output) : null;
    const run: ExperimentRun = { id: topic.id + '-' + condition.id + '-seed-' + seed,
      projectId: topic.contract.projectId, condition: condition.id, programId: condition.programId, seed,
      status: executed.ok ? 'ok' : 'failed', inputHash,
      executionManifestHash: await researchExecutionHash(topic, condition.id, seed, inputHash), rawArtifactHash, output,
      trace: [{ event: 'start', detail: condition.programId }, executed.ok
        ? { event: 'output', detail: rawArtifactHash! } : { event: 'failure', detail: executed.issue.code }],
      spend: { calls: 0, tokens: 0, ms: 0, physical: 0 }, error: executed.ok ? null : executed.issue };
    runs.push(run);
  }
  return runs;
}
/** Hidden scoring labels remain inside the independent evaluator, after execution. */
export async function evaluateResearchFixturePrograms(loaded: LoadedResearchFixture, topic: ResearchFixtureTopic, runs: ExperimentRun[],
  dataset: ResearchDataset = loaded.datasets.get(topic.datasetPath)!): Promise<MetricObservation[]> {
  const observations: MetricObservation[] = [];
  for (const run of runs) {
    const evaluated = await evaluateResearchRun(topic, dataset, loaded.hidden.get(topic.id)!, run);
    if (!evaluated.valid) throw new Error('Fixture execution refused: ' + JSON.stringify(evaluated.issues));
    observations.push(evaluated.observation);
  }
  return observations;
}
/** Project the retained program evidence without running a program or changing its decision. */
export async function assembleResearchFixtureBundle(loaded: LoadedResearchFixture, topic: ResearchFixtureTopic,
  mode: 'artifact-oracle' | 'no-model-runner', runs: ExperimentRun[], observations: MetricObservation[]): Promise<ResearchBundle> {
  const hidden = loaded.hidden.get(topic.id)!;
  const evidence: EvidenceCard[] = [], claims: ResearchClaim[] = [];
  const promptRevision = researchBytesSha256(loaded.files.get('prompts/fixture-writer.json')!);
  if (mode === 'artifact-oracle') for (const expected of hidden.requiredClaims.filter(claim => claim.kind !== 'metric')) {
    const record = loaded.literature.find(record => record.id === expected.literatureId)!;
    const contentHash = researchBytesSha256(loaded.files.get(record.sourcePath)!);
    const card: EvidenceCard = { id: expected.id + '-evidence', literatureId: record.id, artifactId: 'art-' + contentHash,
      excerpt: expected.text, contentHash, versionId: await canonicalSha256({ contentHash, extractor: 'fixture-passages-v1' }),
      locator: { headingPath: ['Evidence'], elementOrder: 1 }, fields: [expected.kind], extractionPromptRevision: promptRevision };
    evidence.push(card);
    claims.push({ id: expected.id, section: expected.kind === 'literature' ? 'methods' : 'conclusion', kind: expected.kind,
      text: expected.text, literatureIds: [record.id], evidenceIds: [card.id], observationIds: [],
      strength: 'descriptive', metricBinding: null });
  }
  // These ids and statements come from the public plan and evaluator, not the hidden claim rubric.
  for (const condition of topic.plan.conditions) {
    const selected = observations.filter(observation => observation.condition === condition.id);
    const metric = topic.contract.metrics.find(metric => metric.id === topic.contract.successRule.metric)!;
    const value = mean(selected.map(observation => observation.value))!;
    claims.push({ id: topic.id + '-' + condition.id + '-metric', section: 'results', kind: 'metric',
      text: metricClaimText(condition.id, metric.id, value, metric.unit), literatureIds: [],
      evidenceIds: selected.map(observation => observation.id + '-evidence'), observationIds: selected.map(observation => observation.id),
      strength: 'descriptive', metricBinding: { condition: condition.id, metric: metric.id, unit: metric.unit,
        seeds: [...topic.contract.replicatePolicy.seeds], aggregate: 'mean', value } });
  }
  const artifacts = [
    ...evidence.map(card => ({ id: card.artifactId, kind: 'document', digest: card.contentHash })),
    ...runs.map(run => ({ id: 'art-' + run.rawArtifactHash, kind: 'experiment-output', digest: run.rawArtifactHash! })),
  ].filter((artifact, index, values) => values.findIndex(value => value.id === artifact.id) === index);
  const ledgerEvidence = [
    ...evidence.map(card => ({ id: card.id, artifact: card.artifactId, selector: '/Evidence/1', quote: card.excerpt })),
    ...observations.map(observation => ({ id: observation.id + '-evidence', artifact: 'art-' + observation.runArtifactHash,
      selector: '/', quote: canonicalizeJson(runs.find(run => run.id === observation.experimentRunId)!.output) })),
  ];
  const literature = loaded.literature.filter(record => mode === 'artifact-oracle'
    ? hidden.relevantLiterature.includes(record.id) : record.id.startsWith(topic.id + '-paper-')).map(record => record.id);
  const claimLedger: ResearchBundle['claimLedger'] = { version: 1, artifacts, evidence: ledgerEvidence,
    claims: claims.map(claim => ({ id: claim.id, text: claim.text, critical: true, status: 'supported', evidence: [...claim.evidenceIds] })),
    visibleEvidence: ledgerEvidence.map(item => item.id) };
  const manifestBody = { projectId: topic.contract.projectId, contractHash: topic.contract.contractHash, planHash: topic.plan.planHash,
    promptRevision, reviewedEvidenceHash: await researchReviewedEvidenceHash(loaded, { literature, evidence, claims, claimLedger }), runIdentityId: null,
    environment: { executor: 'fixture-pure-functions', version: '1', programSourceHash: loaded.manifest.programs[0].sha256 },
    inputs: topic.plan.inputPaths.map(path => ({ path, sha256: researchBytesSha256(loaded.files.get(path)!) })),
    runIds: runs.map(run => run.id), observationIds: observations.map(observation => observation.id),
    selectionRule: structuredClone(topic.contract.selectionRule), baselineSources: topic.contract.requiredBaselines.map(baseline => baseline.source),
    metricOrigin: { evaluatorId: topic.plan.evaluator.id, evaluatorVersion: topic.plan.evaluator.version },
    searchedLiterature: loaded.literature.map(record => record.id), frozenBeforeResults: true };
  const manifest = { ...manifestBody, manifestHash: await canonicalSha256(manifestBody) };
  const bundle: ResearchBundle = { topicId: topic.id, contract: structuredClone(topic.contract), plan: structuredClone(topic.plan),
    runs, observations, decision: researchMechanicalDecision(topic, observations),
    literature, evidence, claims, claimLedger, manifest,
    interventions: mode === 'artifact-oracle' ? (['literature', 'design', 'quality'] as const).map(gate => ({
      id: topic.id + '-' + gate + '-approval', gate, actor: 'scripted', action: 'approve', reviewedManifestHash: manifest.manifestHash,
      approvedManifestHash: manifest.manifestHash, substantive: false })) : [], amendments: [], disclosure: [] };
  bundle.disclosure = researchDisclosures(bundle);
  return bundle;
}
