/**
 * Radiant OS council sessions (Pages, Tangle edition): the workflow run,
 * the human's verdict, the timer that enacts when the human stays
 * silent, the merit document's reward and the repeal — over a fake clock
 * and a fake reducer.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createCouncilDriver, SESSION_EVERY, VERDICT_MS } from '../../apps/pages/src/os/kernel/session.ts';
import type { DriverHost } from '../../apps/pages/src/os/kernel/session.ts';
import { LOOKAHEAD } from '../../apps/pages/src/os/kernel/council.ts';
import { compileMachine, createWorld, stepWorld } from '../../apps/pages/src/os/kernel/machine.ts';
import { initialState, WORLD_SIZE } from '../../apps/pages/src/os/app/state.ts';

/** A host over a plain state value, with a clock and timers the test turns by hand. */
function councilHost(options: { ticks?: number, world?: any, oracle?: DriverHost['oracle'], validateProposal?: DriverHost['validateProposal'] } = {}) {
  let state = initialState({ edition: 'test', title: 'Radiant OS' });
  state = { ...state, world: options.world ?? stepWorld(compileMachine(state.program.machine), state.world, options.ticks ?? 300).world };
  const log: Array<[string, any]> = [];
  const timers = new Map<number, { fn: () => void, at: number }>();
  let now = 0;
  let nextTimer = 1;
  const council = (patch: any) => { state = { ...state, council: { ...state.council, ...patch } }; };
  const driver = createCouncilDriver({
    getState: () => state,
    dispatch: (action, payload) => {
      log.push([action, payload]);
      if (action === 'council/phase') council(payload);
      else if (action === 'council/queue') council({ queue: payload });
      else if (action === 'council/enacted') {
        state = { ...state, program: payload.program, world: payload.world };
        council({ log: [payload.amendment, ...state.council.log] });
      }
      else if (action === 'council/vetoed') council({ log: [payload.amendment, ...state.council.log] });
      else if (action === 'council/merits') council({ merits: payload.merits });
      else if (action === 'council/repealed') state = { ...state, program: payload.program };
    },
    setTimer: (fn, ms) => { timers.set(nextTimer, { fn, at: now + ms }); return nextTimer++; },
    clearTimer: (id) => { timers.delete(id); },
    now: () => now,
    yieldEvery: () => Promise.resolve(),
    oracle: options.oracle,
    validateProposal: options.validateProposal,
  });
  return {
    driver, timers,
    get state() { return state; },
    set state(next: any) { state = next; },
    advance(ms: number) { now += ms; },
    sent: (action: string) => log.filter(([a]) => a === action).map(([, p]) => p),
    async fire() {
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
      for (let i = 0; i < 100 && driver.open; i++) await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

describe('a council session', () => {
  it('runs the workflow to a verdict that waits for the human, and takes the veto', async () => {
    const h = councilHost();
    assert.deepEqual(await h.driver.convene(), { session: 1, phase: 'veto' });
    const phase = h.sent('council/phase').at(-1);
    assert.equal(phase.deadline, VERDICT_MS);
    assert.ok(phase.proposals.length >= 2);
    assert.equal(phase.winner.score, Math.max(...phase.scores.map((s: any) => s.score)));
    assert.equal(h.driver.awaiting, phase.winner.id);
    assert.equal(await h.driver.convene(), null, 'one session at a time');
    assert.equal(await h.driver.verdict('veto', 'someone-else'), false);
    assert.equal(await h.driver.verdict('veto', phase.winner.id), true);
    const [merits] = h.sent('council/merits');
    assert.ok(merits.reward < 0, 'a vetoed proposer loses merit');
    assert.equal(merits.merits.human, 1);
    assert.equal(h.state.council.phase, 'idle');
    assert.equal(h.state.council.next, h.state.world.tick + SESSION_EVERY);
    assert.equal(h.timers.size, 0);
  });

  it('enacts when the human stays silent, and rewards the enactment when its future arrives', async () => {
    const h = councilHost();
    const tick = h.state.world.tick;
    await h.driver.convene();
    h.advance(VERDICT_MS - 1);
    await h.fire();
    assert.equal(h.driver.open, true);
    h.advance(1);
    await h.fire();
    const [enacted] = h.sent('council/enacted');
    assert.equal(enacted.amendment.status, 'enacted');
    const later = stepWorld(compileMachine(h.state.program.machine), h.state.world, LOOKAHEAD).world;
    assert.equal(later.tick, tick + LOOKAHEAD);
    await h.driver.onTick(later, h.state.world.tape);
    assert.equal(h.sent('council/merits')[0].amendment, enacted.amendment.id);
  });

  it('rests when nothing helps, and seats only proposals that fit the program', async () => {
    const still = councilHost({ world: createWorld({ width: WORLD_SIZE, height: WORLD_SIZE, heads: [], initial: 'dance' }) });
    assert.deepEqual(await still.driver.convene(), { session: 1, phase: 'idle' });
    assert.deepEqual(still.sent('council/rested'), [{ session: 1 }]);

    const lost = councilHost({ oracle: async () => ({ id: 'oracle-lost', by: 'oracle', title: 'Sleep', why: '', change: { kind: 'rule', state: 'dance', symbol: 1, member: 'next', value: 'sleep' } }) });
    await lost.driver.convene();
    assert.ok(!lost.state.council.proposals.some((p: any) => p.id === 'oracle-lost'), 'a state the program lacks never reaches a simulation');
    lost.driver.dispose();
  });

  it('reports a session that could not meet', async () => {
    const broken = councilHost({ oracle: () => { throw new Error('the oracle fell over'); } });
    broken.state = { ...broken.state, council: { ...broken.state.council, next: 0 } };
    await broken.driver.onTick(broken.state.world, undefined);
    assert.match(broken.sent('os/notice')[0].text, /could not meet: .*the oracle fell over/);
  });

  it('repeals rule and tempo amendments by their recorded inverse, and nothing else', () => {
    const h = councilHost();
    const original = h.state.program.machine.transitions[8].effects[0].with;
    const changed = structuredClone(h.state.program);
    changed.machine.transitions[8].effects[0].with = 4;
    changed.tempo = 20;
    h.state = { ...h.state, program: changed, council: { ...h.state.council, log: [
      { id: 'a1', status: 'enacted', change: { kind: 'rule' }, inverse: [{ op: 'replace', path: '/transitions/8/effects/0/with', value: original }] },
      { id: 'a2', status: 'enacted', change: { kind: 'tempo', tempo: 20 }, inverse: [], previousTempo: 12 },
      { id: 'a3', status: 'enacted', change: { kind: 'tape', op: 'mirror' }, inverse: [] },
      { id: 'a4', status: 'vetoed', change: { kind: 'tempo', tempo: 3 }, inverse: [] },
    ] } };
    assert.equal(h.driver.repeal('none'), 'not-found');
    assert.equal(h.driver.repeal('a3'), 'not-repealable');
    assert.equal(h.driver.repeal('a4'), 'not-repealable');
    assert.equal(h.driver.repeal('a1'), 'repealed');
    assert.equal(h.state.program.machine.transitions[8].effects[0].with, original);
    assert.equal(h.driver.repeal('a2'), 'repealed');
    assert.equal(h.state.program.tempo, 12);
    assert.equal(h.driver.forecast({ kind: 'tape', op: 'mirror' }).title, 'Fold the floor in half');
  });
});
