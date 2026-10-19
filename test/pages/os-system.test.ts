/**
 * Radiant OS system calls (Pages, Tangle edition): `os.contract.json`
 * served in-process. Every call is validated in and out; the veto, the
 * early approval and the repeal are the human's alone and appear in no
 * tool projection; storage refusals and unreadable artworks are typed
 * failures. The database answers the same over `node:sqlite` and memory.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { nodeDriver } from '@jarenjs/db/node';
import { compileContract } from '@jarenjs/contract';
import { openLocalClient } from '@jarenjs/contract/local';
import storeDoc from '../../apps/pages/src/os/documents/store.contract.json' with { type: 'json' };
import contractDoc from '../../apps/pages/src/os/documents/os.contract.json' with { type: 'json' };
import { createSystem, isProposal } from '../../apps/pages/src/os/kernel/system.ts';
import { createMemoryStore, openOsStore } from '../../apps/pages/src/os/kernel/store.ts';
import { initialState, sessionSlice } from '../../apps/pages/src/os/app/state.ts';

const HUMAN_ONLY = ['council.veto', 'council.approve', 'council.repeal'];

function system(store: any = null) {
  const state = initialState({ edition: 'test', title: 'Radiant OS' });
  const sent: Array<[string, any]> = [];
  let n = 0;
  const sys = createSystem({
    edition: 'test', title: 'Radiant OS', getState: () => state,
    dispatch: (action, payload) => { sent.push([action, payload]); },
    council: {
      open: false,
      convene: async () => ({ session: 1, phase: 'veto' }),
      verdict: async (_event, id) => id === 'painter-1',
      repeal: (id) => (id === 'a1' ? 'repealed' : 'not-found'),
    },
    store: store ?? { invoke: async (op: string, input: any) => ({ ok: true, value: await (createMemoryStore() as any)[op](input) }) },
    ids: () => String(n++),
  });
  return { sys, sent, call: (op: string, input?: any) => sys.client.invoke(op, input) };
}

describe('the OS contract', () => {
  it('serves the human’s operations to the human alone', async () => {
    const audience = Object.entries(contractDoc.operations).filter(([, op]) => (op as any).policy?.audience === 'server').map(([id]) => id);
    assert.deepEqual(audience, HUMAN_ONLY);
    const s = system();
    assert.deepEqual((await s.call('council.veto', { by: 'human', proposal: 'painter-1' })).value, { session: 0, vetoed: 'painter-1' });
    assert.equal((await s.call('council.veto', { by: 'human', proposal: 'gone' })).error?.code, 'not-awaiting');
    assert.equal((await s.call('council.veto', { by: 'oracle', proposal: 'painter-1' })).error?.code, 'JC2050');
    assert.equal((await s.call('council.repeal', { by: 'human', amendment: 'a1' })).ok, true);
    const described = (await s.call('os.describe')).value;
    assert.ok(!described.operations.some((id: string) => HUMAN_ONLY.includes(id)));
    const tools = s.sys.tools();
    assert.equal(tools.length, 11);
    assert.ok(tools.every((t) => !HUMAN_ONLY.some((id) => t.name === `radiant_${id.replace('.', '_')}`)));
    const say = tools.find((t) => t.name === 'radiant_council_say');
    await say?.execute({ by: 'human', text: 'let me veto' });
    assert.equal(s.sent.at(-1)?.[1].by, 'oracle', 'an agent speaks only for its seat');
  });

  it('checks proposals and refuses what the program cannot take', async () => {
    assert.equal(isProposal({ id: 'o', by: 'oracle', title: 't', why: '', change: { kind: 'tape', op: 'mirror' } }), true);
    assert.equal(isProposal({ id: 'o', by: 'oracle', title: 't', why: '', change: { kind: 'tape', op: 'burn' } }), false);
    const s = system();
    assert.equal((await s.call('council.propose', { by: 'oracle', change: { kind: 'rule', state: 'sleep', symbol: 0, member: 'write', value: 1 } })).error?.code, 'unknown-state');
    assert.deepEqual((await s.call('council.propose', { by: 'oracle', change: { kind: 'tempo', tempo: 9 } })).value, { id: 'oracle-q0', queued: 1 });
  });

  it('keeps artworks, and leaves an unreadable one in the gallery', async () => {
    const memory = createMemoryStore() as any;
    const port = { invoke: async (op: string, input: any) => ({ ok: true, value: await memory[op](input) }) };
    const s = system(port);
    const saved = await s.call('gallery.save', { title: 'First light' });
    assert.equal(saved.ok, true);
    assert.equal((await s.call('gallery.list')).value.items[0].title, 'First light');
    assert.deepEqual((await s.call('gallery.open', { id: saved.value.id })).value, { opened: saved.value.id });
    const spoiled = structuredClone(memory['artwork.get']({ id: saved.value.id }));
    spoiled.id = 'bad';
    spoiled.program.tempo = 0;
    memory['artwork.put']({ artwork: spoiled });
    assert.equal((await s.call('gallery.open', { id: 'bad' })).error?.code, 'unreadable');
    const none = system({ invoke: async () => ({ ok: false, error: { message: 'disk full' } }) });
    assert.deepEqual((await none.call('gallery.save', { title: 'x' })).error?.details, { reason: 'disk full' });
  });

  it('answers the store contract the same over SQLite and memory', async () => {
    const contract = compileContract(storeDoc as any);
    const { handlers } = await openOsStore({ driver: nodeDriver() });
    for (const [name, store] of [['sqlite', handlers], ['memory', createMemoryStore()]] as const) {
      const client: any = openLocalClient(contract, store as any, { validateOutput: 'always' } as any);
      const state = sessionSlice(initialState({ edition: 'test', title: 'Radiant OS' }));
      assert.equal((await client.invoke('session.get')).value, null, name);
      assert.equal((await client.invoke('session.put', { state })).ok, true, name);
      assert.deepEqual((await client.invoke('session.get')).value.state, state, name);
      assert.equal((await client.invoke('artwork.get', { id: 'none' })).value, null, name);
      const amendment = { id: 'a1', session: 1, by: 'critic', title: 't', status: 'enacted', change: { kind: 'tape', op: 'clear' } };
      assert.equal((await client.invoke('amendment.put', { amendment })).ok, true, name);
      assert.deepEqual((await client.invoke('amendment.list')).value.map((a: any) => a.id), ['a1'], name);
    }
  });
});
