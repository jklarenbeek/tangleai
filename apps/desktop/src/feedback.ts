/**
 * Evidenced feedback on an assistant reply.
 *
 * A thumb is not an outcome. Every reply produced under a real config
 * identity records a DECISION the moment it is persisted; a verdict is
 * accepted only when it carries a reason and names at least one thing
 * the reply actually cited, and only then does the lifecycle in
 * `@tangleai/outcomes` run resolve → score → project, moving the cited
 * memories' confidence and answering a receipt. A bare click is refused
 * before any outcome write.
 *
 * The verdict is the OPERATOR's assertion, and it is the outcome: the
 * scorer records it verbatim and notes, as a diagnostic only, whether
 * the reply's own disposition agreed. Nothing here claims an answer got
 * better.
 *
 * Every evidence source carries the same payload — the operator asserts
 * ONE outcome, and the resolution refuses sources that disagree — so
 * what each source names lives in its id, and the pinned snapshot is
 * stored in `feedback_notes`. The trusted resolver READS that row back;
 * it never rebuilds it, so evidence that changed under a recorded
 * verdict is refused instead of silently re-agreeing with itself.
 *
 * Instants are the one place this surface normalizes: the outcome
 * schemas demand millisecond UTC precision, the desktop's clock does
 * not have to have it, and `outcomeAt` is the single translation. Every
 * command of one submission carries the SAME instant — recovered from
 * what the first submission pinned — because a request key binds its
 * whole command, and a repeat that moved its clock would bind different
 * input instead of replaying.
 */

import { canonicalSha256 } from '@jarenjs/json/canonical';
import { excerpt } from '@jarenjs/core/chunk';
import {
  adapterIdentity,
  createOutcomeService,
  domainValidator,
  outcomeRevision,
  scopeIdOf,
  type EvidenceResolver,
  type Json,
  type OutcomeAdapter,
  type OutcomeIssue,
  type OutcomeStore,
  type Result,
  type Source,
} from '@tangleai/outcomes';
import type { MemoryStore } from '@tangleai/memory';
import { asRows, type IdentityRepository, type TangleDb } from '@tangleai/store';

import schema from '../schemas/chat-answer.schema.json' with { type: 'json' };
import type { ChatMessageRecord } from './chat.ts';
import { issue, type DesktopIssue } from './issues.ts';


/** What the operator can assert about a reply. */
export const FEEDBACK_VERDICTS = ['success', 'partial', 'failure'] as const;
export type FeedbackVerdict = (typeof FEEDBACK_VERDICTS)[number];

