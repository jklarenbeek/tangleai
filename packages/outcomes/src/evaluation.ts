/** One-use held-out registrations and independently recomputed paired gates. */
import { equalsJson } from '@jarenjs/core/object';
import { checkShape, checkTime, jsonBytes } from './schema.ts';
import { outcomeRevision } from './identity.ts';
import { issue, reject, OutcomeRefusal } from './errors.ts';
import { scoreUtility } from './domain.ts';
import { headFor, semantic, unique, putRecord } from './persistence.ts';
import { recordOf, seal, asJson } from './service-context.ts';
import { trainingRecords } from './refinement.ts';
import { verifiedSource } from './resolution.ts';
import { assertHead, eligibilityIssues } from './transitions.ts';
import type { ServiceContext } from './service-context.ts';
import type { OutcomeTransaction } from './store.ts';
import type { ArtifactVersion, EvaluateCommand, EvaluationRegistration, Evaluation, EvaluationSlot, CaseResult, Issue, Operation, Json } from './outcomes.contracts.gen.ts';

export const RETROSPECTIVE_RULES = Object.freeze({ revision: 'outcome-retrospective/v1', utility: { success: 1, partial: 0.5, failure: 0 }, strictPairedImprovement: true, noDomainRegression: true, completeCoverage: true });
export const outcomeGatePolicyId = (policy: Json) => outcomeRevision({ rules: RETROSPECTIVE_RULES, policy });

export async function reserveEvaluation(context: ServiceContext, c: EvaluateCommand, op: Operation) {
  return context.atomic().transaction(async tx => {
    const previous = await semantic(tx, c.scopeId, 'evaluation', c.input.versionId);
    if (previous) reject('OUTC1007', `The evaluation stage is already complete: ${previous}.`);
    const version = await recordOf(tx, c.input.versionId, c.scopeId, c.artifactKey, 'artifactVersion');
    if (version.policyId !== context.policyId) reject('OUTC1008', 'Candidate policy differs from its host.');
    const reflection = await recordOf(tx, version.reflectionId, c.scopeId, c.artifactKey, 'reflection');
    const training = await trainingRecords(tx, context, c.artifactKey, reflection.scoreIds, version.recordedAt);
    if (!equalsJson(version.adapter, training[0].decision.adapter)) reject('OUTC1008', 'Candidate adapter differs from its training.');
    assertHead(await headFor(tx, c.scopeId, c.artifactKey), version.expectedHead);
    const slotKey = [c.artifactKey, c.input.slotId];
    const owner = await semantic(tx, c.scopeId, 'evaluationSlotOwner', slotKey);
    if (owner && owner !== op.id) reject('OUTC1011', 'The held-out slot has already been reserved.');
    const candidateOwner = await semantic(tx, c.scopeId, 'evaluationCandidateOwner', version.id);
    if (candidateOwner && candidateOwner !== op.id) reject('OUTC1011', 'The candidate already has an evaluation reservation.');
    let changes = 0;
    if (!owner) { await unique(tx, c.scopeId, 'evaluationSlotOwner', slotKey, op.id); changes++; }
    if (!candidateOwner) { await unique(tx, c.scopeId, 'evaluationCandidateOwner', version.id, op.id); changes++; }
    if (changes) {
      const current = await tx.get('operations', op.id); if (!current || current.attempt !== op.attempt) reject('OUTC1019', 'Evaluation reservation changed.');
      await tx.put('operations', { ...current, preparationWrites: current.preparationWrites + changes + 1 });
    }
    return { version, reflection, training };
  });
}
export async function prepareEvaluation(context: ServiceContext, c: EvaluateCommand, op: Operation) {
  const data = await reserveEvaluation(context, c, op);
  // An existing registration is the retained exact corpus after a retry.
  const retained = await context.atomic().transaction(async tx => {
    const id = await semantic(tx, c.scopeId, 'evaluationRegistration', data.version.id);
    return id ? recordOf(tx, id, c.scopeId, c.artifactKey, 'evaluationRegistration') : null;
  });
  if (retained) return { ...data, registration: retained };
  if (!context.evaluationSlot) reject('OUTC1011', 'A trusted held-out registration provider is required.');
  const raw = await context.evaluationSlot(c.input.slotId, data.version.id, context.scope);
  let slot: EvaluationSlot;
  try { slot = checkShape<EvaluationSlot>('evaluationSlot', raw); } catch { reject('OUTC1011', 'The host supplied an invalid or missing held-out registration.'); }
  if (slot.slotId !== c.input.slotId || slot.versionId !== data.version.id || !equalsJson(slot.expectedHead, data.version.expectedHead) || !equalsJson([...slot.trainingScoreIds].sort(), data.reflection.scoreIds) || slot.gatePolicyId !== context.gatePolicyId) reject('OUTC1011', 'Held-out registration bindings differ.');
  if (jsonBytes(asJson(slot)) > 262144) reject('OUTC1011', 'Held-out registration exceeds 262,144 canonical UTF-8 bytes.');
  const trainingIds = new Set(data.training.map(t => t.decision.decisionKey)), trainingDigests = new Set(data.training.map(t => t.contentDigest));
  const content = new Set<string>(), names = new Set<string>();
  for (const item of slot.cases) {
    if (names.has(item.id) || trainingIds.has(item.id)) reject('OUTC1011', 'Training and held-out case ids must be disjoint and unique.'); names.add(item.id);
    const source = await verifiedSource(context, { sourceId: item.source.sourceId, digest: item.source.digest }, '0000-01-01T00:00:00.000Z', c.at);
    if (source.decisionId !== null || !equalsJson(source, item.source)) reject('OUTC1006', 'Held-out evidence snapshot differs from its independent source.');
    const digest = await outcomeRevision({ domain: item.domain, input: item.input, outcome: source.payload });
    if (content.has(digest) || trainingDigests.has(digest)) reject('OUTC1011', 'Training and held-out content must be disjoint and unique.'); content.add(digest);
  }
  const registration = await context.atomic().transaction(async tx => {
    const current = await tx.get('operations', op.id); if (!current || current.attempt !== op.attempt) reject('OUTC1019', 'Evaluation attempt changed.');
    for (const digest of content) {
      const used = await semantic(tx, c.scopeId, 'heldOutContent', digest);
      if (used && used !== data.version.id) reject('OUTC1011', 'Previously consumed held-out content cannot be renamed or reused.');
    }
    const registration = await seal('evaluationRegistration', c.scopeId, c.artifactKey, c.at, slot);
    await putRecord(tx, registration); await unique(tx, c.scopeId, 'evaluationRegistration', data.version.id, registration.id);
    for (const digest of content) await unique(tx, c.scopeId, 'heldOutContent', digest, data.version.id);
    await tx.put('operations', { ...current, preparationWrites: current.preparationWrites + 4 + content.size });
    return registration;
  });
  return { ...data, registration };
}

