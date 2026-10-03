/** Independent bundle checks bind frozen registration, execution, evidence and metric origin. */
import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { compileJSONPointer, JSONPOINTER_NOTHING } from '@jarenjs/json/pointer';
import { mean } from '@jarenjs/core/stats';
import { validateClaimEvidence } from '@tangleai/context';
import { researchShape } from './research-validation.ts';
import { researchBytesSha256, type LoadedResearchFixture } from './research-fixture.ts';
import { executeResearchProgram } from './research-programs.ts';
import { evaluateResearchRun, researchMechanicalDecision, researchObservationSignature } from './research-evaluator.ts';
import { RESEARCH_DISCLOSURES } from './research-schema.ts';
import type { ResearchBundle, ResearchFixtureTopic, ResearchIssue, ResearchScore, DisclosureChecklist } from './research.types.ts';

const same = (left: unknown, right: unknown): boolean => canonicalizeJson(left) === canonicalizeJson(right);
export const researchScore = (passed: number, total: number): ResearchScore => ({ passed, total, value: passed / total });
export function researchCeilings(loaded: LoadedResearchFixture, topic: ResearchFixtureTopic) {
  const gold = loaded.hidden.get(topic.id)!.relevantLiterature;
  return { topicId: topic.id, literatureRecall: researchScore(gold.filter(id => loaded.literature.some(record => record.id === id)).length, gold.length),
    literaturePrecision: researchScore(1, 1), citationIdentity: researchScore(1, 1), registryAccuracy: researchScore(1, 1) };
}
export interface ResearchVerification {
  valid: boolean;
  issues: ResearchIssue[];
  supported: string[];
  unresolved: string[];
  rerun: { passed: number; total: number };
}
export async function researchReviewedEvidenceHash(loaded: LoadedResearchFixture,
  bundle: Pick<ResearchBundle, 'literature' | 'evidence' | 'claims' | 'claimLedger'>): Promise<string> {
  return canonicalSha256({ literature: bundle.literature.map(id => loaded.literature.find(record => record.id === id) ?? null),
    evidence: bundle.evidence, claims: bundle.claims, claimLedger: bundle.claimLedger });
}
export async function verifyResearchBundle(loaded: LoadedResearchFixture, value: unknown): Promise<ResearchVerification> {
  const issues = researchShape('ResearchBundle', value);
  const result: ResearchVerification = { valid: false, issues, supported: [], unresolved: [], rerun: { passed: 0, total: 0 } };
  const fail = (code: string, path: string, detail: string): ResearchVerification => {
    issues.push({ code, path, detail }); return result;
  };
  if (issues.length) return result;
  const bundle = value as ResearchBundle;
  const topic = loaded.topics.find(topic => topic.id === bundle.topicId);
  if (!topic) return fail('TRSH1003', '/topicId', 'Topic is outside the registration.');
  const hidden = loaded.hidden.get(topic.id)!, dataset = loaded.datasets.get(topic.datasetPath)!;
  if (bundle.contract.splits.train.some(id => bundle.contract.splits.test.includes(id)))
    return fail('TRSH1009', '/contract/splits', 'Training and evaluation ids overlap.');
  const hiddenInput = bundle.plan.inputPaths.findIndex(path => path.startsWith('hidden/') || !topic.plan.inputPaths.includes(path));
  if (hiddenInput >= 0) return fail('TRSH1005', '/plan/inputPaths/' + hiddenInput, 'Program input is outside the frozen feature allow-list.');
  if (!same(bundle.contract.selectionRule, topic.contract.selectionRule) || !same(bundle.manifest.selectionRule, topic.contract.selectionRule))
    return fail('TRSH1006', '/contract/selectionRule', 'Best-of-N and its selector must be declared before execution.');
  if (!same(bundle.contract.successRule, topic.contract.successRule) && bundle.amendments.length === 0)
    return fail('TRSH1009', '/contract/successRule', 'A post-result threshold change requires an amendment and exploratory lineage.');
  for (const condition of topic.plan.conditions) {
    const seeds = bundle.runs.filter(run => run.condition === condition.id).map(run => run.seed);
    if (!same(seeds, topic.contract.replicatePolicy.seeds) || seeds.length < topic.contract.replicatePolicy.minimum)
      return fail('TRSH1006', '/runs', 'Every condition must retain every registered seed in order.');
  }
  for (const [index, intervention] of bundle.interventions.entries()) {
    if (intervention.actor === 'timeout') return fail('TRSH1004', '/interventions/' + index + '/actor', 'A timeout can never approve a gate.');
    if (intervention.action === 'approve' && intervention.approvedManifestHash !== intervention.reviewedManifestHash)
      return fail('TRSH1004', '/interventions/' + index + '/approvedManifestHash', 'Approval identifies a different reviewed artifact set.');
    if (intervention.reviewedManifestHash !== bundle.manifest.manifestHash)
      return fail('TRSH1004', '/interventions/' + index + '/reviewedManifestHash', 'Gate is stale for the actual manifest.');
  }
  if (!same(bundle.contract, topic.contract)) return fail('TRSH1009', '/contract', 'Contract differs from the frozen fixture registration.');
  if (!same(bundle.plan, topic.plan)) return fail('TRSH1009', '/plan', 'Plan differs from the frozen fixture registration.');
  for (const [index, run] of bundle.runs.entries()) {
    if (run.status === 'failed') return fail('TRSH1008', '/runs/' + index + '/error', run.error?.detail ?? 'Experiment failed without an observation.');
    if (run.output?.kind === 'files') return fail('TRSH1005', '/runs/' + index + '/output/files', 'Program metric files have no registry authority.');
    if (run.trace.length !== 2 || run.trace[0].event !== 'start' || run.trace[0].detail !== run.programId
      || run.trace[1].event !== 'output' || run.trace[1].detail !== run.rawArtifactHash || run.error !== null)
      return fail('TRSH1002', '/runs/' + index + '/trace', 'Successful execution must retain its exact program and raw-output trace.');
    if (Object.values(run.spend).some(value => value !== 0))
      return fail('TRSH1007', '/runs/' + index + '/spend', 'Pure fixture programs cannot spend provider requests, tokens or provider time.');
  }
  const metric = topic.contract.metrics.find(metric => metric.id === topic.contract.successRule.metric)!;
  for (const [index, observation] of bundle.observations.entries()) {
    const path = '/observations/' + index;
    if (!topic.plan.conditions.some(condition => condition.id === observation.condition))
      return fail('TRSH1003', path + '/condition', 'Observation names an unregistered condition.');
    if (observation.unit !== metric.unit || observation.metric !== metric.id)
      return fail('TRSH1006', path + '/unit', 'Observation changes the registered metric or unit.');
    if (observation.registrySignature !== await researchObservationSignature(observation))
      return fail('TRSH1002', path + '/registrySignature', 'Metric provenance digest does not recompute.');
  }
  if (!same(bundle.manifest.runIds, bundle.runs.map(run => run.id)) || new Set(bundle.manifest.runIds).size !== bundle.runs.length)
    return fail('TRSH1002', '/manifest/runIds', 'Run inventory does not reconcile.');
  if (!same(bundle.manifest.observationIds, bundle.observations.map(observation => observation.id))
    || bundle.observations.length !== bundle.runs.length || new Set(bundle.manifest.observationIds).size !== bundle.observations.length)
    return fail('TRSH1002', '/manifest/observationIds', 'Observation inventory does not reconcile.');
  const { manifestHash, ...manifestBody } = bundle.manifest;
  if (manifestHash !== await canonicalSha256(manifestBody)) return fail('TRSH1002', '/manifest/manifestHash', 'Manifest digest does not recompute.');
  if (bundle.manifest.projectId !== topic.contract.projectId)
    return fail('TRSH1003', '/manifest/projectId', 'Manifest belongs to another project.');
  if (bundle.manifest.runIdentityId !== null)
    return fail('TRSH1007', '/manifest/runIdentityId', 'A keyless fixture cannot invent a provider-stack identity.');
  if (bundle.manifest.contractHash !== topic.contract.contractHash || bundle.manifest.planHash !== topic.plan.planHash
    || !bundle.manifest.frozenBeforeResults) return fail('TRSH1009', '/manifest', 'Execution did not pin the preregistration.');
  if (!same(bundle.manifest.inputs, topic.plan.inputPaths.map(path => ({ path, sha256: researchBytesSha256(loaded.files.get(path)!) }))))
    return fail('TRSH1002', '/manifest/inputs', 'Input hashes do not identify the registered raw bytes.');
  if (!same(bundle.manifest.baselineSources, topic.contract.requiredBaselines.map(baseline => baseline.source)))
    return fail('TRSH1002', '/manifest/baselineSources', 'Baseline provenance differs from the registration.');
  if (!same(bundle.manifest.metricOrigin, { evaluatorId: topic.plan.evaluator.id, evaluatorVersion: topic.plan.evaluator.version }))
    return fail('TRSH1007', '/manifest/metricOrigin', 'Metric registry owner differs from the frozen evaluator.');
  const prompt = loaded.files.get('prompts/fixture-writer.json');
  if (!prompt || bundle.manifest.promptRevision !== researchBytesSha256(prompt))
    return fail('TRSH1002', '/manifest/promptRevision', 'Prompt revision does not identify the registered template.');
  if (bundle.manifest.environment.executor !== 'fixture-pure-functions' || bundle.manifest.environment.version !== '1')
    return fail('TRSH1007', '/manifest/environment', 'Executor differs from the registered pure-function boundary.');
  if (!same(bundle.manifest.searchedLiterature, loaded.literature.map(record => record.id)))
    return fail('TRSH1002', '/manifest/searchedLiterature', 'Literature search inventory differs from the registered snapshot.');
  if (!loaded.manifest.programs.every(program => program.sha256 === bundle.manifest.environment.programSourceHash))
    return fail('TRSH1002', '/manifest/environment/programSourceHash', 'Execution source does not identify the registered program table.');
  for (const [index, run] of bundle.runs.entries()) {
    const evaluated = await evaluateResearchRun(topic, dataset, hidden, run);
    if (!evaluated.valid) {
      issues.push(...evaluated.issues.map(issue => ({ ...issue, path: '/runs/' + index + issue.path }))); return result;
    }
    const observed = bundle.observations.find(observation => observation.experimentRunId === run.id);
    if (!same(observed ?? null, evaluated.observation))
      return fail('TRSH1002', '/observations/' + index + '/value', 'Independent raw-output evaluation disagrees with the retained metric.');
    const condition = topic.plan.conditions.find(condition => condition.id === run.condition)!;
    const rerun = await executeResearchProgram(condition.programId, dataset, run.seed, condition.params);
    result.rerun.total++;
    if (!rerun.ok || !same(rerun.output, run.output))
      return fail('TRSH1002', '/runs/' + index + '/output', 'Independent program rerun differs from retained raw output.');
    result.rerun.passed++;
  }
  if (!same(bundle.decision, researchMechanicalDecision(topic, bundle.observations)))
    return fail('TRSH1006', '/decision', 'Decision does not follow the registered paired comparison and budget.');
  if (bundle.literature.some(id => !loaded.literature.some(record => record.id === id)))
    return fail('TRSH1003', '/literature', 'Screened literature contains a source absent from the snapshot.');
  for (const [index, card] of bundle.evidence.entries()) {
    const record = loaded.literature.find(record => record.id === card.literatureId);
    const source = record && loaded.files.get(record.sourcePath);
    if (!record || !source) return fail('TRSH1003', '/evidence/' + index + '/literatureId', 'Evidence source is not admitted.');
    if (researchBytesSha256(source) !== card.contentHash || !new TextDecoder().decode(source).includes(card.excerpt)
      || card.artifactId !== 'art-' + card.contentHash)
      return fail('TRSH1005', '/evidence/' + index + '/excerpt', 'Excerpt does not resolve to its immutable source bytes.');
    if (card.versionId !== await canonicalSha256({ contentHash: card.contentHash, extractor: 'fixture-passages-v1' }))
      return fail('TRSH1002', '/evidence/' + index + '/versionId', 'Source version does not recompute.');
    if (card.extractionPromptRevision !== bundle.manifest.promptRevision)
      return fail('TRSH1002', '/evidence/' + index + '/extractionPromptRevision', 'Evidence does not identify the registered extraction template.');
    const text = new TextDecoder().decode(source);
    if (card.locator.headingPath.length !== 1 || !text.includes('## ' + card.locator.headingPath[0])
      || card.locator.elementOrder !== 1) return fail('TRSH1005', '/evidence/' + index + '/locator', 'Source locator does not resolve.');
  }
  const admitted = [
    ...bundle.evidence.map(card => ({ id: card.artifactId, kind: 'document', digest: card.contentHash })),
    ...bundle.runs.map(run => ({ id: 'art-' + run.rawArtifactHash, kind: 'experiment-output', digest: run.rawArtifactHash! })),
  ].filter((artifact, index, artifacts) => artifacts.findIndex(other => other.id === artifact.id) === index);
  const claims = validateClaimEvidence(bundle.claimLedger, { artifacts: admitted });
  if (!claims.valid) {
    for (const error of claims.errors ?? []) {
      const cause = error as { code?: string; instancePath?: string; message?: string };
      issues.push({ code: 'TRSH1005', path: '/claimLedger' + (cause.instancePath ?? ''), detail: 'Native evidence validation refused the claim ledger.',
        cause: { code: cause.code ?? 'EVIDENCE_SHAPE', path: cause.instancePath ?? '', detail: cause.message ?? 'Invalid evidence envelope.' } });
    }
    return result;
  }
  for (const [index, evidence] of bundle.claimLedger.evidence.entries()) {
    const card = bundle.evidence.find(card => card.id === evidence.id);
    const observation = bundle.observations.find(observation => observation.id + '-evidence' === evidence.id);
    const run = observation && bundle.runs.find(run => run.id === observation.experimentRunId);
    const quote = card?.excerpt ?? (run ? canonicalizeJson(run.output) : null);
    if (quote === null || evidence.quote !== quote)
      return fail('TRSH1005', '/claimLedger/evidence/' + index + '/quote', 'Evidence quote differs from its retained source or raw output.');
    if (evidence.selector !== (card ? '/Evidence/1' : '/'))
      return fail('TRSH1005', '/claimLedger/evidence/' + index + '/selector', 'Evidence selector does not resolve to the retained content.');
    if (evidence.artifact !== (card ? card.artifactId : 'art-' + run!.rawArtifactHash))
      return fail('TRSH1005', '/claimLedger/evidence/' + index + '/artifact', 'Evidence content belongs to another artifact.');
  }
  if (!same(bundle.claims.map(claim => claim.id), bundle.claimLedger.claims.map(claim => claim.id)))
    return fail('TRSH1005', '/claims', 'Claim descriptors and the evidence ledger do not reconcile.');
  for (const [index, claim] of bundle.claims.entries()) {
    const path = '/claims/' + index;
    const foreign = claim.literatureIds.findIndex(id => !loaded.literature.some(record => record.id === id));
    if (foreign >= 0) return fail('TRSH1003', path + '/literatureIds/' + foreign, 'Citation identity is absent from the snapshot.');
    const expected = hidden.requiredClaims.find(expected => expected.id === claim.id);
    const ledger = bundle.claimLedger.claims[index];
    const reject = (member: string, detail: string) => {
      result.unresolved.push(claim.id); return fail('TRSH1005', path + member, detail);
    };
    if (!expected || claim.kind !== expected.kind) return reject('/id', 'Claim is outside the registered rubric.');
    if (claim.strength !== expected.strength) return reject('/strength', 'Claim strength exceeds its independent evidence.');
    if (!ledger.critical || ledger.status !== 'supported' || ledger.text !== claim.text || !same(ledger.evidence, claim.evidenceIds))
      return reject('/evidenceIds', 'Strict claims must retain the exact critical evidence ledger view.');
    if (claim.kind === 'metric') {
      const binding = claim.metricBinding;
      const observations = bundle.observations.filter(observation => observation.condition === expected.observationCondition);
      if (!binding || binding.condition !== expected.observationCondition || binding.metric !== metric.id || binding.unit !== metric.unit
        || !same(binding.seeds, topic.contract.replicatePolicy.seeds) || binding.aggregate !== 'mean'
        || !same(claim.observationIds, observations.map(observation => observation.id))
        || Math.abs(binding.value - mean(observations.map(observation => observation.value))!) > hidden.metricTolerance
        || claim.text !== metricClaimText(binding.condition, binding.metric, binding.value, binding.unit))
        return reject('/metricBinding', 'Numeric claim does not identify the exact registered condition, seeds, unit and aggregate.');
      const evidence = claim.evidenceIds.map(id => bundle.claimLedger.evidence.find(evidence => evidence.id === id));
      if (evidence.length !== observations.length || evidence.some((item, offset) => !item
        || item.artifact !== 'art-' + observations[offset].runArtifactHash))
        return reject('/evidenceIds', 'Numeric claim does not cite each retained raw experiment output.');
    } else {
      if (claim.text !== expected.text || !expected.literatureId || !claim.literatureIds.includes(expected.literatureId)
        || !claim.evidenceIds.some(id => bundle.evidence.some(card => card.id === id && card.literatureId === expected.literatureId
          && card.excerpt.includes(expected.text)))) return reject('/text', 'Authored proposition is not supported by the admitted passage.');
    }
    result.supported.push(claim.id);
  }
  if (bundle.manifest.reviewedEvidenceHash !== await researchReviewedEvidenceHash(loaded, bundle))
    return fail('TRSH1002', '/manifest/reviewedEvidenceHash', 'Reviewed claims, evidence or literature differ from the approved manifest.');
  if (!same(bundle.disclosure.map(item => item.item), [...RESEARCH_DISCLOSURES]))
    return fail('TRSH1001', '/disclosure', 'Every disclosure category must appear once in registered order.');
  if (!same(bundle.disclosure, researchDisclosures(bundle)))
    return fail('TRSH1005', '/disclosure', 'Disclosure assertions differ from their retained evidence requirements.');
  for (const [index, item] of bundle.disclosure.entries()) {
    if (item.satisfied && (item.evidence.length === 0 || item.evidence.some(pointer => {
      if (!pointer.startsWith('/')) return true;
      try {
        const value = compileJSONPointer(pointer)(bundle);
        return value === JSONPOINTER_NOTHING || value === undefined || value === null || (Array.isArray(value) && value.length === 0);
      } catch (cause) {
        if (cause instanceof Error) return true;
        throw cause;
      }
    }))) return fail('TRSH1005', '/disclosure/' + index + '/evidence', 'Disclosure evidence does not resolve to retained artifacts.');
  }
  result.valid = true; return result;
}
export function metricClaimText(condition: string, metric: string, value: number, unit: string): string {
  return condition + ' has mean ' + metric + ' ' + value + ' ' + unit + ' across all registered seeds.';
}
export function researchDisclosures(bundle: ResearchBundle): DisclosureChecklist {
  const approved = ['literature', 'design', 'quality'].every(gate => bundle.interventions.some(action =>
    action.gate === gate && action.action === 'approve' && action.actor !== 'timeout'
    && action.approvedManifestHash === bundle.manifest.manifestHash));
  const pointers = [
    approved ? ['/interventions'] : [],
    ['/manifest/environment'],
    ['/runs', '/manifest/inputs', '/manifest/promptRevision'],
    bundle.evidence.length >= 2 ? ['/literature', '/evidence'] : [],
    ['/contract/selectionRule', '/runs'],
    ['/contract/requiredBaselines', '/manifest/baselineSources'],
    ['/observations', '/manifest/metricOrigin'],
    bundle.manifest.frozenBeforeResults ? ['/contract/contractHash', '/plan/planHash'] : [],
  ];
  return RESEARCH_DISCLOSURES.map((item, index) => ({ item, satisfied: pointers[index].length > 0, evidence: pointers[index] }));
}