/** What a piece of evidence can be about. A note is the operator's own words. */
export const EVIDENCE_KINDS = ['memory', 'chunk', 'note'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** The bounds the form publishes and the server re-checks anyway. */
export const FEEDBACK_CONSTRAINTS = { reasonMinChars: 12, reasonMaxChars: 1000, maxEvidence: 8 } as const;

/** This host's outcome scope and the artifact its decisions are about. */
export const FEEDBACK_SCOPE = { namespace: 'tangle-desktop', domain: 'desktop-chat-answer', subject: 'chat' } as const;
export const FEEDBACK_ARTIFACT_KEY = 'chat-answer';

/** Whose assertion a verdict is — stated in the evidence itself, not only in the UI. */
export const FEEDBACK_ISSUER = 'desktop-operator';

/** The registered baseline: this domain has no learnable artifact, only the operator's verdict. */
export const CHAT_ANSWER_POLICY = 'operator-verdict-is-the-outcome';

export type FeedbackStage = 'decision' | 'resolve' | 'score' | 'project';

/** The one spelling of a request key in this lane. */
const requestKeyFor = (messageId: string, stage: FeedbackStage): string => `${messageId}:${stage}`;

interface ChatAnswerInput extends Record<string, unknown> {
  messageId: string;
  questionDigest: string;
  disposition: 'answer' | 'refusal';
  citations: number;
}

interface ChatAnswerResolution extends Record<string, unknown> {
  verdict: FeedbackVerdict;
  reason: string;
}

/**
 * The domain this surface decides in: a reply either answered from its
 * sources or declined to, and cited so many of them. The interpreter
 * projects that straight out of the decision, so a decision reproduces
 * without consulting anything that could have moved since.
 */
export async function createChatAnswerAdapter(): Promise<OutcomeAdapter> {
  const schemas = schema.$defs;
  const input = domainValidator(schemas.input);
  const output = domainValidator(schemas.output);
  const resolution = domainValidator(schemas.resolution);
  const artifact = domainValidator(schemas.artifact);
  return Object.freeze({
    identity: await adapterIdentity('desktop-chat-answer/v1', schemas, {
      scorer: 'the operator verdict is the outcome; the reply disposition is a diagnostic',
      interpreter: 'the disposition and citation count of the decision input',
      normalization: 'none',
    }),
    schemas,
    staticPayload: { policy: CHAT_ANSWER_POLICY },
    validatePayload(raw) {
      const payload = artifact(raw) as unknown as { policy: string };
      return payload.policy === CHAT_ANSWER_POLICY
        ? []
        : [{ code: 'OUTC1010', path: '/policy', detail: 'This domain registers one baseline policy.', retryable: false } as OutcomeIssue];
    },
    interpret(raw) {
      const decided = input(raw) as unknown as ChatAnswerInput;
      return { disposition: decided.disposition, citations: decided.citations };
    },
    score(raw, evidence) {
      const answered = output(raw) as unknown as { disposition: 'answer' | 'refusal', citations: number };
      const verdict = resolution(evidence) as unknown as ChatAnswerResolution;
      return {
        outcome: verdict.verdict,
        diagnostics: {
          disposition: answered.disposition,
          citations: answered.citations,
          // an observation about this reply, never a judgement of the answer
          agreed: (answered.disposition === 'answer') === (verdict.verdict !== 'failure'),
        },
      };
    },
  } satisfies OutcomeAdapter);
}

/** One pinned evidence snapshot, exactly as the resolver must hand it back. */
export interface FeedbackNoteRow {
  id: string;
  messageId: string;
  kind: EvidenceKind;
  digest: string;
  at: string;
  text: string | null;
  source: Source;
}

export interface FeedbackNotes {
  get(sourceId: string): Promise<FeedbackNoteRow | undefined>;
  byMessage(messageId: string): Promise<FeedbackNoteRow[]>;
  /** Pin what is not pinned yet; answers how many rows were added. A stored snapshot is immutable. */
  pin(rows: readonly FeedbackNoteRow[]): Promise<number>;
}

export function createFeedbackNotes(db: TangleDb): FeedbackNotes {
  const collection = db.collection<FeedbackNoteRow>('feedback_notes');
  return {
    get: (sourceId) => collection.get(sourceId),

    async byMessage(messageId) {
      return asRows(await collection.execute<FeedbackNoteRow>({
        $for: { n: '$[*]' },
        $where: { $eq: ['$n.messageId', { $const: messageId }] },
        $orderby: '$n.id',
        $return: '$n',
      }));
    },

    async pin(rows) {
      let added = 0;
      await db.transaction(async (tx) => {
        const notes = tx.collection<FeedbackNoteRow>('feedback_notes');
        for (const row of rows) {
          if (await notes.get(row.id) !== undefined) continue;
          await notes.put(row);
          added += 1;
        }
      });
      return added;
    },
  };
}

/**
 * The trusted resolver is a GET. It supplies exactly what was pinned,
 * so a snapshot that is gone or that differs from the digest the command
 * names is refused by the lifecycle rather than reconstructed into
 * agreement with itself.
 */
export function createNoteResolver(notes: FeedbackNotes, revision: string): EvidenceResolver {
  return {
    revision,
    async resolve(reference) {
      const row = await notes.get(reference.sourceId);
      return row?.source;
    },
  };
}

/** What this host promises about the evidence it supplies, as one content address. */
export const feedbackResolverRevision = (): Promise<string> => outcomeRevision({
  resolver: 'desktop-feedback-notes/v1',
  rules: [
    'a source is the snapshot pinned when the verdict was submitted',
    'a pinned snapshot is read back, never rebuilt',
    'a source names the decision it was observed for',
  ],
});

export interface FeedbackSeams {
  db: TangleDb;
  memoryStore: MemoryStore;
  identities: IdentityRepository;
  outcomeStore: OutcomeStore;
  now: () => string;
}

/** What the chat run tells this lane about the reply it just persisted. */
export interface AnswerFacts {
  question: string;
  disposition: 'answer' | 'refusal';
}

export type DecisionOutcome =
  | { ok: true, decisionId: string }
  | { ok: false, issues: DesktopIssue[] };

export interface EvidenceOption {
  sourceId: string;
  kind: 'memory' | 'chunk';
  ref: string;
  label: string;
}

export interface FeedbackForm {
  messageId: string;
  eligible: boolean;
  decisionId: string | null;
  verdicts: readonly FeedbackVerdict[];
  evidence: EvidenceOption[];
  noteAllowed: boolean;
  constraints: typeof FEEDBACK_CONSTRAINTS;
  submitted: { at: string, verdict: FeedbackVerdict } | null;
  issues: DesktopIssue[];
}

export interface FeedbackSubmission {
  messageId: string;
  verdict: string;
  reason: string;
  evidence: ReadonlyArray<{ kind: string, ref: string }>;
  note?: string | null;
}

export interface FeedbackReceipt {
  messageId: string;
  decisionId: string;
  resolutionId: string;
  scoreId: string;
  projectionReceiptId: string;
  outcome: FeedbackVerdict;
  utility: number;
  applied: number;
  missing: number;
  changedMemoryWrites: number;
  replayed: boolean;
  writes: number;
  issues: DesktopIssue[];
}

export type FeedbackOutcome =
  | { ok: true, receipt: FeedbackReceipt }
  | { ok: false, refused: 'not-found' | 'refused', issues: DesktopIssue[] };

export interface FeedbackService {
  /** Record the decision this reply IS, so a verdict has something to resolve. */
  recordDecision(reply: ChatMessageRecord, facts: AnswerFacts): Promise<DecisionOutcome>;
  open(messageId: string): Promise<FeedbackForm | null>;
  submit(input: FeedbackSubmission): Promise<FeedbackOutcome>;
}

/** The submission marker a recorded verdict leaves on its reply. */
interface FeedbackMarker {
  at: string;
  verdict: FeedbackVerdict;
  resolutionId: string;
}

/** Service issues reach the surface verbatim; nothing here re-codes them. */
const passThrough = (issues: readonly OutcomeIssue[]): DesktopIssue[] =>
  issues.map((carried) => ({ code: carried.code, path: carried.path, detail: carried.detail }));

const refusedResult = (result: Result): OutcomeIssue[] => (result.ok ? [] : [...result.issues]);

export async function createFeedbackService(seams: FeedbackSeams): Promise<FeedbackService> {
  const chats = seams.db.collection<ChatMessageRecord & { feedback?: FeedbackMarker | null }>('chats');
  const notes = createFeedbackNotes(seams.db);
  const adapter = await createChatAnswerAdapter();
  const scopeId = await scopeIdOf(FEEDBACK_SCOPE);

  // the outcome lane is the ONE place that knows the lifecycle's
  // millisecond instants; the desktop's clock keeps its own shape
  const outcomeAt = (): string => new Date(seams.now()).toISOString();

  const service = await createOutcomeService({
    store: seams.outcomeStore,
    scope: FEEDBACK_SCOPE,
    adapters: [adapter],
    resolver: createNoteResolver(notes, await feedbackResolverRevision()),
    // a citation the store cannot show is not a citation this host will
    // let a verdict move; the answer is a pure function of the ids, so
    // the score's binding still holds when the projection re-checks it
    authorizeMemoryIds: async (ids) => {
      let allowed = true;
      for (const id of ids) if (await seams.memoryStore.get(id) === undefined) allowed = false;
      return { allowed, authorizationId: await outcomeRevision({ authorization: 'desktop-chat-citations/v1', ids: [...ids] }) };
    },
    resolveConfiguration: (identityId) => seams.identities.get(identityId),
  });

  const command = (messageId: string, stage: FeedbackStage, at: string, input: Json): Json =>
    ({ scopeId, artifactKey: FEEDBACK_ARTIFACT_KEY, requestKey: requestKeyFor(messageId, stage), at, input }) as unknown as Json;

  /** Which cited ids are memories; the rest are document chunks. */
  async function splitCitations(citations: readonly string[]): Promise<{ memories: string[], chunks: string[] }> {
    const memories: string[] = [];
    const chunks: string[] = [];
    for (const id of citations) {
      if (await seams.memoryStore.get(id) !== undefined) memories.push(id);
      else chunks.push(id);
    }
    return { memories, chunks };
  }

  const sourceIdFor = (messageId: string, kind: EvidenceKind, ref: string): string => `${kind}:${messageId}:${ref}`;

  async function sourceFor(
    messageId: string, decisionId: string, kind: EvidenceKind, ref: string, at: string, payload: ChatAnswerResolution, text: string | null,
  ): Promise<FeedbackNoteRow> {
    const bytes = {
      sourceId: sourceIdFor(messageId, kind, ref),
      decisionId,
      scopeId,
      subject: FEEDBACK_SCOPE.subject,
      issuer: FEEDBACK_ISSUER,
      observedAt: at,
      payload: payload as unknown as Json,
    };
    const source = { ...bytes, digest: await outcomeRevision(bytes) } as unknown as Source;
    return { id: bytes.sourceId, messageId, kind, digest: source.digest, at, text, source };
  }

  async function recordDecision(reply: ChatMessageRecord, facts: AnswerFacts): Promise<DecisionOutcome> {
    const identityId = reply.identityId ?? null;
    if (identityId === null) {
      return { ok: false, issues: [issue('TDSK1007', '/identityId', 'the reply ran under no config identity, so it records no decision')] };
    }
    const { memories } = await splitCitations(reply.citations ?? []);
    const at = outcomeAt();
    const input: ChatAnswerInput = {
      messageId: reply.id,
      questionDigest: await canonicalSha256({ question: facts.question }),
      disposition: facts.disposition,
      citations: (reply.citations ?? []).length,
    };
    const result = await service.create(command(reply.id, 'decision', at, {
      decisionKey: reply.id,
      adapter: adapter.identity,
      input: input as unknown as Json,
      output: adapter.interpret(input as unknown as Json, adapter.staticPayload),
      decidedAt: at,
      cutoffAt: at,
      expectedResolutionAt: null,
      memoryIds: memories,
      configuration: { kind: 'model', identityId },
      usedVersionId: null,
      staticPayload: adapter.staticPayload,
    } as unknown as Json));
    if (!result.ok) return { ok: false, issues: passThrough(result.issues) };
    const decisionId = (result.value as { decisionId?: unknown }).decisionId;
    if (typeof decisionId !== 'string') {
      return { ok: false, issues: [issue('TDSK1007', '/decisionId', 'the decision carried no address')] };
    }
    return { ok: true, decisionId };
  }

  /** Why this message cannot carry a verdict, if it cannot. */
  function ineligible(row: ChatMessageRecord | undefined): DesktopIssue | null {
    if (row === undefined) return issue('TDSK1001', '/messageId', 'no message with this id');
    if (row.role !== 'assistant') return issue('TDSK1007', '/messageId', 'only an assistant reply carries a decision');
    if ((row.identityId ?? null) === null) return issue('TDSK1007', '/messageId', 'this reply ran under no config identity');
    if (typeof row.decisionId !== 'string') return issue('TDSK1007', '/messageId', 'this reply recorded no decision');
    return null;
  }

  return {
    recordDecision,

    async open(messageId) {
      const row = await chats.get(messageId);
      if (row === undefined) return null;
      const blocker = ineligible(row);
      const { memories, chunks } = await splitCitations(row.citations ?? []);
      const evidence: EvidenceOption[] = [
        ...memories.map((id) => ({
          sourceId: sourceIdFor(messageId, 'memory', id), kind: 'memory' as const, ref: id, label: id,
        })),
        ...chunks.map((id) => ({
          sourceId: sourceIdFor(messageId, 'chunk', id), kind: 'chunk' as const, ref: id, label: id,
        })),
      ];
      const marker = row.feedback ?? null;
      return {
        messageId,
        eligible: blocker === null,
        decisionId: typeof row.decisionId === 'string' ? row.decisionId : null,
        verdicts: FEEDBACK_VERDICTS,
        evidence,
        noteAllowed: true,
        constraints: FEEDBACK_CONSTRAINTS,
        submitted: marker === null ? null : { at: marker.at, verdict: marker.verdict },
        issues: blocker === null ? [] : [blocker],
      };
    },

    async submit(input) {
      const row = await chats.get(input.messageId);
      if (row === undefined) {
        return { ok: false, refused: 'not-found', issues: [issue('TDSK1001', '/messageId', 'no message with this id')] };
      }
      const blocker = ineligible(row);
      if (blocker !== null) return { ok: false, refused: 'refused', issues: [blocker] };
      const decisionId = row.decisionId as string;

      const verdict = input.verdict as FeedbackVerdict;
      const reason = input.reason.trim();
      const note = (input.note ?? '').trim();
      const refusals: DesktopIssue[] = [];
      if (!FEEDBACK_VERDICTS.includes(verdict)) refusals.push(issue('TDSK1006', '/verdict', 'a verdict is one of success, partial or failure'));
      if (reason.length < FEEDBACK_CONSTRAINTS.reasonMinChars) {
        refusals.push(issue('TDSK1006', '/reason', `a reason of at least ${FEEDBACK_CONSTRAINTS.reasonMinChars} characters says what happened; this one has ${reason.length}`));
      }
      if (reason.length > FEEDBACK_CONSTRAINTS.reasonMaxChars) {
        refusals.push(issue('TDSK1006', '/reason', `a reason is at most ${FEEDBACK_CONSTRAINTS.reasonMaxChars} characters; this one has ${reason.length}`));
      }
      if (input.evidence.length === 0) refusals.push(issue('TDSK1006', '/evidence', 'a verdict names at least one thing it is about'));
      if (input.evidence.length > FEEDBACK_CONSTRAINTS.maxEvidence) {
        refusals.push(issue('TDSK1006', '/evidence', `at most ${FEEDBACK_CONSTRAINTS.maxEvidence} evidence references; this submission carries ${input.evidence.length}`));
      }
      if (refusals.length > 0) return { ok: false, refused: 'refused', issues: refusals };

      const cited = new Set(row.citations ?? []);
      const seen = new Set<string>();
      const pending: Array<{ kind: EvidenceKind, ref: string, text: string | null }> = [];
      for (const reference of input.evidence) {
        const kind = reference.kind as EvidenceKind;
        if (kind === 'note') {
          if (note === '') { refusals.push(issue('TDSK1006', '/note', 'a note reference needs the typed note it is about')); continue; }
          pending.push({ kind, ref: await canonicalSha256({ note }), text: note });
          continue;
        }
        if (!EVIDENCE_KINDS.includes(kind)) { refusals.push(issue('TDSK1006', '/evidence', `unknown evidence kind ${kind}`)); continue; }
        if (!cited.has(reference.ref)) {
          refusals.push(issue('TDSK1006', '/evidence', `the reply did not cite ${excerpt(reference.ref, 80)}`));
          continue;
        }
        pending.push({ kind, ref: reference.ref, text: null });
      }
      for (const entry of pending) {
        const id = sourceIdFor(input.messageId, entry.kind, entry.ref);
        if (seen.has(id)) refusals.push(issue('TDSK1006', '/evidence', 'evidence references must be distinct'));
        seen.add(id);
      }
      if (refusals.length > 0) return { ok: false, refused: 'refused', issues: refusals };

      // every command of one submission carries the instant the first one
      // pinned: a request key binds its whole command, and a moved clock
      // would bind different input instead of replaying
      const marker = row.feedback ?? null;
      const pinned = await notes.byMessage(input.messageId);
      const at = marker?.at
        ?? pinned.reduce<string | null>((earliest, note_) => (earliest === null || note_.at < earliest ? note_.at : earliest), null)
        ?? outcomeAt();

      const payload: ChatAnswerResolution = { verdict, reason };
      const sources: FeedbackNoteRow[] = [];
      for (const entry of pending) sources.push(await sourceFor(input.messageId, decisionId, entry.kind, entry.ref, at, payload, entry.text));
      // a recorded verdict closes its evidence: the snapshot it named is
      // what any later reading must find, or the lifecycle refuses it
      if (marker === null) await notes.pin(sources);

      const evidence = sources
        .map((source) => ({ sourceId: source.id, digest: source.digest }))
        .sort((a, b) => (a.sourceId < b.sourceId ? -1 : 1));

      const resolved = await service.resolve(command(input.messageId, 'resolve', at, { decisionId, evidence, receivedAt: at } as unknown as Json));
      if (!resolved.ok) return { ok: false, refused: 'refused', issues: [issue('TDSK1006', '/verdict', 'the outcome lifecycle refused this resolution'), ...passThrough(refusedResult(resolved))] };
      const resolutionId = String((resolved.value as { resolutionId: unknown }).resolutionId);

      const scored = await service.score(command(input.messageId, 'score', at, { resolutionId } as unknown as Json));
      if (!scored.ok) return { ok: false, refused: 'refused', issues: [issue('TDSK1006', '/verdict', 'the outcome lifecycle refused this score'), ...passThrough(refusedResult(scored))] };
      const scoreId = String((scored.value as { scoreId: unknown }).scoreId);

      const projected = await service.project(command(input.messageId, 'project', at, { scoreId } as unknown as Json));
      if (!projected.ok) return { ok: false, refused: 'refused', issues: [issue('TDSK1006', '/verdict', 'the outcome lifecycle refused this projection'), ...passThrough(refusedResult(projected))] };
      const receipt = projected.value as { projectionReceiptId: string, applied: number, missing: number, changedMemoryWrites: number };

      // the outcome and its utility are read back from what the score
      // recorded, so the surface shows the stored number rather than one
      // it derived a second time
      const inspected = await service.inspect({ scopeId, artifactKey: FEEDBACK_ARTIFACT_KEY, input: { id: scoreId } } as unknown as Json);
      if (!inspected.ok) return { ok: false, refused: 'refused', issues: passThrough(refusedResult(inspected)) };
      const score = inspected.value as unknown as { outcome: FeedbackVerdict, utility: number };

      if (marker === null) {
        await chats.put({ ...row, feedback: { at, verdict: score.outcome, resolutionId } });
      }

      return {
        ok: true,
        receipt: {
          messageId: input.messageId,
          decisionId,
          resolutionId,
          scoreId,
          projectionReceiptId: receipt.projectionReceiptId,
          outcome: score.outcome,
          utility: score.utility,
          applied: receipt.applied,
          missing: receipt.missing,
          changedMemoryWrites: receipt.changedMemoryWrites,
          replayed: resolved.replayed && scored.replayed && projected.replayed,
          writes: resolved.writes + scored.writes + projected.writes,
          issues: [],
        },
      };
    },
  };
}
