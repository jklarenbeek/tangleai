/**
 * Radiant OS's oracle seat (Pages, Tangle edition): a language model on
 * the council through @tangleai/models. The scripted oracle answers
 * offline through the same structured-output client; a configured model
 * is called only when the human has spoken since it last answered; every
 * answer is constrained by the contract's Change grammar, validated
 * locally, and seated as the oracle's own proposal.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ORACLE_SCHEMA, tasteHeard, scriptedAnswer, scriptedFetch, oraclePrompt, isLive, createOracleSeat,
} from '../../apps/pages/src/os/kernel/oracle.ts';
import type { ModelSettings } from '../../apps/pages/src/os/kernel/oracle.ts';
import { compileMachine, stepWorld } from '../../apps/pages/src/os/kernel/machine.ts';
import { isProposal } from '../../apps/pages/src/os/kernel/system.ts';
import { initialState } from '../../apps/pages/src/os/app/state.ts';
import { JarenValidator } from '@jarenjs/validate';

/** What the council hands the seat in a session. */
function asked(chat: any[] = [], ticks = 300) {
  const state = initialState({ edition: 'test', title: 'Radiant OS' });
  const world = stepWorld(compileMachine(state.program.machine), state.world, ticks).world;
  return { program: { machine: state.program.machine, tempo: 12 }, world, chat, seed: 1234 };
}

/** A chat endpoint that records each request and answers with `reply()`. */
function endpoint(reply: (body: any) => unknown) {
  const calls: any[] = [];
  const fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    return new Response(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(reply(body)) } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

const LIVE: ModelSettings = { provider: 'custom', baseUrl: 'https://llm.invalid/v1', model: 'test-model', apiKey: '' };
const said = (id: string, text: string, by = 'human') => ({ id, by, text, at: '2026-01-01T00:00:00.000Z' });

describe('the scripted oracle', () => {
  it('listens for the taste the human asks for', () => {
    assert.equal(tasteHeard([]), 'harmony');
    assert.equal(tasteHeard([said('m1', 'more symmetry, please')]), 'symmetry');
    assert.equal(tasteHeard([said('m1', 'brighter colours!')]), 'balance');
    assert.equal(tasteHeard([said('m1', 'dance faster')]), 'motion');
    assert.equal(tasteHeard([said('m1', 'clean lines')]), 'structure');
    assert.equal(tasteHeard([said('m2', 'more colour', 'oracle'), said('m1', 'fold it')]), 'symmetry', 'it listens to the human, not to itself');
  });

  it('answers in the grammar the model would be held to', () => {
    const answer = scriptedAnswer(asked([said('m1', 'more symmetry')]));
    assert.ok(answer);
    assert.match(answer.why, /^You asked for symmetry: Oracle foresees symmetry/);
    const check = new JarenValidator().compile(ORACLE_SCHEMA as any);
    assert.equal(check(answer), true);
    assert.match(scriptedAnswer(asked())?.why ?? '', /^No one asked for anything/);
    const still = asked([], 0);
    still.world = { ...still.world, heads: [] };
    assert.equal(scriptedAnswer(still), null, 'with nothing to gain, it proposes nothing');
  });

  it('speaks through a fetch shaped like a chat endpoint', async () => {
    const response = await scriptedFetch(() => ({ hello: 'council' }))('https://oracle.invalid/v1/chat/completions');
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(body.choices[0].message.content), { hello: 'council' });
  });

  it('writes the program, the tastes and the words into the prompt', () => {
    const [system, user] = oraclePrompt(asked([said('m1', 'fold it, please')]));
    assert.equal(system.role, 'system');
    assert.match(system.content, /Turing machine/);
    assert.match(system.content, /\["dance","leap"\]/);
    assert.match(user.content, /dance reads paper → paint blue, turn left, become dance/);
    assert.match(user.content, /harmony 0\.\d\d/);
    assert.match(user.content, /The human: fold it, please/);
    assert.match(oraclePrompt(asked())[1].content, /Nobody has said anything yet/);
  });
});

