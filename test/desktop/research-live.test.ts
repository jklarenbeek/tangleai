import { it } from 'node:test';
import assert from 'node:assert/strict';
import { nodeDriver } from '@jarenjs/db/node';
import { toFetchHandler } from '@jarenjs/contract/fetch';
import { createResearchStore, createRunLog, researchRunLogId } from '@tangleai/store';
import { planProjectCreate } from '@tangleai/research';
import { createDesktop, type Desktop } from '../../apps/desktop/src/server.ts';
import { checked, project } from '../research/fixtures.ts';
import { stored } from '../research/store-harness.ts';

async function stream(desktop: Desktop, id: string, last?: string, after?: number) {
  const controller = new AbortController(), headers: Record<string, string> = { accept: 'text/event-stream' };
  if (last !== undefined) headers['last-event-id'] = last;
  const response = await toFetchHandler(desktop.dispatcher)(new Request('http://desktop.test/api/research/runs/live?projectId=' + id
    + (after === undefined ? '' : '&afterSeq=' + after), { headers, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) }));
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'text/event-stream');
  const reader = response.body!.getReader(), decoder = new TextDecoder(); let pending = '';
  return {
    async next(kind: string): Promise<{ id: string | undefined; data: any }> {
      for (;;) {
        const end = pending.indexOf('\n\n');
        if (end < 0) { const next = await reader.read(); assert.equal(next.done, false); pending += decoder.decode(next.value, { stream: true }); continue; }
        const block = pending.slice(0, end); pending = pending.slice(end + 2);
        const value = (name: string) => block.split('\n').find(line => line.startsWith(name + ': '))?.slice(name.length + 2);
        assert.notEqual(value('event'), 'error', block);
        if (value('event') === kind) return { id: value('id'), data: JSON.parse(value('data')!) };
      }
    },
    async close() { controller.abort(); await reader.cancel().catch(cause => { if (!controller.signal.aborted) throw cause; }); },
  };
}

it('research subscriptions use the persisted run association, keep concurrent projects separate, and resume exactly', async () => {
  const desktop = await createDesktop({ driver: nodeDriver() });
  const subscriptions: Awaited<ReturnType<typeof stream>>[] = [];
  try {
    const store = createResearchStore(desktop.db), log = createRunLog(desktop.db);
    for (const id of ['live-project-one', 'live-project-two']) stored(await store.createProject(checked(planProjectCreate(project(id)))));
    const ids = await Promise.all(['live-project-one', 'live-project-two'].map(id => researchRunLogId(desktop.db, id)));
    assert.ok(ids[0] && ids[1]); assert.notEqual(ids[0], ids[1]);
    for (const id of ids) assert.ok((await log.appendFrame(id!, { kind: 'node', body: { node: 'DISCOVERY', status: 'ok', ms: 0 } })).ok);
    const [one, two] = await Promise.all(['live-project-one', 'live-project-two'].map(id => stream(desktop, id)));
    subscriptions.push(one, two);
    const snapshots = await Promise.all([one.next('snapshot'), two.next('snapshot')]);
    for (const [i, snapshot] of snapshots.entries()) {
      assert.equal(snapshot.id, '1'); assert.deepEqual(snapshot.data.value.rows.map((row: any) => row.runId), [ids[i]]);
    }
    for (const id of ids) assert.ok((await log.appendFrame(id!, { kind: 'node', body: { node: 'ANALYZE', status: 'ok', ms: 1 } })).ok);
    const patches = await Promise.all([one.next('patch'), two.next('patch')]);
    for (const [i, patch] of patches.entries()) { assert.equal(patch.id, '2'); assert.equal(patch.data.seq, 2); assert.equal(patch.data.patch[0].value.runId, ids[i]); }
    await one.close(); await two.close(); subscriptions.length = 0;
    assert.ok((await log.appendFrame(ids[0]!, { kind: 'node', body: { node: 'WRITE', status: 'ok', ms: 2 } })).ok);
    const resumed = await stream(desktop, 'live-project-one', '1'); subscriptions.push(resumed);
    const replay = [await resumed.next('patch'), await resumed.next('patch')];
    assert.deepEqual(replay.map(row => row.id), ['2', '3']);
    assert.deepEqual(replay.map(row => row.data.patch[0].value.id), [ids[0] + ':00000002', ids[0] + ':00000003']);
    await resumed.close(); subscriptions.length = 0;
    const queryResume = await stream(desktop, 'live-project-one', undefined, 2); subscriptions.push(queryResume);
    const snapshot = await queryResume.next('snapshot'); assert.equal(snapshot.id, '3');
    assert.deepEqual(snapshot.data.value.rows.map((row: any) => row.seq), [3]);
    assert.ok((await log.appendFrame(ids[0]!, { kind: 'node', body: { node: 'VERIFY', status: 'ok', ms: 3 } })).ok);
    assert.equal((await queryResume.next('patch')).id, '4');
  } finally { for (const subscription of subscriptions) await subscription.close(); await desktop.close(); }
});
