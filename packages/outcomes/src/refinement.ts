/** Bounded payload plans over Jaren's generic guarded engine and JSON Patch. */
import { checkedHead } from './promotion.ts';
import { createGuardedRefiner } from '@jarenjs/core/guarded';
import { cloneJson, equalsJson } from '@jarenjs/core/object';
import { applyJSONPatch } from '@jarenjs/json/patch';
import { parseJSONPointer, encodeJSONPointerSegment } from '@jarenjs/json/pointer';
import { domainValidator, scoreUtility } from './domain.ts';
import { checkShape, jsonBytes } from './schema.ts';
import { outcomeRevision } from './identity.ts';
import { issue, reject, OutcomeRefusal } from './errors.ts';
import { headFor, semantic, putRecord, unique } from './persistence.ts';
import { assertHead } from './transitions.ts';
import { recordOf, seal, asJson } from './service-context.ts';
import type { ServiceContext } from './service-context.ts';
import type { OutcomeTransaction } from './store.ts';
import type { OutcomeAdapter } from './adapters.ts';
import type { Json, Policy, ReflectInput, ReflectCommand, Issue, Operation, Head } from './outcomes.contracts.gen.ts';

const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const envelope = new Set(['scope', 'scopeId', 'artifactKey', 'adapter', 'payloadSchema', 'schemaVersion', 'policy', 'policyId', 'parentVersionId', 'approval', 'evaluation', 'evidence', 'id', 'recordedAt']);
function leaves(value: Json, path = '', output = new Map<string, Json>()): Map<string, Json> {
  if (value !== null && typeof value === 'object' && Object.keys(value).length) {
    for (const [key, child] of Object.entries(value)) leaves(child, path + '/' + encodeJSONPointerSegment(key), output);
  } else output.set(path, value);
  return output;
}
/** A removed empty container and its new child leaves each count as changes. */
export function changedLeafPaths(before: Json, after: Json): string[] {
  const a = leaves(before), b = leaves(after);
  return [...new Set([...a.keys(), ...b.keys()])].filter(path => !a.has(path) || !b.has(path) || !equalsJson(a.get(path), b.get(path))).sort();
}
function payloadPaths(value: Json): void {
  if (value !== null && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) reject('OUTC1009', 'Prototype-related payload members are forbidden.');
    payloadPaths(child);
  }
}
export function preparePayload(adapter: OutcomeAdapter, policy: Policy, previous: Json, raw: ReflectInput) {
  const shape = domainValidator(adapter.schemas.artifact);
  const guarded = createGuardedRefiner({
    read: async () => previous,
    validateProposal(value: unknown) {
      const input = checkShape<ReflectInput>('reflectInput', value);
      if (input.patch.length > policy.maxOperations) reject('OUTC1009', 'Patch operation limit exceeded.');
      if (new TextEncoder().encode(input.text).length > policy.maxReflectionBytes) reject('OUTC1009', 'Reflection UTF-8 byte limit exceeded.');
      if (input.mode === 'create' && input.patch.length) reject('OUTC1009', 'Root creation requires a payload, without a patch.');
      if (input.mode === 'evolve' && input.payload !== null) reject('OUTC1009', 'Evolution requires a patch, with payload null.');
      for (const patch of input.patch) {
        let path: string[]; try { path = parseJSONPointer(patch.path); } catch { reject('OUTC1009', 'Invalid JSON Pointer.'); }
        if (path.some(p => forbidden.has(p)) || envelope.has(path[0])) reject('OUTC1009', 'Patch paths may address only the domain payload.');
      }
      return true;
    },
    apply(document: Json, input: ReflectInput) { return input.mode === 'create' ? input.payload : applyJSONPatch(document, input.patch); },
    applyFailure: () => issue('OUTC1009', 'The patch does not apply to the captured payload.'),
    validateCandidate(value: unknown) {
      const payload = shape(value); payloadPaths(payload);
      if (jsonBytes(payload) > policy.maxPayloadBytes) reject('OUTC1009', 'Canonical payload UTF-8 byte limit exceeded.');
      return true;
    },
    planCommit(value: Json, before: Json) {
      const payload = shape(adapter.normalizePayload ? adapter.normalizePayload(value) : value);
      payloadPaths(payload);
      if (jsonBytes(payload) > policy.maxPayloadBytes) reject('OUTC1009', 'Normalized payload UTF-8 byte limit exceeded.');
      const changed = changedLeafPaths(before, payload);
      const issues = adapter.validatePayload(payload).map(i => checkShape<Issue>('issue', i));
      if (changed.length > policy.maxChangedLeaves) issues.push(issue('OUTC1009', 'Changed leaf path limit exceeded.'));
      return { payload, issues, changed, noOp: raw.mode === 'evolve' && equalsJson(before, payload) };
    },
    commit: async () => { throw new TypeError('Payload preparation never commits through the generic engine.'); },
  });
  const prepared = guarded.prepare(previous, raw);
  if (!prepared.valid || !prepared.plan) {
    const errors = prepared.errors as Array<{ code?: string; detail?: string; message?: string }>;
    const known = errors[0]?.code;
    // Guarded catches private exceptions; preserve the outcome code without model text.
    const code = known && /^OUTC10(0[1-9]|1[0-9])$/.test(known) ? known as Issue['code'] : 'OUTC1009';
    throw new OutcomeRefusal([issue(code, 'Payload preparation refused the proposal.')]);
  }
  return prepared.plan as { payload: Json; issues: Issue[]; changed: string[]; noOp: boolean };
}

