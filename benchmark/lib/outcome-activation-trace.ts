/** Reconstruct candidate checks and head history from the measured immutable rows. */
import { equalsJson } from '@jarenjs/core/object';
import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { DEFAULT_OUTCOME_POLICY, eligibilityIssues, planPromotion } from '@tangleai/outcomes';
import { createDirectionDeltaAdapter } from '@tangleai/outcomes/adapters/direction-delta';
import { createExactMatchAdapter } from '@tangleai/outcomes/adapters/exact-match';
import held from '../fixtures/outcome/held-out.json' with { type: 'json' };
import { baselineScore, utilityOf } from './outcome-conformance.ts';
import type { Row } from './outcome-conformance.types.ts';
import type { OutcomeRecord, Head } from '@tangleai/outcomes';

export async function validateActivationRecords(row: Row, records: OutcomeRecord[]): Promise<void> {
  const adapters = [await createDirectionDeltaAdapter(), await createExactMatchAdapter()];
  const ids = new Map(records.map(r => [r.id, r]));
  const get = <K extends OutcomeRecord['kind']>(id: string, kind: K): Extract<OutcomeRecord, { kind: K }> => {
    const r = ids.get(id); if (!r || r.kind !== kind) throw Error(`Activation trace missing ${kind}`); return r as Extract<OutcomeRecord, { kind: K }>;
  };
  const sameOwner = (...items: OutcomeRecord[]) => {
    if (new Set(items.map(r => JSON.stringify([r.scopeId, r.artifactKey]))).size !== 1) throw Error('Activation trace crosses a scope or lineage');
  };
  const versions = records.filter(r => r.kind === 'artifactVersion'), evaluations = records.filter(r => r.kind === 'evaluation'), events = records.filter(r => r.kind === 'activationEvent');
  if (row.counts.versions !== versions.length || row.counts.promotions !== events.filter(r => r.action === 'promote').length || row.counts.rollbacks !== events.filter(r => r.action === 'rollback').length || row.counts.retainedBytes !== versions.reduce((n, v) => n + new TextEncoder().encode(canonicalizeJson(v.payload)).length, 0)) throw Error('Activation trace counts or retained bytes differ');
  const validEvaluations = new Set<string>(), consumed = new Set<string>();
  for (const version of versions) {
    const reflection = get(version.reflectionId, 'reflection'); sameOwner(version, reflection);
    if (version.parentVersionId !== reflection.parentVersionId || !equalsJson(version.policy, DEFAULT_OUTCOME_POLICY) || version.policyId !== await canonicalSha256(version.policy) || version.payloadSchema !== version.adapter.artifactSchema) throw Error('Activation trace candidate policy differs');
    if (version.parentVersionId !== null) sameOwner(version, get(version.parentVersionId, 'artifactVersion'));
  }
  for (const evaluation of evaluations) {
    const version = get(evaluation.versionId, 'artifactVersion'), registration = get(evaluation.registrationId, 'evaluationRegistration'), reflection = get(version.reflectionId, 'reflection');
    sameOwner(version, evaluation, registration, reflection);
    const adapter = adapters.find(a => equalsJson(a.identity, version.adapter)); if (!adapter) throw Error('Activation trace adapter is unregistered');
    const baseline = version.parentVersionId === null ? adapter.staticPayload : get(version.parentVersionId, 'artifactVersion').payload;
    if (registration.trainingScoreIds.length !== reflection.scoreIds.length || !equalsJson(registration.trainingScoreIds, reflection.scoreIds) || !equalsJson(evaluation.trainingScoreIds, reflection.scoreIds)) throw Error('Activation trace training binding differs');
    const trainingContent = new Set<string>();
    for (const id of reflection.scoreIds) {
      const score = get(id, 'score'), decision = get(score.decisionId, 'decision'), resolution = get(score.resolutionId, 'resolution'); sameOwner(version, score, decision, resolution);
      if (score.recordedAt > version.recordedAt || resolution.decisionId !== decision.id || !equalsJson(decision.adapter, version.adapter)) throw Error('Activation trace training is not prior independent evidence');
      trainingContent.add(await canonicalSha256({ domain: decision.scope.domain, input: decision.input, outcome: resolution.payload }));
    }
    for (const c of registration.cases) {
      const fixture = held.find(h => h.id === c.id), { digest, ...source } = c.source;
      if (!fixture || fixture.domain !== c.domain || !equalsJson(fixture.input, c.input) || !equalsJson(fixture.outcome, c.source.payload) || await canonicalSha256(source) !== digest || c.source.decisionId !== null || c.source.scopeId !== registration.scopeId) throw Error('Activation trace held-out evidence differs from its registered fixture');
      const content = await canonicalSha256({ domain: c.domain, input: c.input, outcome: c.source.payload });
      if (consumed.has(content) || trainingContent.has(content)) throw Error('Activation trace reuses held-out content'); consumed.add(content);
      const measured = evaluation.caseResults.find(r => r.id === c.id); if (!measured) throw Error('Activation trace omits a held-out case');
      const output = adapter.interpret(c.input, version.payload), baselineOutput = adapter.interpret(c.input, baseline);
      const category = baselineScore(c.domain, output, c.source.payload), baselineCategory = baselineScore(c.domain, baselineOutput, c.source.payload);
      if (!equalsJson(measured, { id: c.id, contentDigest: content, output, baselineOutput, category, baselineCategory, utility: utilityOf(category), baselineUtility: utilityOf(baselineCategory) })) throw Error('Activation trace paired scores do not reproduce');
    }
    if (await canonicalSha256(evaluation.caseResults) !== evaluation.caseReportId) throw Error('Activation trace case report digest differs');
    const issues = eligibilityIssues({ ...evaluation, issues: [] }, registration, version);
    if (evaluation.eligible !== (issues.length === 0) || !equalsJson(evaluation.issues, issues)) throw Error('Activation trace eligibility differs');
    if (evaluation.eligible) validEvaluations.add(evaluation.id);
  }
  const heads = new Map<string, Head>(), activated = new Set<string>();
  for (const event of [...events].sort((a, b) => a.nextHead.revision - b.nextHead.revision || a.scopeId.localeCompare(b.scopeId))) {
    const version = get(event.versionId, 'artifactVersion'), approval = get(event.approvalId, 'approval'), evaluation = get(event.evaluationId, 'evaluation'), registration = get(evaluation.registrationId, 'evaluationRegistration');
    sameOwner(event, version, approval, evaluation, registration);
    const key = JSON.stringify([event.scopeId, event.artifactKey]), previous = heads.get(key) ?? { versionId: null, revision: 0 };
    const receipt = records.find(r => r.kind === 'operationReceipt' && r.operation === 'approve' && r.requestId === approval.requestId);
    if (!receipt || !validEvaluations.has(evaluation.id) || approval.action !== event.action || approval.versionId !== version.id || approval.evaluationId !== evaluation.id || !equalsJson(approval.expectedHead, previous) || !equalsJson(event.previousHead, previous) || event.nextHead.versionId !== version.id || event.nextHead.revision !== previous.revision + 1) throw Error('Activation trace lacks exact approval or head authority');
    if (event.action === 'promote') {
      if (!equalsJson(planPromotion(previous, version, evaluation, registration, approval), event.nextHead)) throw Error('Activation trace promotion does not reproduce');
      activated.add(version.id);
    } else if (!activated.has(version.id)) throw Error('Activation trace restores a never-active version');
    heads.set(key, event.nextHead);
  }
  for (const decision of records.filter(r => r.kind === 'decision')) {
    const adapter = adapters.find(a => equalsJson(a.identity, decision.adapter)); if (!adapter) throw Error('Decision adapter is unregistered');
    const eventsBefore = events.filter(e => e.scopeId === decision.scopeId && e.artifactKey === decision.artifactKey && e.recordedAt <= decision.decidedAt).sort((a, b) => b.nextHead.revision - a.nextHead.revision);
    const head = eventsBefore[0]?.nextHead.versionId ?? null;
    if (decision.usedVersionId !== head) throw Error('Decision did not bind its historical checked head');
    const payload = head === null ? adapter.staticPayload : get(head, 'artifactVersion').payload;
    if (!equalsJson(decision.output, adapter.interpret(decision.input, payload))) throw Error('Decision output does not reproduce with its bound payload');
  }
}
