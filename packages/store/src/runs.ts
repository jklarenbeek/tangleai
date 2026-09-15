/**
 * The run log — what makes a run watchable while it happens and
 * readable forever after.
 *
 * A run is one pass of some pipeline; a FRAME is one thing that run
 * did, addressed by `(runId, seq)`. Frames are append-only, never
 * pruned, and their `seq` is read from the store inside the appending
 * transaction — so a restart, a second process or two concurrent
 * appends cannot mint the same address twice. `id` is
 * `<runId>:<seq padded to 8>`, which keeps lexicographic id order equal
 * to frame order.
 *
 * That one sequence is what a subscriber resumes by: the live query's
 * own emission carries the store-wide capture seq, and `subscribeRun`
 * re-emits it under the appended frame's seq so `replayPage` — which
 * pages the same rows by `(runId, seq)` — means the identical thing to
 * a reconnecting consumer. A run's terminal state is a frame too,
 * written in the same transaction as the run row, so "finished" and
 * "said it finished" cannot disagree.
 *
 * The older `events` collection holds the node records of runs written
 * before frames existed; it is read-only here. A run has rows in
 * exactly one of the two, and `getRun` answers the union.
 */

import { hashContent } from '@jarenjs/core/string';
import { JarenValidator } from '@jarenjs/validate';
import { callerError } from '@tangleai/core/errors';

import type { TangleDb } from './db.ts';
import { asRows } from './memory-store.ts';

export interface RunRecord {
  id: string;
  kind: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'ok' | 'error' | 'cancelled';
  summary: any;
  /** The content-addressed config identity that produced this run. Absent on rows written before identities were recorded. */
  identityId?: string;
}

/** How a run relates to the identity table when read back. */
export type RunIdentityStatus = 'run' | 'legacy-unrecorded';

/** A run row as reads return it: the stored record plus its honest identity status. */
export type RunView = RunRecord & { identityStatus: RunIdentityStatus };

export interface RunEvent {
  id: string;
  runId: string;
  seq: number;
  node: string;
  status: string;
  ms: number;
  at: string;
}

/**
 * What a frame can be. Each kind's body is closed by `FRAME_BODIES` and
 * validated at append, so the wire may carry a plain object while the
 * store still refuses a body nobody declared.
 */
export const FRAME_KINDS = [
  'node', 'identity', 'retrieval', 'delta', 'usage', 'degraded', 'answer', 'status', 'sync',
  'progress', 'report',
] as const;

export type FrameKind = typeof FRAME_KINDS[number];

export interface RunFrame {
  id: string;
  runId: string;
  seq: number;
  at: string;
  kind: FrameKind;
  body: Record<string, unknown>;
}

/**
 * The closed body shape per kind. A frame never carries a credential, a
 * raw key, a full prompt or a replay-cache key: `identity` is the
 * identity's address alone, `retrieval` is counts and candidate ids
 * rather than texts, `degraded` carries an excerpt, and `progress`
 * carries a bounded batch of truncated output lines plus the number a
 * producer had to drop rather than grow the stream without limit.
 */