export async function pairedResults(context: ServiceContext, version: ArtifactVersion, registration: EvaluationRegistration, baseline: Json) {
  const { adapter, domain } = context.adapter(version.adapter), rows: CaseResult[] = [], issues: Issue[] = [];
  for (const c of registration.cases) {
    try {
      const input = domain.input(c.input), actual = domain.resolution(c.source.payload);
      const output = domain.output(adapter.interpret(input, version.payload)), baselineOutput = domain.output(adapter.interpret(input, baseline));
      const category = checkShape<CaseResult['category']>('category', adapter.score(output, actual).outcome), baselineCategory = checkShape<CaseResult['category']>('category', adapter.score(baselineOutput, actual).outcome);
      rows.push({ id: c.id, contentDigest: await outcomeRevision({ domain: c.domain, input: c.input, outcome: c.source.payload }), output, baselineOutput, category, baselineCategory, utility: scoreUtility(category), baselineUtility: scoreUtility(baselineCategory) });
    } catch { issues.push(issue('OUTC1011', `Held-out case could not be scored: ${c.id}.`)); }
  }
  return { rows, issues };
}
export async function baselinePayload(tx: OutcomeTransaction, context: ServiceContext, version: ArtifactVersion) {
  if (version.parentVersionId === null) return context.adapter(version.adapter).adapter.staticPayload;
  const parent = await recordOf(tx, version.parentVersionId, version.scopeId, version.artifactKey, 'artifactVersion');
  if (!equalsJson(parent.adapter, version.adapter) || parent.policyId !== version.policyId) reject('OUTC1008', 'Evaluation parent adapter or policy differs.');
  return parent.payload;
}
export async function commitEvaluation(tx: OutcomeTransaction, context: ServiceContext, c: EvaluateCommand, data: Awaited<ReturnType<typeof prepareEvaluation>>) {
  const exists = await semantic(tx, c.scopeId, 'evaluation', data.version.id);
  if (exists) reject('OUTC1007', `The evaluation stage is already complete: ${exists}.`);
  const { rows, issues } = await pairedResults(context, data.version, data.registration, await baselinePayload(tx, context, data.version));
  const base = { versionId: data.version.id, registrationId: data.registration.id, expectedHead: data.version.expectedHead, trainingScoreIds: data.reflection.scoreIds, caseResults: rows,
    caseReportId: await outcomeRevision(rows), evaluatorRevision: data.registration.evaluatorRevision, gatePolicyId: data.registration.gatePolicyId,
    eligible: false, issues, meanDelta: rows.length === data.registration.cases.length ? rows.reduce((n, c) => n + c.utility - c.baselineUtility, 0) / rows.length : null,
    physicalRequests: 0, cost: 0,
  };
  const provisional = await seal('evaluation', c.scopeId, c.artifactKey, c.at, base);
  const gates = eligibilityIssues(provisional, data.registration, data.version);
  const evaluation = await seal('evaluation', c.scopeId, c.artifactKey, c.at, { ...base, issues: gates, eligible: gates.length === 0 });
  await putRecord(tx, evaluation); await unique(tx, c.scopeId, 'evaluation', data.version.id, evaluation.id);
  return { evaluationId: evaluation.id, eligible: evaluation.eligible, issues: asJson(evaluation.issues), caseReportId: evaluation.caseReportId };
}

