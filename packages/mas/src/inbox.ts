/**
 * Paused runs in a review inbox. A run that reaches an interaction node waits
 * durably for a typed response; this file turns each waiting interaction into
 * a proposal a desktop's inbox shows (its prompt, and a form drawn from its
 * response schema), and the person's answer back into the store's response,
 * so the run resumes. It runs where the store is, on the application's
 * server, and imports nothing of a desktop: the application files the
 * proposals over its own connection and refiles them after a reload.
 *
 * The response key is derived from the interaction and its revision, so an
 * answer sent twice is one answer, and a different answer to the same pause
 * is refused by the store.
 */
import type { MasInteraction } from './contracts.gen.ts';
import type { MasStore } from './store.ts';

/** A proposal document as a desktop's inbox takes it (`@tangleai/os`'s PROPOSAL_SCHEMA). */
export type InteractionProposal = {
  id: string, kind: string, title: string, summary?: string, revision: string, origin: 'ai',
  payload: { runId: string, node: string, path: string },
  answer: { schema: Record<string, unknown> | boolean, label?: string },
};

const text = (value: unknown, max: number) => (typeof value === 'string' ? value : JSON.stringify(value) ?? '').slice(0, max);

/**
 * One waiting interaction as a proposal of `kind` (a kind the filing
 * application declares). A string prompt is its title (a long one its
 * summary too); any other prompt is its summary, as JSON text.
 */
export function interactionProposal(interaction: MasInteraction, options: { kind: string, title?: string, answerLabel?: string }): InteractionProposal {
  const prompt = interaction.prompt;
  const short = typeof prompt === 'string' && prompt.length <= 200 ? prompt : undefined;
  const summary = short === undefined ? text(prompt, 2000) : undefined;
  return {
    id: interaction.id, kind: options.kind,
    title: short ?? options.title ?? 'A run is waiting for your answer',
    ...(summary ? { summary } : {}),
    revision: String(interaction.revision), origin: 'ai',
    payload: { runId: interaction.runId, node: interaction.node, path: interaction.path },
    answer: { schema: interaction.responseSchema, ...(options.answerLabel ? { label: options.answerLabel } : {}) },
  };
}

/** Every paused run's interaction, as proposals to file. */
export async function waitingProposals(store: Pick<MasStore, 'listWaitingInteractions'>, options: { kind: string, title?: string, answerLabel?: string }): Promise<InteractionProposal[]> {
  return (await store.listWaitingInteractions()).map(interaction => interactionProposal(interaction, options));
}

/** The response key of one answer: the interaction and the revision it answers, never random. */
export const inboxResponseKey = (interactionId: string, revision: number) => `inbox:${interactionId}:${revision}`;

/**
 * Carry out the person's decision on a paused run: an answer becomes the
 * interaction's response (the run then waits to resume: the host queues it
 * with `ensurePendingMasSegments`), a rejection cancels the interaction. A
 * pause that moved meanwhile (answered elsewhere, expired, cancelled) is
 * refused with the store's reason, so the inbox keeps it pending and says why.
 */
export async function decideInteraction(store: Pick<MasStore, 'respondInteraction' | 'resolveInteraction'>, decision: { id: string, decision: 'accept' | 'reject' | 'answer', revision?: string, response?: unknown }): Promise<{ refused?: string, resume?: boolean }> {
  const revision = Number(decision.revision);
  if (!Number.isInteger(revision) || revision < 0) return { refused: 'the pause carries no revision to answer' };
  if (decision.decision === 'reject') {
    const resolved = await store.resolveInteraction(decision.id, 'cancelled', revision);
    return resolved.ok ? {} : { refused: resolved.issue.detail };
  }
  if (decision.decision !== 'answer') return { refused: 'a paused run takes an answer, not an acceptance' };
  const responded = await store.respondInteraction(decision.id, decision.response ?? null, revision, inboxResponseKey(decision.id, revision));
  return responded.ok ? { resume: true } : { refused: responded.issue.detail };
}