export const FRAME_BODIES: Record<FrameKind, Record<string, unknown>> = {
  node: {
    type: 'object', required: ['node', 'status', 'ms'], additionalProperties: false,
    properties: { node: { type: 'string' }, status: { type: 'string' }, ms: { type: 'number' } },
  },
  identity: {
    type: 'object', required: ['identityId'], additionalProperties: false,
    properties: { identityId: { type: 'string', pattern: '^[0-9a-f]{64}$' } },
  },
  retrieval: {
    type: 'object', required: ['memories', 'documentChunks', 'skippedDocuments', 'candidates'], additionalProperties: false,
    properties: {
      memories: { type: 'integer', minimum: 0 },
      documentChunks: { type: 'integer', minimum: 0 },
      skippedDocuments: { type: 'integer', minimum: 0 },
      candidates: { type: 'array', items: { type: 'string' } },
    },
  },
  delta: {
    type: 'object', required: ['text', 'chars'], additionalProperties: false,
    properties: { text: { type: 'string' }, chars: { type: 'integer', minimum: 0 } },
  },
  usage: { type: 'object', required: ['usage'], additionalProperties: false, properties: { usage: {} } },
  degraded: {
    type: 'object', required: ['reason', 'detail'], additionalProperties: false,
    properties: { reason: { enum: ['wire', 'invalid', 'refused', 'no-model', 'embedding'] }, detail: { type: 'string' } },
  },
  answer: {
    type: 'object', required: ['messageId', 'citations', 'provider'], additionalProperties: false,
    properties: {
      messageId: { type: 'string' },
      citations: { type: 'array', items: { type: 'string' } },
      provider: { type: ['string', 'null'] },
    },
  },
  status: {
    type: 'object', required: ['status', 'summary'], additionalProperties: false,
    properties: { status: { enum: ['ok', 'error', 'cancelled'] }, summary: {} },
  },
  sync: {
    type: 'object',
    required: ['trigger', 'scanned', 'ingested', 'skipped', 'removed', 'truncated', 'orphanedUnits'],
    additionalProperties: false,
    properties: {
      trigger: { enum: ['manual', 'start', 'change', 'overflow', 'tick'] },
      scanned: { type: 'integer', minimum: 0 },
      ingested: { type: 'integer', minimum: 0 },
      skipped: { type: 'integer', minimum: 0 },
      removed: { type: 'integer', minimum: 0 },
      truncated: { type: 'integer', minimum: 0 },
      orphanedUnits: { type: 'integer', minimum: 0 },
    },
  },
  progress: {
    type: 'object', required: ['lines', 'stream', 'suppressed'], additionalProperties: false,
    properties: {
      lines: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', maxLength: 240 } },
      stream: { enum: ['out', 'err'] },
      suppressed: { type: 'integer', minimum: 0 },
    },
  },
  report: {
    type: 'object',
    required: ['reportId', 'instrument', 'schemaId', 'bytes', 'stored', 'files', 'runId'],
    additionalProperties: false,
    properties: {
      reportId: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      instrument: { type: 'string' },
      schemaId: { type: 'string' },
      bytes: { type: 'integer', minimum: 0 },
      stored: { enum: ['new', 'unchanged'] },
      files: { type: 'integer', minimum: 0 },
      // the run whose pass stored this document: this run when it is
      // new, the earlier one when an identical document is already held
      runId: { type: 'string', minLength: 1 },
    },
  },
};

/**
 * The ceiling on one serialized frame body. It exists so a replay page
 * can always carry at least one whole frame inside the byte bound the
 * stream binding asks for: a frame nobody can page is a frame a
 * reconnecting consumer would silently lose.
 */
export const MAX_FRAME_BODY_BYTES = 65_536;

/** Why an append was refused, as a value. */
export type FrameRefusalCode = 'TDSK1001' | 'TDSK1002' | 'TDSK1003';

export type AppendFrameOutcome =
  | { ok: true, frame: RunFrame }
  | { ok: false, code: FrameRefusalCode, reason: string };

/** One page of the frames above a cursor, in the shape a stream binding's `replay` takes. */
export interface FrameReplayPage {
  items: Array<{ patch: Array<Record<string, unknown>>, seq: number }>;
  next?: number;
  earliestAvailable: number | null;
  highWatermark: number;
  hasMore: boolean;
  resetRequired: boolean;
}

/** The duck a subscribe handler returns: a snapshot, an emission stream, a release, and optionally a replay. */
export interface RunSubscription {
  snapshot(): { rows: readonly unknown[] };
  subscribe(observer: (emission: unknown) => void): () => void;
  close(): void;
  replay?(after: number, options: { limit: number, maxBytes: number, signal?: AbortSignal }): Promise<FrameReplayPage | null>;
}

export interface RunLog {
  startRun(kind: string, options?: { identityId?: string }): Promise<RunRecord>;
  recordEvent(runId: string, record: { id: string, status: string, ms: number }): Promise<RunEvent>;
  /** Append one frame to a running run; a refusal is a value with a code. */
  appendFrame(runId: string, frame: { kind: FrameKind, body: Record<string, unknown> }): Promise<AppendFrameOutcome>;
  /** Attach the finalized identity to a running run — before any corpus write it authorizes. */
  attachIdentity(runId: string, identityId: string): Promise<void>;
  finishRun(runId: string, status: 'ok' | 'error' | 'cancelled', summary?: any): Promise<{ ok: true } | { ok: false, reason: string }>;
  listRuns(limit?: number): Promise<RunView[]>;
  getRun(id: string): Promise<{ run: RunView, events: RunEvent[], frames: number } | undefined>;
  /** The run's frames above `after`, ascending. */
  frames(runId: string, options?: { after?: number, limit?: number }): Promise<RunFrame[]>;
  replayPage(runId: string, after: number, options: { limit: number, maxBytes: number, signal?: AbortSignal }): Promise<FrameReplayPage | null>;
  subscribeRun(runId: string): Promise<RunSubscription>;
  subscribeRuns(options?: { limit?: number }): Promise<RunSubscription>;
}

