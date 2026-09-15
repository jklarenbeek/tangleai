/**
 * Evidenced feedback, through the wire the UI uses.
 *
 * The property under test is that a thumb cannot become an outcome on
 * its own: a submission without evidence, without a reason, or naming
 * something the reply never cited is refused before anything reaches
 * the outcome tables, and the tables are COUNTED afterwards rather than
 * the response believed. What a complete submission produces — the
 * verdict recorded as the outcome, the cited memories' confidence moved,
 * the receipt's applied/missing/changed numbers, and the replay pair —
 * is read back from what was stored.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { nodeDriver } from '@jarenjs/db/node';
import { createMemoryOutcomeStore, createOutcomeService, outcomeRevision, scopeIdOf } from '@tangleai/outcomes';
import { asRows } from '@tangleai/store';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';

import { createDesktop, type Desktop } from '../../apps/desktop/src/server.ts';
import {
  createChatAnswerAdapter,
  createFeedbackNotes,
  createNoteResolver,
  feedbackResolverRevision,
  FEEDBACK_ARTIFACT_KEY,
  FEEDBACK_CONSTRAINTS,
  FEEDBACK_ISSUER,
  FEEDBACK_SCOPE,
  type FeedbackNoteRow,
} from '../../apps/desktop/src/feedback.ts';

let tick = 0;
/** Second precision on purpose: the outcome lane must normalize it, and nothing else may. */
const now = (): string => `2026-08-24T14:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick++ % 60).padStart(2, '0')}Z`;

const MILLISECOND_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