/** Recompute from retained independent bytes at the authority boundary. */
export async function checkedEvaluation(tx: OutcomeTransaction, context: ServiceContext, version: ArtifactVersion, evaluation: Evaluation) {
  const registration = await recordOf(tx, evaluation.registrationId, version.scopeId, version.artifactKey, 'evaluationRegistration');
  const reflection = await recordOf(tx, version.reflectionId, version.scopeId, version.artifactKey, 'reflection');
  const training = await trainingRecords(tx, context, version.artifactKey, reflection.scoreIds, version.recordedAt);
  if (version.policyId !== context.policyId || await outcomeRevision(version.policy) !== version.policyId || version.payloadSchema !== version.adapter.artifactSchema || !equalsJson(version.adapter, training[0].decision.adapter) || registration.gatePolicyId !== context.gatePolicyId || !equalsJson(evaluation.trainingScoreIds, reflection.scoreIds) || !equalsJson(registration.trainingScoreIds, reflection.scoreIds) || !equalsJson(version.expectedHead, registration.expectedHead)) reject('OUTC1008', 'Checked artifact identity bindings differ.');
  const baseline = await baselinePayload(tx, context, version);
  context.adapter(version.adapter).domain.artifact(version.payload);
  const actual = await pairedResults(context, version, registration, baseline);
  if (actual.issues.length || !equalsJson(actual.rows, evaluation.caseResults) || await outcomeRevision(actual.rows) !== evaluation.caseReportId) reject('OUTC1011', 'Retrospective result bytes do not reproduce.');
  const trainingContent = new Set(training.map(t => t.contentDigest)), trainingIds = new Set(training.map(t => t.decision.decisionKey));
  const content = new Set<string>();
  for (const c of registration.cases) {
    const { digest, ...bytes } = c.source;
    checkTime(c.source.observedAt);
    const hash = await outcomeRevision({ domain: c.domain, input: c.input, outcome: c.source.payload });
    if (await outcomeRevision(bytes) !== digest || c.source.scopeId !== context.scopeId || c.source.subject !== context.scope.subject || c.source.decisionId !== null || content.has(hash) || trainingContent.has(hash) || trainingIds.has(c.id)) reject('OUTC1011', 'Retained held-out evidence is not disjoint or valid.');
    content.add(hash);
  }
  const issues = eligibilityIssues(evaluation, registration, version);
  if (!evaluation.eligible || issues.length) throw new OutcomeRefusal(issues.length ? issues : [issue('OUTC1011', 'The evaluation is ineligible.')]);
  return registration;
}