export interface RunLogOptions {
  now?: () => string;
  /**
   * Run kinds that must carry a config identity by the time they
   * finish. A finish without one is refused as a value: the run is
   * closed as an error naming the absence, never silently completed —
   * a run that cannot say what stack produced it is not "ok".
   */
  configAwareKinds?: readonly string[];
}

const pad8 = (n: number): string => String(n).padStart(8, '0');

/** A frame's address: lexicographic id order is frame order. */
export const frameIdOf = (runId: string, seq: number): string => `${runId}:${pad8(seq)}`;

const viewOf = (run: RunRecord): RunView => ({
  ...run,
  identityStatus: typeof run.identityId === 'string' ? 'run' : 'legacy-unrecorded',
});

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

const eventOf = (frame: RunFrame): RunEvent => ({
  id: frame.id,
  runId: frame.runId,
  seq: frame.seq,
  node: String(frame.body.node ?? ''),
  status: String(frame.body.status ?? ''),
  ms: Number(frame.body.ms ?? 0),
  at: frame.at,
});

const framesAscending = (runId: string, after: number): Record<string, unknown> => ({
  $for: { f: '$[*]' },
  $where: { $and: [{ $eq: ['$f.runId', { $const: runId }] }, { $gt: ['$f.seq', { $const: after }] }] },
  $orderby: '$f.seq',
  $return: '$f',
});

const framesDescending = (runId: string): Record<string, unknown> => ({
  $for: { f: '$[*]' },
  $where: { $eq: ['$f.runId', { $const: runId }] },
  $orderby: { $key: '$f.seq', $dir: 'desc' },
  $return: '$f',
});

/** The live frame window of one run — ascending, so an append is an `add`. */
const framesLive = (runId: string): Record<string, unknown> => ({
  $for: { f: '$[*]' },
  $where: { $eq: ['$f.runId', { $const: runId }] },
  $orderby: '$f.seq',
  $return: '$f',
});

const runsNewestFirst = {
  $for: { r: '$[*]' }, $orderby: { $key: '$r.startedAt', $dir: 'desc' }, $return: '$r',
} as const;

/**
 * The highest frame seq an emission's patch added. Frames are
 * append-only, so every emission is `add` ops carrying whole rows; an
 * emission that carries no addable seq cannot be rebased onto the frame
 * sequence at all, and is reported rather than forwarded under a
 * foreign number.
 */
function addedSeq(patch: unknown): number | null {
  if (!Array.isArray(patch)) return null;
  let top: number | null = null;
  for (const op of patch) {
    const value = (op as { value?: unknown } | null)?.value as { seq?: unknown } | undefined;
    const seq = value?.seq;
    if (typeof seq === 'number' && Number.isFinite(seq) && (top === null || seq > top)) top = seq;
  }
  return top;
}