async function call(desktop: Desktop, method: string, url: string, body?: any): Promise<{ status: number, json: any }> {
  const response = await desktop.dispatcher.dispatch({
    method,
    url,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const text = typeof response.body === 'string'
    ? response.body
    : response.body === null ? '' : new TextDecoder().decode(response.body);
  return { status: response.status, json: text === '' ? null : JSON.parse(text) };
}

const rowsOf = async (desktop: Desktop, collection: string): Promise<any[]> =>
  asRows(await desktop.db.collection<any>(collection).execute<any>({ $for: { r: '$[*]' }, $return: '$r' }));

const issuesOf = (answer: { json: any }): Array<{ code: string, path: string, detail: string }> =>
  answer.json?.details?.issues ?? [];

const REASON = 'the rate limit line is exactly what I asked for';

describe('evidenced outcome feedback', () => {
  let desktop: Desktop;
  let folder: string;
  let messageId: string;
  let form: any;
  let evidence: Array<{ kind: string, ref: string }>;

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), 'tangle-feedback-'));
    await writeFile(join(folder, 'ops.md'), [
      'The staging database lives on host db-staging.internal port 5432',
      '',
      'The API rate limit is 100 requests per minute',
    ].join('\n'));
    // a document lane too, so the reply cites both kinds of source and the
    // decision's memory ids can be told apart from its evidence
    const page = async (url: any): Promise<Response> => new Response(
      `<!doctype html><html><body><main><h1>Rate limit handbook</h1><p>${String(url)} documents the API rate limit of 100 requests per minute that every production client is held to, and the verified operational procedure behind it.</p></main></body></html>`,
      { headers: { 'content-type': 'text/html' } },
    );

    desktop = await createDesktop({
      driver: nodeDriver(),
      now,
      fetch: page as any,
      presetSettings: { folder },
      documentFetch: {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        limits: { respectRobots: false, perHostDelayMs: 0 },
      },
    });
    const sync = await call(desktop, 'POST', '/api/folder/sync', {});
    assert.equal(sync.status, 200);
    const ingest = await call(desktop, 'POST', '/api/documents/ingest', { url: 'https://alpha.example/handbook' });
    assert.equal(ingest.status, 200);
    const chat = await call(desktop, 'POST', '/api/chat', { text: 'what is the rate limit?' });
    assert.equal(chat.status, 200);
    messageId = chat.json.reply.id;
    form = (await call(desktop, 'GET', `/api/feedback?messageId=${encodeURIComponent(messageId)}`)).json;
    // one of each kind, so a chunk is proven admissible as evidence
    const first = (kind: string): any => form.evidence.find((option: any) => option.kind === kind);
    evidence = [first('memory'), first('chunk')]
      .filter((option: any) => option !== undefined)
      .map((option: any) => ({ kind: option.kind, ref: option.ref }));
  });

  after(async () => {
    await desktop.close();
    await rm(folder, { recursive: true, force: true });
  });

  it('records the decision a verdict can resolve, and offers what the reply cited', async () => {
    const chats = await rowsOf(desktop, 'chats');
    const reply = chats.find((row) => row.id === messageId);
    assert.equal(typeof reply.decisionId, 'string', 'the reply carries the decision it is');
    assert.equal(reply.identityId !== null, true, 'a decision needs a registered configuration');

    assert.equal(form.eligible, true);
    assert.equal(form.decisionId, reply.decisionId);
    assert.deepEqual(form.verdicts, ['success', 'partial', 'failure']);
    assert.deepEqual(form.constraints, FEEDBACK_CONSTRAINTS);
    assert.equal(form.submitted, null, 'nothing has been recorded against this reply yet');
    assert.deepEqual(form.issues, []);
    assert.equal(form.evidence.length > 0, true, 'the reply cited something a verdict can be about');
    assert.deepEqual(new Set(form.evidence.map((option: any) => option.ref)), new Set(reply.citations));
    assert.deepEqual(new Set(form.evidence.map((option: any) => option.kind)), new Set(['memory', 'chunk']),
      'a cited document chunk is offered beside a cited memory');

    const decision = (await rowsOf(desktop, 'outcome_records')).find((row) => row.kind === 'decision');
    assert.equal(decision.record.decisionKey, messageId, 'the decision is keyed by the message it is about');
    assert.equal(decision.record.input.citations, reply.citations.length);
    assert.equal(decision.record.configuration.identityId, reply.identityId);
    assert.equal(decision.record.expectedResolutionAt, null);
  });

  it('refuses a bare, short or uncited submission before any outcome write', async () => {
    const before_ = (await rowsOf(desktop, 'outcome_records')).length;

    const bare = await call(desktop, 'POST', '/api/feedback', { messageId, verdict: 'success', reason: REASON, evidence: [] });
    assert.equal(bare.status, 409);
    assert.equal(bare.json.code, 'refused');
    assert.deepEqual(issuesOf(bare).map((issue) => issue.code), ['TDSK1006']);
    assert.equal(issuesOf(bare)[0].path, '/evidence');

    const short = await call(desktop, 'POST', '/api/feedback', { messageId, verdict: 'success', reason: 'eleven char', evidence });
    assert.equal(short.status, 409);
    assert.equal('eleven char'.length, FEEDBACK_CONSTRAINTS.reasonMinChars - 1);
    assert.deepEqual(issuesOf(short).map((issue) => issue.code), ['TDSK1006']);
    assert.equal(issuesOf(short)[0].path, '/reason');

    const foreign = await call(desktop, 'POST', '/api/feedback', {
      messageId, verdict: 'success', reason: REASON, evidence: [{ kind: 'memory', ref: 'm-never-cited' }],
    });
    assert.equal(foreign.status, 409);
    assert.deepEqual(issuesOf(foreign).map((issue) => issue.code), ['TDSK1006']);
    assert.match(issuesOf(foreign)[0].detail, /did not cite/);

    const missingVerdict = await call(desktop, 'POST', '/api/feedback', { messageId, reason: REASON, evidence });
    assert.equal(missingVerdict.status, 409);
    assert.deepEqual(issuesOf(missingVerdict).map((issue) => issue.code), ['TDSK1006']);

    // counted, not believed: four refusals wrote nothing, and no evidence
    // snapshot was pinned for a verdict that was never accepted
    assert.equal((await rowsOf(desktop, 'outcome_records')).length, before_, 'a refused click writes no outcome record');
    assert.equal((await rowsOf(desktop, 'feedback_notes')).length, 0, 'a refused click pins no evidence');
  });

  it('records the operator verdict as the outcome and moves the cited memories', async () => {
    const citedMemories: string[] = form.evidence.filter((o: any) => o.kind === 'memory').map((o: any) => o.ref);
    const citedChunks: string[] = form.evidence.filter((o: any) => o.kind === 'chunk').map((o: any) => o.ref);
    assert.equal(citedChunks.length > 0, true, 'the reply cited a document chunk too');
    assert.equal(evidence.some((reference) => reference.kind === 'chunk'), true, 'a chunk is being submitted as evidence');
    const before_ = new Map<string, MemoryUnit>();
    for (const row of await rowsOf(desktop, 'memories')) before_.set(row.id, row);

    const submitted = await call(desktop, 'POST', '/api/feedback', { messageId, verdict: 'success', reason: REASON, evidence });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.json));
    const receipt = submitted.json;
    assert.equal(receipt.outcome, 'success', 'the outcome IS the operator assertion');
    assert.equal(receipt.utility, 1, 'success scores 1, partial 0.5, failure 0');
    assert.equal(receipt.applied, citedMemories.length,
      'the projection applies to the cited memories; a document chunk is evidence, never a memory id');
    assert.equal(receipt.missing, 0);
    assert.equal(receipt.changedMemoryWrites >= 1, true, `a success verdict moved confidence: ${receipt.changedMemoryWrites}`);
    assert.equal(receipt.replayed, false);
    assert.equal(receipt.writes > 0, true);
    assert.deepEqual(receipt.issues, []);

    const after_ = await rowsOf(desktop, 'memories');
    const moved = after_.filter((unit) => before_.get(unit.id)?.confidence !== unit.confidence);
    assert.equal(moved.length, receipt.changedMemoryWrites, 'the receipt counts exactly the rows that changed');
    for (const unit of moved) {
      assert.equal(unit.confidence > (before_.get(unit.id)?.confidence ?? 0), true,
        `${unit.id} moved ${before_.get(unit.id)?.confidence} → ${unit.confidence}`);
    }

    // a document chunk is evidence, never a memory the projection moves
    const decision = (await rowsOf(desktop, 'outcome_records')).find((row) => row.kind === 'decision');
    assert.deepEqual([...decision.record.memoryIds].sort(), [...citedMemories].sort());
    for (const chunkId of citedChunks) assert.equal(decision.record.memoryIds.includes(chunkId), false);

    const pinned = await rowsOf(desktop, 'feedback_notes');
    assert.equal(pinned.length, evidence.length, 'one row per source the submission named');
    assert.deepEqual(new Set(pinned.map((row) => row.kind)), new Set(['memory', 'chunk']));
    for (const row of pinned) {
      assert.equal(row.source.issuer, FEEDBACK_ISSUER, 'the verdict is labelled as the operator assertion');
      assert.deepEqual(row.source.payload, { verdict: 'success', reason: REASON },
        'every source carries the one outcome the operator asserted');
      assert.equal(row.text, null, 'a cited source is named, not copied');
    }

    const form2 = (await call(desktop, 'GET', `/api/feedback?messageId=${encodeURIComponent(messageId)}`)).json;
    assert.deepEqual(form2.submitted, { at: pinned[0].at, verdict: 'success' },
      'the form shows what was recorded instead of offering a second verdict');
  });

  it('replays an identical submission, writes nothing, and keys every stage by its message', async () => {
    const before_ = (await rowsOf(desktop, 'outcome_records')).length;
    const again = await call(desktop, 'POST', '/api/feedback', { messageId, verdict: 'success', reason: REASON, evidence });
    assert.equal(again.status, 200);
    assert.equal(again.json.replayed, true);
    assert.equal(again.json.writes, 0);
    assert.equal((await rowsOf(desktop, 'outcome_records')).length, before_, 'a replay adds no record');

    const keys = (await rowsOf(desktop, 'outcome_operations')).map((row) => row.requestKey).sort();
    assert.deepEqual(keys, [
      `${messageId}:decision`, `${messageId}:project`, `${messageId}:resolve`, `${messageId}:score`,
    ], 'one request key per stage, spelled once in the source');
  });

  it('refuses a different verdict rather than overwriting the recorded one', async () => {
    const before_ = (await rowsOf(desktop, 'outcome_records')).length;
    const other = await call(desktop, 'POST', '/api/feedback', {
      messageId, verdict: 'failure', reason: 'on reflection this missed the point', evidence,
    });
    assert.equal(other.status, 409);
    const codes = issuesOf(other).map((issue) => issue.code);
    assert.deepEqual(codes, ['TDSK1006', 'OUTC1007'], 'the lifecycle refusal passes through beside the surface code');
    assert.equal((await rowsOf(desktop, 'outcome_records')).length, before_, 'nothing was overwritten');

    const form3 = (await call(desktop, 'GET', `/api/feedback?messageId=${encodeURIComponent(messageId)}`)).json;
    assert.equal(form3.submitted.verdict, 'success', 'a verdict is recorded once, and the surface says so');
  });

  it('normalizes every outcome instant to millisecond precision, and nothing else', async () => {
    assert.equal(MILLISECOND_INSTANT.test(now()), false, 'the desktop clock itself emits second precision');

    for (const row of await rowsOf(desktop, 'outcome_records')) {
      assert.match(row.record.recordedAt, MILLISECOND_INSTANT, `${row.kind} recordedAt`);
      if (row.kind === 'decision') {
        assert.match(row.record.decidedAt, MILLISECOND_INSTANT);
        assert.match(row.record.cutoffAt, MILLISECOND_INSTANT);
      }
      if (row.kind === 'resolution') {
        assert.match(row.record.receivedAt, MILLISECOND_INSTANT);
        for (const source of row.record.sources) assert.match(source.observedAt, MILLISECOND_INSTANT);
      }
    }
    for (const row of await rowsOf(desktop, 'feedback_notes')) {
      assert.match(row.at, MILLISECOND_INSTANT);
      assert.match(row.source.observedAt, MILLISECOND_INSTANT);
    }
    // the run lane keeps the host clock: only the outcome lane is normalized
    const runs = (await call(desktop, 'GET', '/api/runs')).json;
    assert.equal(MILLISECOND_INSTANT.test(runs[0].startedAt), false, 'run rows keep the desktop clock unchanged');
  });

  it('reads a pinned evidence snapshot back, and refuses one whose bytes differ', async () => {
    const second = await call(desktop, 'POST', '/api/chat', { text: 'where does staging live?' });
    assert.equal(second.status, 200);
    const other = second.json.reply.id;
    const otherForm = (await call(desktop, 'GET', `/api/feedback?messageId=${encodeURIComponent(other)}`)).json;
    assert.equal(otherForm.eligible, true);
    const option = otherForm.evidence.find((entry: any) => entry.kind === 'memory');

    // a snapshot pinned under this source id that says something else:
    // the trusted resolver hands back what is stored, so the lifecycle
    // sees bytes that differ from the digest the command names
    const scopeId = await scopeIdOf(FEEDBACK_SCOPE);
    const bytes = {
      sourceId: option.sourceId,
      decisionId: otherForm.decisionId,
      scopeId,
      subject: FEEDBACK_SCOPE.subject,
      issuer: FEEDBACK_ISSUER,
      observedAt: '2026-08-24T15:00:00.000Z',
      payload: { verdict: 'failure', reason: 'a snapshot nobody submitted today' },
    };
    const stale: FeedbackNoteRow = {
      id: option.sourceId,
      messageId: other,
      kind: 'memory',
      digest: await outcomeRevision(bytes),
      at: bytes.observedAt,
      text: null,
      source: { ...bytes, digest: await outcomeRevision(bytes) } as any,
    };
    await desktop.db.collection<FeedbackNoteRow>('feedback_notes').put(stale);

    const refused = await call(desktop, 'POST', '/api/feedback', {
      messageId: other, verdict: 'success', reason: REASON, evidence: [{ kind: option.kind, ref: option.ref }],
    });
    assert.equal(refused.status, 409);
    assert.deepEqual(issuesOf(refused).map((issue) => issue.code), ['TDSK1006', 'OUTC1006']);
    assert.equal(issuesOf(refused)[1].detail, 'Evidence bytes differ from the pinned source.',
      'the resolver supplied the stored snapshot instead of rebuilding one that agrees with itself');

    const stored = await desktop.db.collection<FeedbackNoteRow>('feedback_notes').get(option.sourceId);
    assert.deepEqual(stored?.source, stale.source, 'a pinned snapshot is immutable; the refused submission did not replace it');
  });

  it('accepts the operator\'s own words as evidence, and refuses a note reference with no note', async () => {
    const third = await call(desktop, 'POST', '/api/chat', { text: 'how many requests per minute?' });
    assert.equal(third.status, 200);
    const noted = third.json.reply.id;

    const empty = await call(desktop, 'POST', '/api/feedback', {
      messageId: noted, verdict: 'partial', reason: 'half of this was about something else', evidence: [{ kind: 'note', ref: 'note' }],
    });
    assert.equal(empty.status, 409);
    assert.deepEqual(issuesOf(empty).map((issue) => issue.code), ['TDSK1006']);
    assert.equal(issuesOf(empty)[0].path, '/note');

    const text = 'the reply never mentioned the burst allowance we actually hit';
    const recorded = await call(desktop, 'POST', '/api/feedback', {
      messageId: noted, verdict: 'partial', reason: 'half of this was about something else',
      evidence: [{ kind: 'note', ref: 'note' }], note: text,
    });
    assert.equal(recorded.status, 200, JSON.stringify(recorded.json));
    assert.equal(recorded.json.outcome, 'partial');
    assert.equal(recorded.json.utility, 0.5, 'partial scores 0.5');

    const rows = (await rowsOf(desktop, 'feedback_notes')).filter((row) => row.messageId === noted);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'note');
    assert.equal(rows[0].text, text, 'the typed note is stored as the source it is');
    assert.match(rows[0].digest, /^[a-f0-9]{64}$/);
    assert.equal(rows[0].id.startsWith(`note:${noted}:`), true, 'a source names the reply it was observed for');
  });

  it('resolves evidence with a get: a removed snapshot cannot be supplied', async () => {
    const notes = createFeedbackNotes(desktop.db);
    const resolver = createNoteResolver(notes, await feedbackResolverRevision());
    const pinned = (await notes.byMessage(messageId))[0];
    assert.equal(pinned !== undefined, true);

    const found = await resolver.resolve({ sourceId: pinned.id, digest: pinned.digest }, FEEDBACK_SCOPE as any);
    assert.deepEqual(found, pinned.source);

    await desktop.db.collection('feedback_notes').delete(pinned.id);
    assert.equal(await resolver.resolve({ sourceId: pinned.id, digest: pinned.digest }, FEEDBACK_SCOPE as any), undefined,
      'the resolver is a get over the pinned row, never a second construction path');
  });
});

