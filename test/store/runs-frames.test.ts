/**
 * The persisted frame stream: one address space per run, read from the
 * store inside the appending transaction, replayable by the same
 * numbers a subscriber resumes with.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { nodeDriver } from '@jarenjs/db/node';
import { isSubscriptionLike } from '@jarenjs/contract/stream';

import { openTangleDb, createRunLog, frameIdOf, MAX_FRAME_BODY_BYTES, type TangleDb } from '@tangleai/store';

const clock = (): (() => string) => {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 8, 14, 0, 0, 0) + (tick++) * 1000).toISOString();
};

const open = (options: Record<string, unknown> = {}): Promise<TangleDb> =>
  openTangleDb({ driver: nodeDriver(), capture: { mode: 'auto' }, ...options });

/** Wait until `done()` answers true, or give up — a fixed sleep loses races. */
const settle = async (done: () => boolean, deadlineMs = 4000): Promise<void> => {
  const start = Date.now();
  while (!done() && Date.now() - start < deadlineMs) await new Promise((resolve) => setTimeout(resolve, 5));
};

describe('run frames: appending', () => {
  it('allocates one address space per run under concurrent appends', async () => {
    const db = await open();
    const log = createRunLog(db, { now: clock() });
    const [a, b] = await Promise.all([log.startRun('chat'), log.startRun('sync')]);

    const appends = [];
    for (let i = 0; i < 8; i++) {
      appends.push(log.appendFrame(a.id, { kind: 'delta', body: { text: `a${i}`, chars: 2 } }));
      appends.push(log.appendFrame(b.id, { kind: 'delta', body: { text: `b${i}`, chars: 2 } }));
    }
    const outcomes = await Promise.all(appends);
    assert.equal(outcomes.every((outcome) => outcome.ok), true, 'every append was admitted');

    const aFrames = await log.frames(a.id);
    const bFrames = await log.frames(b.id);
    assert.deepEqual(aFrames.map((frame) => frame.seq), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(bFrames.map((frame) => frame.seq), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(new Set([...aFrames, ...bFrames].map((frame) => frame.id)).size, 16, 'no two frames share an address');
    assert.equal(aFrames[0].id, frameIdOf(a.id, 1));
    assert.match(aFrames[0].id, /:00000001$/, 'the seq pads to eight digits');
    assert.equal(aFrames.every((frame) => frame.runId === a.id), true);
    await db.close();
  });

  it('refuses an unknown run, a terminal run and a body nobody declared — as values', async () => {
    const db = await open();
    const log = createRunLog(db, { now: clock() });
    const run = await log.startRun('chat');

    assert.deepEqual(await log.appendFrame('r-nope', { kind: 'delta', body: { text: 'x', chars: 1 } }),
      { ok: false, code: 'TDSK1001', reason: "run 'r-nope' does not exist" });

    const badBody = await log.appendFrame(run.id, { kind: 'delta', body: { text: 'x' } });
    assert.equal(badBody.ok, false);
    assert.equal(badBody.ok === false && badBody.code, 'TDSK1003');

    const unknownMember = await log.appendFrame(run.id, { kind: 'identity', body: { identityId: 'f'.repeat(64), secret: 'k' } });
    assert.equal(unknownMember.ok === false && unknownMember.code, 'TDSK1003', 'the per-kind body shape is closed');

    const oversized = await log.appendFrame(run.id, { kind: 'delta', body: { text: 'x'.repeat(MAX_FRAME_BODY_BYTES), chars: MAX_FRAME_BODY_BYTES } });
    assert.equal(oversized.ok === false && oversized.code, 'TDSK1003', 'a frame no page could carry is refused at the write');

    assert.equal((await log.finishRun(run.id, 'ok', { done: true })).ok, true);
    const afterTerminal = await log.appendFrame(run.id, { kind: 'delta', body: { text: 'x', chars: 1 } });
    assert.equal(afterTerminal.ok, false);
    assert.equal(afterTerminal.ok === false && afterTerminal.code, 'TDSK1002');
    await db.close();
  });

  it('writes the run row and its terminal frame in one transaction', async () => {
    const db = await open();
    const log = createRunLog(db, { now: clock() });
    const run = await log.startRun('chat');
    await log.appendFrame(run.id, { kind: 'usage', body: { usage: null } });

    assert.equal((await log.finishRun(run.id, 'cancelled', { at: 'generation' })).ok, true);
    const detail = await log.getRun(run.id);
    assert.equal(detail?.run.status, 'cancelled');
    const frames = await log.frames(run.id);
    assert.deepEqual(frames.map((frame) => frame.kind), ['usage', 'status']);
    assert.deepEqual(frames[1].body, { status: 'cancelled', summary: { at: 'generation' } });

    assert.deepEqual(await log.finishRun(run.id, 'ok'),
      { ok: false, reason: `run '${run.id}' already finished as 'cancelled'` });
    assert.equal((await log.frames(run.id)).length, 2, 'a refused finish writes no second terminal frame');
    await db.close();
  });

  it('rolls the run row back when the terminal frame cannot be written', async () => {
    const db = await open();
    // the frame write fails inside the finishing transaction; the row
    // update that preceded it must not survive on its own
    const broken = {
      collection: <T,>(name: string) => db.collection<T>(name),
      transaction: <R,>(fn: (tx: any) => R | Promise<R>, options?: unknown) => db.transaction((tx: any) => fn({
        collection: (name: string) => (name === 'run_frames'
          ? { ...tx.collection(name), put: () => { throw new Error('disk full'); } }
          : tx.collection(name)),
      }), options as never),
    } as unknown as TangleDb;
    const log = createRunLog(broken, { now: clock() });
    const run = await log.startRun('chat');

    await assert.rejects(log.finishRun(run.id, 'ok', { files: 1 }), /disk full/);
    const reader = createRunLog(db);
    const detail = await reader.getRun(run.id);
    assert.equal(detail?.run.status, 'running', 'the finish rolled back whole');
    assert.equal(detail?.frames, 0);
    await db.close();
  });

  it('keeps recordEvent working over frames, and answers the union of both sources', async () => {
    const db = await open();
    const log = createRunLog(db, { now: clock() });
    const run = await log.startRun('sync');
    await log.recordEvent(run.id, { id: 'observations', status: 'ok', ms: 3 });
    const second = await log.recordEvent(run.id, { id: 'embed', status: 'ok', ms: 1 });
    assert.equal(second.node, 'embed');
    assert.equal(second.seq, 2);
    await log.appendFrame(run.id, { kind: 'retrieval', body: { memories: 2, documentChunks: 0, skippedDocuments: 0, candidates: ['m-1', 'm-2'] } });
    await log.finishRun(run.id, 'ok', { files: 1 });

    const detail = await log.getRun(run.id);
    assert.deepEqual(detail?.events.map((event) => event.node), ['observations', 'embed'], 'only node frames project to events');
    assert.equal(detail?.frames, 4, 'two nodes, one retrieval, one terminal status');

    await assert.rejects(log.recordEvent('r-nope', { id: 'embed', status: 'ok', ms: 1 }), /TDSK1001/);
    await db.close();
  });

  it('closes the sync frame body: the counted pass, and nothing else', async () => {
    const db = await open();
    const log = createRunLog(db, { now: clock() });
    const run = await log.startRun('sync');
    const counted = {
      trigger: 'change', scanned: 9, ingested: 2, skipped: 7,
      removed: 1, truncated: 1, orphanedUnits: 3,
    };

    const admitted = await log.appendFrame(run.id, { kind: 'sync', body: counted });
    assert.equal(admitted.ok, true, 'every counted value of a pass is a declared member');
    assert.deepEqual(admitted.ok === true && admitted.frame.body, counted);

    const extra = await log.appendFrame(run.id, { kind: 'sync', body: { ...counted, extra: 1 } });
    assert.equal(extra.ok === false && extra.code, 'TDSK1003', 'a member nobody declared is refused');

    const unknownTrigger = await log.appendFrame(run.id, { kind: 'sync', body: { ...counted, trigger: 'guess' } });
    assert.equal(unknownTrigger.ok === false && unknownTrigger.code, 'TDSK1003', 'a pass names one of the five triggers');

    const { orphanedUnits: _dropped, ...short } = counted;
    const missing = await log.appendFrame(run.id, { kind: 'sync', body: short });
    assert.equal(missing.ok === false && missing.code, 'TDSK1003', 'a pass that leaves a count out is not a report');
    await db.close();
  });

  it('bounds the progress frame body: eight short lines, one stream, a counted remainder', async () => {
    const db = await open();
    const log = createRunLog(db, { now: clock() });
    const run = await log.startRun('report');

    const body = { lines: ['building…', 'done'], stream: 'out', suppressed: 0 };
    const admitted = await log.appendFrame(run.id, { kind: 'progress', body });
    assert.equal(admitted.ok, true);
    assert.deepEqual(admitted.ok === true && admitted.frame.body, body);

    const refusals: Array<[string, Record<string, unknown>]> = [
      ['an empty batch is not progress', { lines: [], stream: 'out', suppressed: 0 }],
      ['a batch past eight lines', { lines: Array.from({ length: 9 }, (_, i) => `l${i}`), stream: 'out', suppressed: 0 }],
      ['a line past 240 characters', { lines: ['x'.repeat(241)], stream: 'out', suppressed: 0 }],
      ['a stream nobody declared', { lines: ['x'], stream: 'both', suppressed: 0 }],
      ['a negative remainder', { lines: ['x'], stream: 'out', suppressed: -1 }],
      ['a remainder left out', { lines: ['x'], stream: 'out' }],
    ];
    for (const [why, candidate] of refusals) {
      const refused = await log.appendFrame(run.id, { kind: 'progress', body: candidate });
      assert.equal(refused.ok === false && refused.code, 'TDSK1003', why);
    }

    const carried = await log.appendFrame(run.id, { kind: 'progress', body: { lines: ['tail'], stream: 'err', suppressed: 412 } });
    assert.equal(carried.ok, true, 'what a producer had to drop is a number the frame carries');
    await db.close();
  });

  it('closes the report frame body: the identity, where it came from and whether it was already held', async () => {
    const db = await open();
    const log = createRunLog(db, { now: clock() });
    const run = await log.startRun('report');
    const body = {
      reportId: 'a'.repeat(64), instrument: 'config-conformance',
      schemaId: 'https://tangleai.dev/schemas/config-conformance',
      bytes: 4096, stored: 'new', files: 1, runId: run.id,
    };

    const admitted = await log.appendFrame(run.id, { kind: 'report', body });
    assert.equal(admitted.ok, true);
    assert.deepEqual(admitted.ok === true && admitted.frame.body, body);

    // a second pass over an unchanged tree recomputes the same identity
    // and stores nothing, so its frame names the run that did store it
    const unchanged = await log.appendFrame(run.id, { kind: 'report', body: { ...body, stored: 'unchanged', runId: 'r-earlier' } });
    assert.equal(unchanged.ok, true, 'an already-held document names the run that stored it');

    const refusals: Array<[string, Record<string, unknown>]> = [
      ['an identity that is not a digest', { ...body, reportId: 'not-a-digest' }],
      ['a disposition nobody declared', { ...body, stored: 'maybe' }],
      ['a member nobody declared', { ...body, verdict: 'better' }],
      ['a run nobody named', { ...body, runId: '' }],
    ];
    for (const [why, candidate] of refusals) {
      const refused = await log.appendFrame(run.id, { kind: 'report', body: candidate });
      assert.equal(refused.ok === false && refused.code, 'TDSK1003', why);
    }
    const { schemaId: _dropped, ...short } = body;
    const missing = await log.appendFrame(run.id, { kind: 'report', body: short });
    assert.equal(missing.ok === false && missing.code, 'TDSK1003', 'a stored report always says what shape it claims');
    await db.close();
  });
});

describe('run frames: replay', () => {
  it('pages by (runId, seq), advances next, and never asks for a reset', async () => {
    const db = await open();
    const log = createRunLog(db, { now: clock() });
    const run = await log.startRun('chat');
    for (let i = 0; i < 5; i++) await log.appendFrame(run.id, { kind: 'delta', body: { text: `d${i}`, chars: 2 } });

    const first = await log.replayPage(run.id, 0, { limit: 2, maxBytes: 65536 });
    assert.ok(first);
    assert.deepEqual(first.items.map((item) => item.seq), [1, 2]);
    assert.equal(first.hasMore, true);
    assert.equal(first.next, 2);
    assert.equal(first.earliestAvailable, 1);
    assert.equal(first.highWatermark, 5);
    assert.equal(first.resetRequired, false);
    assert.deepEqual(first.items[0].patch[0].op, 'add');
    assert.deepEqual(first.items[0].patch[0].path, '/rows/-');

    const last = await log.replayPage(run.id, 4, { limit: 2, maxBytes: 65536 });
    assert.ok(last);
    assert.deepEqual(last.items.map((item) => item.seq), [5]);
    assert.equal(last.hasMore, false);
    assert.equal(last.next, 5);

    const beyond = await log.replayPage(run.id, 5, { limit: 2, maxBytes: 65536 });
    assert.ok(beyond);
    assert.deepEqual(beyond.items, []);
    assert.equal(beyond.next, 5, 'an exhausted cursor stays where it was');
    assert.equal(beyond.hasMore, false);

    assert.equal(await log.replayPage('r-nope', 0, { limit: 2, maxBytes: 65536 }), null);
    await db.close();
  });

  it('cuts a page at the byte bound and reports the rest as more', async () => {
    const db = await open();
    const log = createRunLog(db, { now: clock() });
    const run = await log.startRun('chat');
    for (let i = 0; i < 4; i++) await log.appendFrame(run.id, { kind: 'delta', body: { text: 'x'.repeat(400), chars: 400 } });

    const page = await log.replayPage(run.id, 0, { limit: 50, maxBytes: 700 });
    assert.ok(page);
    assert.equal(page.items.length, 1, 'the byte bound cut before the second frame');
    assert.equal(page.hasMore, true);
    assert.equal(page.next, 1);
    await db.close();
  });
});

describe('run frames: subscriptions', () => {
  it('emits one run\'s frames under its own seq and never another run\'s', async () => {
    const db = await open();
    const log = createRunLog(db, { now: clock() });
    const a = await log.startRun('chat');
    const b = await log.startRun('sync');
    const watched = await log.subscribeRun(a.id);
    assert.equal(isSubscriptionLike(watched), true);

    const seen: Array<{ patch: any[], seq: number }> = [];
    const stop = watched.subscribe((emission: any) => seen.push(emission));

    await log.appendFrame(a.id, { kind: 'delta', body: { text: 'a1', chars: 2 } });
    await log.appendFrame(b.id, { kind: 'delta', body: { text: 'b1', chars: 2 } });
    await log.appendFrame(a.id, { kind: 'delta', body: { text: 'a2', chars: 2 } });
    await log.appendFrame(b.id, { kind: 'delta', body: { text: 'b2', chars: 2 } });
    await log.appendFrame(a.id, { kind: 'usage', body: { usage: { tokens: 4 } } });
    await settle(() => seen.length >= 3);

    assert.deepEqual(seen.map((emission) => emission.seq), [1, 2, 3],
      'the emission seq is the frame seq, not the store-wide capture seq');
    const rows = seen.flatMap((emission) => emission.patch.map((op: any) => op.value));
    assert.equal(rows.every((row: any) => row.runId === a.id), true, 'no emission carried the other run\'s frame');
    assert.deepEqual((watched.snapshot().rows as any[]).map((row) => row.seq), [1, 2, 3]);

    stop();
    watched.close();
    await db.close();
  });

  it('shows a run starting as an add and its finish as a replace, with the identity status', async () => {
    const db = await open();
    const log = createRunLog(db, { now: clock(), configAwareKinds: ['sync'] });
    const watched = await log.subscribeRuns({ limit: 10 });
    assert.equal(isSubscriptionLike(watched), true);
    const seen: any[] = [];
    const stop = watched.subscribe((emission: any) => seen.push(emission));

    const run = await log.startRun('sync', { identityId: 'a'.repeat(64) });
    await settle(() => seen.length >= 1);
    await log.finishRun(run.id, 'ok', { files: 1 });
    await settle(() => seen.length >= 2);

    assert.equal(seen[0].patch[0].op, 'add');
    assert.equal(seen[0].patch[0].value.status, 'running');
    assert.equal(seen[0].patch[0].value.identityStatus, 'run', 'an emission carries the same projection the list does');
    assert.equal(seen[1].patch[0].op, 'replace');
    assert.equal(seen[1].patch[0].value.status, 'ok');
    assert.deepEqual((watched.snapshot().rows as any[]).map((row) => row.status), ['ok']);

    stop();
    watched.close();
    await db.close();
  });

  it('maps the store\'s maintained-entry ceiling to the declared overflow', async () => {
    const db = await open({ live: { maxMaintained: 2 } });
    const log = createRunLog(db, { now: clock() });
    const run = await log.startRun('chat');
    const watched = await log.subscribeRun(run.id);
    const seen: any[] = [];
    watched.subscribe((emission: any) => seen.push(emission));

    for (let i = 0; i < 4; i++) await log.appendFrame(run.id, { kind: 'delta', body: { text: `d${i}`, chars: 2 } });
    await settle(() => seen.some((emission) => emission.error !== undefined));

    const failure = seen.find((emission) => emission.error !== undefined);
    assert.ok(failure, 'the ceiling reached the subscriber');
    assert.equal(failure.error.code, 'overflow');
    assert.equal((failure.error.cause as { code?: string }).code, 'JD2060', 'the store\'s own cause rides along');

    watched.close();
    await db.close();
  });
});

describe('run frames: a database written before frames existed', () => {
  it('reopens under the widened model and reads its legacy rows', async () => {
    // the committed fixture is a released-shape database: `runs` with the
    // three-state enum, `events` rows, and no frame collection at all.
    // Opening it creates the frame table, so the test opens a copy — the
    // fixture stays the bytes it was written with.
    const scratch = await mkdtemp(join(tmpdir(), 'tangle-reopen-'));
    const path = join(scratch, 'tangle.db');
    await copyFile('test/fixtures/desktop-0.27.3.db', path);
    const db = await open({ path });
    const log = createRunLog(db);
    const runs = await log.listRuns();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].kind, 'sync');
    assert.equal(runs[0].status, 'ok');

    const detail = await log.getRun(runs[0].id);
    assert.ok(detail);
    assert.deepEqual(detail.events.map((event) => event.node),
      ['observations', 'embed', 'novelty', 'contradiction', 'crystallize', 'report']);
    assert.deepEqual(detail.events.map((event) => event.seq), [1, 2, 3, 4, 5, 6]);
    assert.match(detail.events[0].id, /:0001$/, 'the legacy rows keep the addresses they were written with');
    assert.equal(detail.frames, 0, 'a run written before frames has none');

    // and the widened model works on the reopened file: the run can be
    // reopened, framed and finished under a state the old enum had no word for
    const fresh = await log.startRun('chat');
    assert.equal((await log.appendFrame(fresh.id, { kind: 'delta', body: { text: 'hi', chars: 2 } })).ok, true);
    assert.equal((await log.finishRun(fresh.id, 'cancelled')).ok, true);
    assert.equal((await log.getRun(fresh.id))?.run.status, 'cancelled');

    await db.close();
    await rm(scratch, { recursive: true, force: true });
  });
});
