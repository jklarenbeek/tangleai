/**
 * Activation: one revision-fenced compare-and-swap, recorded either way.
 *
 * Nothing here decides that a directory is good. The binding checks read a
 * held-out evaluation and the registration a host made before it ran — same
 * scope, same executor identity, same gate, the evaluation's own expected
 * head — and the swap itself is the store's fenced transaction, so twenty
 * callers racing on one scope produce exactly one activation and nineteen
 * refusals that changed nothing. The head planner is the outcomes package's;
 * no revision is incremented here.
 *
 * An attempt is an event whether it applied or not. A refusal names the
 * clause that stopped it, leaves the prior directory active and readable and
 * leaves the candidate exactly as inspectable as it was — a rejected
 * candidate that quietly disappeared would be a measurement nobody can audit.
 */
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { trace2SkillIssue, type Trace2SkillOutcome } from './errors.ts';
import { planSkillPromotion, type SkillPromotionRegistration } from './transitions.ts';
import type { Trace2SkillStore } from './store.ts';
import type {
  ActivationEvent, SkillCandidate, SkillEvaluation, SkillHead, Trace2SkillIssue,
} from './contracts.gen.ts';

export interface ActivationRequest {
  scopeKey: string;
  /** The staged candidate record, by its own id. */
  candidateId: string;
  /** The held-out evaluation that made the candidate eligible. */
  evaluationId: string;
  /** What the host registered before the evaluation ran; the evaluation must match it. */
  registration: SkillPromotionRegistration;
  /** Who asked. Recorded on the event, never consulted as authority. */
  actor: string;
}

export interface ActivationResult {
  outcome: ActivationEvent['outcome'];
  event: ActivationEvent | null;
  head: SkillHead;
  issues: Trace2SkillIssue[];
}

type ActivationFacts = Omit<ActivationEvent, 'id' | 'kind'>;

async function eventOf(facts: ActivationFacts): Promise<ActivationEvent> {
  const payload = { kind: 'activation' as const, ...facts };
  return { id: await canonicalSha256(payload as unknown as Record<string, unknown>), ...payload };
}

/** Read the candidate and the evaluation the request names, or say which is missing. */
async function recordsOf(store: Trace2SkillStore, request: ActivationRequest): Promise<Trace2SkillOutcome<{ candidate: SkillCandidate, evaluation: SkillEvaluation }>> {
  const candidates = await store.listBy(request.scopeKey, 'candidates');
  const candidate = candidates.find(row => row.id === request.candidateId);
  if (candidate === undefined) {
    return { valid: false, issues: [trace2SkillIssue('TT2S1010', `/candidates/${request.candidateId}`, 'no candidate is stored under this address in this scope')] };
  }
  const rows = await store.listBy(request.scopeKey, 'evaluations');
  const evaluation = rows.find(row => !('kind' in row) && row.id === request.evaluationId) as SkillEvaluation | undefined;
  if (evaluation === undefined) {
    return { valid: false, issues: [trace2SkillIssue('TT2S1010', `/evaluations/${request.evaluationId}`, 'no held-out evaluation is stored under this address in this scope')] };
  }
  return { valid: true, value: { candidate, evaluation } };
}

/**
 * The one explicit host call that can make a directory active. It is not a
 * workflow node: a run produces a candidate and an evaluation, and a person
 * or a host policy decides afterwards whether the head moves.
 */
export async function activateCandidate(store: Trace2SkillStore, request: ActivationRequest): Promise<ActivationResult> {
  const head = await store.head(request.scopeKey);
  const records = await recordsOf(store, request);
  if (!records.valid) return { outcome: 'refused', event: null, head, issues: records.issues };
  const { candidate, evaluation } = records.value;

  const refuse = async (issues: readonly Trace2SkillIssue[]): Promise<ActivationResult> => {
    const event = await eventOf({
      scopeKey: request.scopeKey, candidateId: candidate.id, bundleId: candidate.bundleId,
      evaluationId: evaluation.id, action: 'promote', outcome: 'refused', actor: request.actor,
      previousHead: head, nextHead: head, issues: [...issues],
    });
    const written = await store.putActivation(event);
    return {
      outcome: 'refused', event: written.valid ? written.value : event,
      head: await store.head(request.scopeKey),
      issues: written.valid ? [...issues] : [...issues, ...written.issues],
    };
  };

  const planned = planSkillPromotion(head, candidate, evaluation, request.registration);
  if (!planned.valid) return refuse(planned.issues);

  // The plan proves the candidate may move; the store's fenced transaction
  // decides whether this caller is the one that moves it.
  const swapped = await store.activate(request.scopeKey, request.registration.expectedHead, candidate.bundleId);
  if (!swapped.valid) return refuse(swapped.issues);

  const event = await eventOf({
    scopeKey: request.scopeKey, candidateId: candidate.id, bundleId: candidate.bundleId,
    evaluationId: evaluation.id, action: 'promote', outcome: 'activated', actor: request.actor,
    previousHead: head, nextHead: swapped.value, issues: [],
  });
  const written = await store.putActivation(event);
  if (!written.valid) {
    return { outcome: 'activated', event, head: swapped.value, issues: [...written.issues] };
  }
  return { outcome: 'activated', event: written.value, head: swapped.value, issues: [] };
}

export interface RollbackRequest {
  scopeKey: string;
  /** The archived directory to reinstate. It was active once; its pages are still stored. */
  bundleId: string;
  /** The head this caller believes it is moving, so a racing caller loses rather than wins twice. */
  expectedHead: SkillHead;
  /** Who asked. Recorded on the event, never consulted as authority. */
  actor: string;
}

/**
 * Reinstating the directory a scope served before. It is the same fenced swap
 * as an activation, and no evaluation makes it eligible: rolling back is an
 * explicit host decision to stop serving the current directory, which is why
 * the event may name neither a candidate nor an evaluation — a starting
 * directory a host imported was never either.
 */
export async function rollbackHead(store: Trace2SkillStore, request: RollbackRequest): Promise<ActivationResult> {
  const head = await store.head(request.scopeKey);
  const candidates = await store.listBy(request.scopeKey, 'candidates');
  const staged = candidates.find(row => row.bundleId === request.bundleId) ?? null;
  const facts = {
    scopeKey: request.scopeKey,
    candidateId: staged === null ? null : staged.id,
    bundleId: request.bundleId,
    evaluationId: null,
    action: 'rollback' as const,
    actor: request.actor,
  };
  const swapped = await store.rollback(request.scopeKey, request.expectedHead, request.bundleId);
  if (!swapped.valid) {
    const event = await eventOf({ ...facts, outcome: 'refused', previousHead: head, nextHead: head, issues: [...swapped.issues] });
    const written = await store.putActivation(event);
    return {
      outcome: 'refused', event: written.valid ? written.value : event,
      head: await store.head(request.scopeKey),
      issues: written.valid ? [...swapped.issues] : [...swapped.issues, ...written.issues],
    };
  }
  const event = await eventOf({ ...facts, outcome: 'activated', previousHead: head, nextHead: swapped.value, issues: [] });
  const written = await store.putActivation(event);
  return {
    outcome: 'activated', event: written.valid ? written.value : event,
    head: swapped.value, issues: written.valid ? [] : [...written.issues],
  };
}

/** Every activation attempt of a scope, newest decision last, refusals included. */
export async function listActivations(store: Trace2SkillStore, scopeKey: string): Promise<ActivationEvent[]> {
  const rows = await store.listBy(scopeKey, 'evaluations');
  return rows.filter((row): row is ActivationEvent => 'kind' in row && row.kind === 'activation');
}