describe('feedback on a reply that carries no configuration identity', () => {
  let desktop: Desktop;
  let folder: string;

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), 'tangle-feedback-null-'));
    await writeFile(join(folder, 'ops.md'), 'The API rate limit is 100 requests per minute\n');
    // an embedding wire that never answers cannot finalize an identity,
    // so the reply this desktop produces has no configuration to cite
    const dead = async (): Promise<Response> => { throw new Error('embedding wire is down'); };
    desktop = await createDesktop({
      driver: nodeDriver(),
      now,
      fetch: dead as any,
      presetSettings: {
        folder,
        embed: { provider: 'ollama', baseUrl: 'http://stub.local:11434', model: 'stub-embed', apiKey: null },
      },
    });
  });

  after(async () => {
    await desktop.close();
    await rm(folder, { recursive: true, force: true });
  });

  it('is ineligible, and a submission against it is refused', async () => {
    const chat = await call(desktop, 'POST', '/api/chat', { text: 'what is the rate limit?' });
    assert.equal(chat.status, 200, 'a dead embedding wire degrades recall, never chat');
    const messageId = chat.json.reply.id;
    assert.equal(chat.json.reply.identityId, null);

    const form = (await call(desktop, 'GET', `/api/feedback?messageId=${encodeURIComponent(messageId)}`)).json;
    assert.equal(form.eligible, false);
    assert.equal(form.decisionId, null);
    assert.deepEqual(form.issues.map((issue: any) => issue.code), ['TDSK1007']);

    const refused = await call(desktop, 'POST', '/api/feedback', {
      messageId, verdict: 'success', reason: REASON, evidence: [{ kind: 'memory', ref: 'anything' }],
    });
    assert.equal(refused.status, 409);
    assert.equal(refused.json.code, 'refused');
    assert.deepEqual(issuesOf(refused).map((issue) => issue.code), ['TDSK1007']);

    assert.equal((await rowsOf(desktop, 'outcome_records')).length, 0,
      'a reply with no registered configuration records nothing at all');

    const history = (await call(desktop, 'GET', '/api/chat')).json;
    const asked = history.find((entry: any) => entry.role === 'user');
    const question = (await call(desktop, 'GET', `/api/feedback?messageId=${encodeURIComponent(asked.id)}`)).json;
    assert.equal(question.eligible, false, 'a question is not a reply, and carries no decision');
    assert.deepEqual(question.issues.map((issue: any) => issue.code), ['TDSK1007']);
    assert.match(question.issues[0].detail, /assistant reply/);

    const unknown = await call(desktop, 'GET', '/api/feedback?messageId=c-nobody');
    assert.equal(unknown.status, 404);
    assert.deepEqual(issuesOf(unknown).map((issue) => issue.code), ['TDSK1001']);
    const unknownSubmit = await call(desktop, 'POST', '/api/feedback', {
      messageId: 'c-nobody', verdict: 'success', reason: REASON, evidence: [{ kind: 'memory', ref: 'anything' }],
    });
    assert.equal(unknownSubmit.status, 404);
    assert.deepEqual(issuesOf(unknownSubmit).map((issue) => issue.code), ['TDSK1001']);
  });
});

