import { getEpochOfDateTimeRFC3339, parseRFC3339Parts } from '@jarenjs/core/dates';
import { equalsJson } from '@jarenjs/core/object';
import type { MasInteraction, MasStore, TraceView, JsonSchema } from '@tangleai/mas';
import type { ResearchGateKind, ResearchGateReview, ResearchWorkflowFrame } from './contracts.gen.ts';
import { researchSchemaOf, validateResearchShape } from './schema.ts';
import { immutableResearchJson, researchRevisionOf } from './identity.ts';
import { researchFail, researchValue } from './workflow-contract.ts';
import type { ResearchStore } from './store.ts';
import { planStateTransition } from './transitions.ts';

export async function gateReviewOf(kind: ResearchGateKind, frame: ResearchWorkflowFrame, stateRevision: number): Promise<ResearchGateReview> {
  const body = immutableResearchJson({ projectId: frame.projectId, kind, stateRevision,
    artifacts: [...frame.artifacts].sort((a, b) => a.admissionId.localeCompare(b.admissionId)) });
  return researchValue(validateResearchShape<ResearchGateReview>('ResearchGateReview', { ...body, manifestHash: await researchRevisionOf(body) }));
}
export async function checkResearchGate(frame: ResearchWorkflowFrame, kind: ResearchGateKind): Promise<ResearchGateReview> {
  const f = researchValue(validateResearchShape<ResearchWorkflowFrame>('ResearchWorkflowFrame', frame)), gate = f.gate;
  if (!gate || gate.kind !== kind || gate.projectId !== f.projectId) researchFail('TRSH1005', '/gate', 'Gate prompt does not name this review.');
  const expected = await gateReviewOf(kind, f, gate.stateRevision);
  if (!equalsJson(gate, expected)) researchFail('TRSH1002', '/gate/manifestHash', 'Reviewed artifact set does not recompute.');
  return gate;
}
/** The stored interaction specializes this schema to the artifacts available at that gate. */
export function gateResponseSchema(kind: ResearchGateKind, reviewedManifestHash: string): JsonSchema {
  researchValue(validateResearchShape('ResearchGateKind', kind)); researchValue(validateResearchShape('Sha256', reviewedManifestHash));
  const base = researchSchemaOf('ResearchGateResponse');
  return immutableResearchJson({ ...base, $id: `https://tangleai.dev/schemas/research-gates/${kind}/${reviewedManifestHash}`,
    properties: { ...(base.properties as Record<string, unknown>), approvedManifestHash: { const: reviewedManifestHash } } }) as JsonSchema;
}
export interface ResearchOverduePolicy { kind: 'pause' | 'stop'; afterMs: number }
export interface ResearchOverdueGate { id: string; revision: number; runId: string; path: string; ageMs: number; kind: ResearchGateKind }
function epoch(value: string): number {
  const parts = parseRFC3339Parts(value), at = getEpochOfDateTimeRFC3339(value);
  if (!parts || parts.offset === undefined || parts.seconds >= 60 || at === undefined || !Number.isSafeInteger(at))
    researchFail('TRSH1001', '/now', 'Overdue policy requires an explicit valid RFC3339 instant.');
  return at;
}
const kinds: Readonly<Record<string, ResearchGateKind>> = { 'literature-gate': 'literature', 'design-gate': 'design', 'quality-gate': 'quality' };
export function researchGateKind(interaction: Pick<MasInteraction, 'node'>): ResearchGateKind {
  const kind = kinds[interaction.node];
  if (!kind) researchFail('TRSH1005', '/node', 'Interaction is not a research gate.');
  return kind;
}
/** A counted value only: the clock never supplies a response or approval. */
export function overdueGates(trace: Pick<TraceView, 'interactions'>, now: string, policy: ResearchOverduePolicy): ResearchOverdueGate[] {
  if (!['pause', 'stop'].includes(policy.kind) || !Number.isSafeInteger(policy.afterMs) || policy.afterMs < 0)
    researchFail('TRSH1001', '/policy', 'Expected a bounded pause or stop policy.');
  const current = epoch(now);
  return trace.interactions.filter(i => i.status === 'waiting').flatMap(i => {
    const ageMs = current - epoch(i.requestedAt);
    return ageMs >= policy.afterMs ? [{ id: i.id, revision: i.revision, runId: i.runId, path: i.path, ageMs, kind: researchGateKind(i) }] : [];
  }).sort((a, b) => a.id.localeCompare(b.id));
}
/** Native termination is atomic; the separate research projection is retry-reconciled. */
export async function applyOverduePolicy(options: { masStore: MasStore; researchStore: ResearchStore; runId: string; now: string; policy: ResearchOverduePolicy }) {
  const { masStore, researchStore, runId } = options;
  const { now, policy } = immutableResearchJson({ now: options.now, policy: options.policy });
  const trace = await masStore.readTrace(runId);
  if (!trace) researchFail('TRSH1003', '/runId', 'Unknown research run.');
  const overdue = overdueGates(trace, now, policy), stopped: string[] = [], conflicts: string[] = [];
  if (policy.kind === 'stop') for (const gate of overdue) {
    const resolved = await masStore.resolveInteraction(gate.id, 'expired', gate.revision);
    if (resolved.ok) stopped.push(gate.id); else conflicts.push(gate.id);
  }
  let reconciled = false;
  if (policy.kind === 'stop') {
    const latest = await masStore.readTrace(runId);
    if (latest?.run.status === 'failed' && latest.run.failure?.error.code === 'TMAS2007'
      && latest.interactions.some(i => i.status === 'expired' && kinds[i.node])) {
      const current = researchValue(await researchStore.getState(runId));
      if (current && current.status !== 'STOPPED' && current.status !== 'COMPLETE') {
        researchValue(await researchStore.transition(researchValue(planStateTransition(current, 'STOPPED')))); reconciled = true;
      }
    }
  }
  return { overdue, stopped, conflicts, reconciled };
}