describe('the oracle seat', () => {
  it('is scripted without a model, and seats a configured one', () => {
    assert.equal(isLive(null), false);
    assert.equal(isLive({ ...LIVE, model: ' ' }), false);
    assert.equal(isLive({ ...LIVE, baseUrl: '' }), false, 'a custom endpoint needs its URL');
    assert.equal(isLive({ provider: 'openrouter', baseUrl: '', model: 'm', apiKey: '' }), false, 'OpenRouter needs a key');
    assert.equal(isLive({ provider: 'ollama', baseUrl: '', model: 'm', apiKey: '' }), true, 'a local runtime needs none');
    const scripted = createOracleSeat();
    assert.equal(scripted.label, 'scripted');
    assert.equal(scripted.live, false);
    const live = createOracleSeat({ settings: LIVE });
    assert.equal(live.label, 'test-model');
    assert.equal(live.live, true);
    live.configure(null);
    assert.equal(live.label, 'scripted');
  });

  it('answers offline as the oracle, with an id and a seat of its own', async () => {
    const seat = createOracleSeat();
    const proposal = await seat.oracle(asked([said('m1', 'more symmetry')]), new AbortController().signal);
    assert.ok(proposal);
    assert.equal(proposal.by, 'oracle');
    assert.equal(proposal.id, `oracle-${(1234).toString(36)}`);
    assert.equal(isProposal(proposal), true);
    const still = asked([], 0);
    still.world = { ...still.world, heads: [] };
    assert.equal(await seat.oracle(still, new AbortController().signal), null);
  });

  it('calls the model only when the human has spoken since it last answered', async () => {
    const llm = endpoint(() => ({ title: 'Fold it', why: 'You asked for symmetry.', change: { kind: 'tape', op: 'mirror' } }));
    const seat = createOracleSeat({ settings: LIVE, fetch: llm.fetch });
    const quiet = await seat.oracle(asked(), new AbortController().signal);
    assert.equal(llm.calls.length, 0, 'nobody spoke: the scripted oracle answers');
    assert.ok(quiet);
    const spoken = await seat.oracle(asked([said('m1', 'fold the floor')]), new AbortController().signal);
    assert.equal(llm.calls.length, 1);
    assert.equal(llm.calls[0].model, 'test-model');
    assert.match(JSON.stringify(llm.calls[0].messages), /fold the floor/);
    assert.deepEqual(spoken, { id: `oracle-${(1234).toString(36)}`, by: 'oracle', title: 'Fold it', why: 'You asked for symmetry.', change: { kind: 'tape', op: 'mirror' } });
    await seat.oracle(asked([said('m1', 'fold the floor')]), new AbortController().signal);
    assert.equal(llm.calls.length, 1, 'the same words are not answered twice');
    await seat.oracle(asked([said('m3', 'by the way'), said('m2', 'thanks', 'oracle')]), new AbortController().signal);
    assert.equal(llm.calls.length, 2, 'new words are');
  });

  it('reports a model that fails or answers off the grammar, and goes on without it', async () => {
    const errors: unknown[] = [];
    const broken = createOracleSeat({
      settings: LIVE, onError: (error) => errors.push(error),
      fetch: (async () => { throw new TypeError('network down'); }) as typeof fetch,
    });
    assert.equal(await broken.oracle(asked([said('m1', 'hello')]), new AbortController().signal), null);
    assert.equal(errors.length, 1);
    const offGrammar = endpoint(() => ({ title: 'Burn it', why: 'because', change: { kind: 'tape', op: 'burn' } }));
    const confused = createOracleSeat({ settings: LIVE, fetch: offGrammar.fetch, onError: (error) => errors.push(error) });
    assert.equal(await confused.oracle(asked([said('m1', 'hello')]), new AbortController().signal), null);
    assert.equal(offGrammar.calls.length, 2, 'one repair round');
    assert.match(String((errors[1] as Error).message), /did not fit the grammar/);
  });
});