describe('the chat-answer outcome domain', () => {
  it('registers with the lifecycle, and a schema whose identity differs is refused', async () => {
    const adapter = await createChatAnswerAdapter();
    const revision = await feedbackResolverRevision();
    const host = {
      store: createMemoryOutcomeStore(),
      scope: FEEDBACK_SCOPE,
      adapters: [adapter],
      resolver: { revision, resolve: async () => undefined },
      authorizeMemoryIds: async () => ({ allowed: true, authorizationId: revision }),
    };
    const service = await createOutcomeService(host as any);
    assert.equal(typeof service.scopeId, 'string');
    assert.equal(adapter.identity.id, 'desktop-chat-answer/v1');
    assert.deepEqual(adapter.staticPayload, { policy: 'operator-verdict-is-the-outcome' });
    assert.equal(FEEDBACK_ARTIFACT_KEY, 'chat-answer');

    // the service re-hashes every schema against the pinned identity, so a
    // domain that drifted by one byte is never quietly accepted
    const drifted = {
      ...adapter,
      schemas: { ...adapter.schemas, resolution: { ...adapter.schemas.resolution, title: 'drifted' } },
    };
    await assert.rejects(
      createOutcomeService({ ...host, adapters: [drifted] } as any),
      /Adapter schema identity differs/,
    );
  });

  it('scores the operator verdict and notes whether the reply agreed', async () => {
    const adapter = await createChatAnswerAdapter();
    const answered = { disposition: 'answer', citations: 2 };
    const declined = { disposition: 'refusal', citations: 0 };
    assert.deepEqual(adapter.score(answered as any, { verdict: 'success', reason: REASON } as any), {
      outcome: 'success',
      diagnostics: { disposition: 'answer', citations: 2, agreed: true },
    });
    assert.deepEqual(adapter.score(answered as any, { verdict: 'failure', reason: REASON } as any), {
      outcome: 'failure',
      diagnostics: { disposition: 'answer', citations: 2, agreed: false },
    });
    assert.deepEqual(adapter.score(declined as any, { verdict: 'failure', reason: REASON } as any).diagnostics, {
      disposition: 'refusal', citations: 0, agreed: true,
    });
    assert.deepEqual(
      adapter.interpret({ messageId: 'c-1', questionDigest: 'a'.repeat(64), disposition: 'answer', citations: 2 } as any, adapter.staticPayload),
      { disposition: 'answer', citations: 2 },
    );
  });
});