export function createRunLog(db: TangleDb, options: RunLogOptions = {}): RunLog {
  const now = options.now ?? ((): string => new Date().toISOString());
  const configAware = new Set(options.configAwareKinds ?? []);
  const runs = db.collection<RunRecord>('runs');
  const events = db.collection<RunEvent>('events');
  const runFrames = db.collection<RunFrame>('run_frames');
  let sequence = 0;

  const validator = new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' });
  const bodyValidators = new Map<FrameKind, (value: unknown) => { valid: boolean, errors?: unknown[] }>(
    FRAME_KINDS.map((kind) => [kind, validator.compile(FRAME_BODIES[kind]) as (value: unknown) => { valid: boolean, errors?: unknown[] }]),
  );

  /** The body a frame may carry, or the reason it may not. */
  function checkBody(kind: FrameKind, body: unknown): string | null {
    const validate = bodyValidators.get(kind);
    if (validate === undefined) return `'${String(kind)}' is not a frame kind`;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return `a ${kind} frame body must be an object`;
    const outcome = validate(body);
    if (outcome.valid !== true) return `a ${kind} frame body does not validate: ${JSON.stringify(outcome.errors ?? [])}`;
    const bytes = utf8Bytes(JSON.stringify(body));
    if (bytes > MAX_FRAME_BODY_BYTES) return `a ${kind} frame body is ${bytes} bytes, over the ${MAX_FRAME_BODY_BYTES} one frame may carry`;
    return null;
  }

  /**
   * Append inside a transaction that already holds the run. The seq is
   * read here, not remembered: the transaction is the serialization
   * point, so two concurrent appends for one run cannot share an
   * address.
   */
  async function appendWithin(tx: { collection: <T>(name: string) => any }, runId: string, kind: FrameKind, body: Record<string, unknown>): Promise<RunFrame> {
    const collection = tx.collection<RunFrame>('run_frames');
    const top = asRows<RunFrame>(await collection.execute({ $subsequence: [framesDescending(runId), 0, 1] }));
    const seq = (top[0]?.seq ?? 0) + 1;
    const frame: RunFrame = { id: frameIdOf(runId, seq), runId, seq, at: now(), kind, body };
    await collection.put(frame);
    return frame;
  }

  async function framesOf(runId: string, after = 0, limit = 500): Promise<RunFrame[]> {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new TypeError('frame limit must be a non-negative integer');
    if (limit === 0) return [];
    const rows: RunFrame[] = [];
    const cursor = runFrames.query<RunFrame>(framesAscending(runId, after));
    for await (const row of cursor) {
      rows.push(row);
      if (rows.length === limit) break;
    }
    return rows;
  }

  return {
    async startRun(kind, startOptions = {}) {
      const startedAt = now();
      sequence += 1;
      const id = `r-${hashContent(`${startedAt}|${kind}|${sequence}`)}`;
      const run: RunRecord = { id, kind, startedAt, finishedAt: null, status: 'running', summary: null };
      if (startOptions.identityId !== undefined) run.identityId = startOptions.identityId;
      await runs.put(run);
      return run;
    },

    async attachIdentity(runId, identityId) {
      const run = await runs.get(runId);
      if (run === undefined) return;
      await runs.put({ ...run, identityId });
    },

    async appendFrame(runId, frame) {
      const invalid = checkBody(frame.kind, frame.body);
      if (invalid !== null) return { ok: false as const, code: 'TDSK1003' as const, reason: invalid };
      return db.transaction(async (tx) => {
        const run = await tx.collection<RunRecord>('runs').get(runId);
        if (run === undefined) return { ok: false as const, code: 'TDSK1001' as const, reason: `run '${runId}' does not exist` };
        if (run.status !== 'running') {
          return { ok: false as const, code: 'TDSK1002' as const, reason: `run '${runId}' already finished as '${run.status}'` };
        }
        return { ok: true as const, frame: await appendWithin(tx, runId, frame.kind, frame.body) };
      }, { mode: 'immediate' });
    },

    async recordEvent(runId, record) {
      const outcome = await this.appendFrame(runId, {
        kind: 'node',
        body: { node: record.id, status: record.status, ms: record.ms },
      });
      // a node record for a run that does not exist or has already
      // finished is a caller bug, not a content boundary
      if (!outcome.ok) throw callerError(`run event refused (${outcome.code}): ${outcome.reason}`);
      return eventOf(outcome.frame);
    },

    async finishRun(runId, status, summary = null) {
      return db.transaction(async (tx) => {
        const collection = tx.collection<RunRecord>('runs');
        const run = await collection.get(runId);
        if (run === undefined) return { ok: false as const, reason: `run '${runId}' does not exist` };
        if (run.status !== 'running') return { ok: false as const, reason: `run '${runId}' already finished as '${run.status}'` };
        if (status === 'ok' && configAware.has(run.kind) && run.identityId === undefined) {
          const reason = 'the run carries no config identity; a config-aware run cannot complete without saying what stack produced it';
          const refused = { ...(summary ?? {}), refused: reason };
          await collection.put({ ...run, finishedAt: now(), status: 'error', summary: refused });
          await appendWithin(tx, runId, 'status', { status: 'error', summary: refused });
          return { ok: false as const, reason };
        }
        await collection.put({ ...run, finishedAt: now(), status, summary });
        await appendWithin(tx, runId, 'status', { status, summary });
        return { ok: true as const };
      }, { mode: 'immediate' });
    },

    async listRuns(limit = 50) {
      if (!Number.isSafeInteger(limit) || limit < 0) throw new TypeError('run limit must be a non-negative integer');
      if (limit === 0) return [];
      const rows: RunView[] = [];
      const cursor = runs.query<RunRecord>(runsNewestFirst);
      for await (const row of cursor) {
        rows.push(viewOf(row));
        if (rows.length === limit) break;
      }
      return rows;
    },

    /**
     * The run and what it did. A run's node records live in exactly one
     * source — the legacy `events` rows for runs written before frames,
     * the `node` frames for every run since — so the concatenation below
     * is a union of disjoint sets, not a merge.
     */
    async getRun(id) {
      const run = await runs.get(id);
      if (run === undefined) return undefined;
      const legacy = asRows(await events.execute<RunEvent>({
        $for: { e: '$[*]' },
        $where: { $eq: ['$e.runId', { $const: id }] },
        $orderby: '$e.seq',
        $return: '$e',
      }));
      const rows = await framesOf(id, 0, Number.MAX_SAFE_INTEGER);
      const recorded = rows.filter((frame) => frame.kind === 'node').map(eventOf);
      return { run: viewOf(run), events: [...legacy, ...recorded], frames: rows.length };
    },

    frames(runId, frameOptions = {}) {
      return framesOf(runId, frameOptions.after ?? 0, frameOptions.limit ?? 500);
    },

    /**
     * One page of the frames above `after`. Frames are never pruned, so
     * `resetRequired` is always false and a cursor can never fall below
     * the retention floor; an unknown run answers null, which the stream
     * binding reads as "this cursor cannot be replayed at all".
     */
    async replayPage(runId, after, pageOptions) {
      if ((await runs.get(runId)) === undefined) return null;
      pageOptions.signal?.throwIfAborted();
      const limit = Math.max(1, pageOptions.limit);
      const window = await framesOf(runId, after, limit + 1);
      const hasMore = window.length > limit;
      const bounded = window.slice(0, limit);
      const items: FrameReplayPage['items'] = [];
      let bytes = 0;
      for (const frame of bounded) {
        const patch = [{ op: 'add', path: '/rows/-', value: frame }];
        const size = utf8Bytes(JSON.stringify(patch));
        // the first frame always ships: a page that could carry none
        // would end the replay and lose every frame above it silently
        if (items.length > 0 && bytes + size > pageOptions.maxBytes) break;
        bytes += size;
        items.push({ patch, seq: frame.seq });
      }
      const all = await framesOf(runId, 0, Number.MAX_SAFE_INTEGER);
      const last = items.at(-1);
      return {
        items,
        next: last === undefined ? after : last.seq,
        earliestAvailable: all[0]?.seq ?? null,
        highWatermark: all.at(-1)?.seq ?? 0,
        hasMore: hasMore || items.length < bounded.length,
        resetRequired: false,
      };
    },

    /**
     * One run's frames, live. The emission's own `seq` is the
     * store-wide capture record's; it is re-emitted under the appended
     * frame's seq so that a `Last-Event-ID` means the same thing here
     * and in `replayPage`.
     */
    async subscribeRun(runId) {
      const live = await runFrames.live(framesLive(runId));
      return {
        snapshot: () => live.result,
        subscribe: (observer) => live.subscribe((emission: any) => {
          if (emission !== null && typeof emission === 'object' && 'error' in emission && emission.error !== undefined) {
            const code = (emission.error as { code?: unknown } | null)?.code;
            observer(code === 'JD2060'
              ? { error: { code: 'overflow', cause: emission.error } }
              : emission);
            return;
          }
          const seq = addedSeq(emission?.patch);
          if (seq === null) {
            observer({ error: new TypeError('an append-only frame stream emitted a change that adds no frame') });
            return;
          }
          observer({ patch: emission.patch, seq });
        }),
        close: () => live.close(),
        replay: (after, replayOptions) => this.replayPage(runId, after, replayOptions),
      };
    },

    /**
     * The run table, live and newest first. Rows carry their identity
     * status exactly as `listRuns` answers it, in the snapshot and in
     * every emission alike.
     */
    async subscribeRuns(subscribeOptions = {}) {
      const limit = subscribeOptions.limit ?? 50;
      if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('run window limit must be a positive integer');
      const live = await runs.live({ $subsequence: [runsNewestFirst, 0, limit] });
      const project = (patch: unknown): unknown => (Array.isArray(patch)
        ? patch.map((op) => (op !== null && typeof op === 'object' && 'value' in (op as object)
          ? { ...(op as object), value: viewOf((op as { value: RunRecord }).value) }
          : op))
        : patch);
      return {
        snapshot: () => ({ rows: (live.result.rows as RunRecord[]).map(viewOf) }),
        subscribe: (observer) => live.subscribe((emission: any) => {
          if (emission !== null && typeof emission === 'object' && 'error' in emission && emission.error !== undefined) {
            observer(emission);
            return;
          }
          observer({ patch: project(emission.patch), seq: emission.seq });
        }),
        close: () => live.close(),
      };
    },
  };
}