export async function trainingRecords(tx: OutcomeTransaction, context: ServiceContext, artifactKey: string, ids: string[], at: string) {
  if (!ids.length || new Set(ids).size !== ids.length) reject('OUTC1001', 'Training score ids must be nonempty and unique.');
  const training = [];
  for (const id of [...ids].sort()) {
    const score = await recordOf(tx, id, context.scopeId, artifactKey, 'score');
    const decision = await recordOf(tx, score.decisionId, context.scopeId, artifactKey, 'decision');
    const resolution = await recordOf(tx, score.resolutionId, context.scopeId, artifactKey, 'resolution');
    const { adapter, domain } = context.adapter(decision.adapter);
    const verdict = adapter.score(domain.output(decision.output), domain.resolution(resolution.payload));
    if (resolution.decisionId !== decision.id || score.scorerRevision !== adapter.identity.scorerRevision || score.utility !== scoreUtility(verdict.outcome) || score.outcome !== verdict.outcome || score.recordedAt > at) reject('OUTC1002', 'Training evidence or score binding differs.');
    training.push({ score, decision, resolution, contentDigest: await outcomeRevision({ domain: decision.scope.domain, input: decision.input, outcome: resolution.payload }) });
  }
  if (new Set(training.map(t => t.decision.adapter.revision)).size !== 1) reject('OUTC1008', 'One artifact lineage has one registered adapter revision.');
  return training;
}
export async function reflectionContext(context: ServiceContext, c: ReflectCommand, capturedHead?: Head) {
  return context.atomic().transaction(async tx => {
    const training = await trainingRecords(tx, context, c.artifactKey, c.input.scoreIds, c.at);
    const adapter = context.adapter(training[0].decision.adapter).adapter;
    const head = capturedHead ?? await headFor(tx, c.scopeId, c.artifactKey);
    if (c.input.mode === 'create' && (head.versionId !== null || c.input.parentVersionId !== null)) reject('OUTC1013', 'A root can only be staged before a checked head exists.');
    if (c.input.mode === 'evolve' && (head.versionId === null || head.versionId !== c.input.parentVersionId)) reject('OUTC1013', 'Evolution requires the current checked parent.');
    if (head.versionId !== null && !capturedHead) await checkedHead(tx, context, c.artifactKey);
    let parent = null;
    if (head.versionId !== null) parent = await recordOf(tx, head.versionId, c.scopeId, c.artifactKey, 'artifactVersion');
    const lineage = await semantic(tx, c.scopeId, 'lineage', c.artifactKey);
    if (lineage) {
      const root = await recordOf(tx, lineage, c.scopeId, c.artifactKey, 'artifactVersion');
      if (root.policyId !== context.policyId || !equalsJson(root.adapter, adapter.identity)) reject('OUTC1008', 'A schema or policy change requires a new artifact key.');
    }
    if (parent && (parent.policyId !== context.policyId || !equalsJson(parent.adapter, adapter.identity))) reject('OUTC1008', 'Parent policy or adapter differs.');
    return { training, adapter, head, previous: parent?.payload ?? adapter.staticPayload };
  });
}
export async function commitReflection(tx: OutcomeTransaction, context: ServiceContext, c: ReflectCommand, op: Operation, data: Awaited<ReturnType<typeof reflectionContext>>, input: ReflectInput) {
  const plan = preparePayload(data.adapter, context.policy, data.previous, input);
  const scores = [...input.scoreIds].sort();
  if (!equalsJson(scores, data.training.map(t => t.score.id)) || new Set(input.citations).size !== input.citations.length || input.citations.some(id => !scores.includes(id))) reject('OUTC1006', 'Reflection citations must name the provided verified training scores.');
  const current = await headFor(tx, c.scopeId, c.artifactKey);
  try { assertHead(current, data.head); } catch { plan.issues.push(issue('OUTC1013', 'The captured parent head changed during proposal preparation.')); }
  const lineage = await semantic(tx, c.scopeId, 'lineage', c.artifactKey);
  if (lineage) {
    const root = await recordOf(tx, lineage, c.scopeId, c.artifactKey, 'artifactVersion');
    if (root.policyId !== context.policyId || !equalsJson(root.adapter, data.adapter.identity)) reject('OUTC1008', 'Lineage policy or adapter changed.');
  }
  const reflection = await seal('reflection', c.scopeId, c.artifactKey, c.at, { scoreIds: scores, parentVersionId: input.parentVersionId, configuration: input.configuration, text: input.text, citations: [...input.citations].sort(), attemptId: op.id });
  await putRecord(tx, reflection);
  if (plan.noOp) return { reflectionId: reflection.id, versionId: null, noOp: true, issues: asJson(plan.issues) };
  const version = await seal('artifactVersion', c.scopeId, c.artifactKey, c.at, { parentVersionId: input.parentVersionId, expectedHead: data.head, payload: plan.payload, payloadSchema: data.adapter.identity.artifactSchema, adapter: data.adapter.identity, reflectionId: reflection.id, mode: input.mode, policyId: context.policyId, policy: context.policy, issues: plan.issues });
  await putRecord(tx, version); if (!lineage) await unique(tx, c.scopeId, 'lineage', c.artifactKey, version.id);
  return { reflectionId: reflection.id, versionId: version.id, noOp: false, issues: asJson(plan.issues) };
}
