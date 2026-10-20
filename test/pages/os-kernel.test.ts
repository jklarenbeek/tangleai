/**
 * Radiant OS kernel (Pages, Tangle edition): the program as a jaren-fsm
 * document, the tape unit, the tastes and the council's judgement — pure,
 * deterministic, headless.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mulberry32 } from '@jarenjs/core/random';
import {
  SYMBOLS, TURNS, DEFAULT_RULES, rulesToFsm, fsmToRules, rulePointer, programStates, isProgram,
} from '../../apps/pages/src/os/kernel/program.ts';
import { compileMachine, createWorld, stepWorld, mirrorWorld, clearWorld, isWorld } from '../../apps/pages/src/os/kernel/machine.ts';
import { balance, symmetry, structure, motion, measure, roundMeasure } from '../../apps/pages/src/os/kernel/metrics.ts';
import {
  MEMBERS, DANCERS, TEMPO_MIN, TEMPO_MAX, applyChange, simulate, voteOf, describeChange,
  candidates, propose, deliberate, hashString, SYMBOL_NAMES, fitsProgram, isTempo,
} from '../../apps/pages/src/os/kernel/council.ts';
import type { Member } from '../../apps/pages/src/os/kernel/council.ts';
import { START, WORLD_SIZE } from '../../apps/pages/src/os/app/state.ts';

const program = () => ({ machine: rulesToFsm(DEFAULT_RULES), tempo: 12 });
const startWorld = () => createWorld({
  width: WORLD_SIZE, height: WORLD_SIZE,
  heads: DANCERS.map((id) => ({ id, ...START[id] })), initial: 'dance',
});
const member = (id: string) => MEMBERS.find((m) => m.id === id) as Member;

describe('the program document', () => {
  it('round-trips the rule table through jaren-fsm and addresses each rule by pointer', () => {
    const doc = rulesToFsm(DEFAULT_RULES);
    assert.equal(doc.$fsm, '0.1');
    assert.equal(doc.transitions.length, 2 * SYMBOLS);
    assert.deepEqual(fsmToRules(doc), DEFAULT_RULES);
    assert.deepEqual(programStates(doc), ['dance', 'leap']);
    assert.deepEqual(programStates({ states: [{ id: 'a' }, 'b'] }), ['a', 'b']);
    assert.equal(rulePointer(['dance', 'leap'], 'leap', 3, 'turn'), '/transitions/9/effects/1/with');
    assert.equal(rulePointer(['dance', 'leap'], 'dance', 5, 'next'), '/transitions/5/to');
    assert.throws(() => rulePointer(['dance'], 'nope', 0, 'write'), RangeError);
    assert.throws(() => rulesToFsm({}), RangeError);
    assert.throws(() => rulesToFsm({ a: [{ write: 0, turn: 'L', next: 'a' }] }), /must answer each/);
    assert.deepEqual(TURNS, ['L', 'R', 'U', 'N']);
  });

  it('tells a program it can run from one it cannot', () => {
    const doc = rulesToFsm(DEFAULT_RULES);
    assert.equal(isProgram(doc), true);
    const broken = (edit: (d: any) => void) => { const d = structuredClone(doc); edit(d); return isProgram(d); };
    assert.equal(broken((d) => { d.initial = 'sleep'; }), false);
    assert.equal(broken((d) => { d.transitions.pop(); }), false);
    assert.equal(broken((d) => { d.transitions[3].to = 'sleep'; }), false);
    assert.equal(broken((d) => { d.transitions[3].effects[0].with = 6; }), false);
    assert.equal(broken((d) => { d.transitions[3].effects[1].with = 'X'; }), false);
    assert.equal(broken((d) => { [d.transitions[0], d.transitions[1]] = [d.transitions[1], d.transitions[0]]; }), false);
    assert.equal(isProgram(null), false);
  });
});

describe('the tape unit', () => {
  it('steps purely, memoizes the compiled program and wraps the torus', () => {
    const doc = rulesToFsm(DEFAULT_RULES);
    const machine = compileMachine(doc);
    assert.equal(compileMachine(doc), machine);
    const world = startWorld();
    const before = JSON.stringify(world);
    const { world: next, fired, errors } = stepWorld(machine, world, 1);
    assert.equal(JSON.stringify(world), before, 'the input world is untouched');
    assert.equal(next.tick, 1);
    assert.equal(fired.length, DANCERS.length);
    assert.deepEqual(errors, []);
    const edge = createWorld({ width: 3, height: 3, heads: [{ id: 'h', x: 0, y: 0, dir: 0 }], initial: 'dance' });
    const straight = rulesToFsm({ dance: Array.from({ length: SYMBOLS }, () => ({ write: 1, turn: 'N' as const, next: 'dance' })) });
    assert.equal(stepWorld(compileMachine(straight), edge, 1).world.heads[0].y, 2, 'north off the top wraps to the bottom');
    assert.equal(stepWorld(compileMachine(straight), { ...edge, heads: [{ ...edge.heads[0], state: 'gone' }] }, 1).world.heads[0].state, 'dance');
  });

  it('folds and washes the floor, and knows a world it can step', () => {
    const w = { ...startWorld(), tape: startWorld().tape.map((_, i) => i % 3) };
    const folded = mirrorWorld(w);
    assert.equal(folded.tape[0], folded.tape[WORLD_SIZE - 1]);
    assert.ok(clearWorld(w).tape.every((s) => s === 0));
    assert.equal(isWorld(startWorld()), true);
    assert.equal(isWorld({ ...startWorld(), tape: [] }), false);
    assert.equal(isWorld({ ...startWorld(), heads: [{ id: 'h', x: 99, y: 0, dir: 0, state: 'dance' }] }), false);
    assert.equal(isWorld('floor'), false);
  });
});

describe('the tastes', () => {
  it('score in [0, 1]', () => {
    const tape = Array.from({ length: 400 }, (_, i) => (i * 7) % SYMBOLS);
    for (const v of [balance(tape), symmetry(tape, 20, 20), structure(tape, 20, 20), motion(tape), motion(tape, tape)]) {
      assert.ok(v >= 0 && v <= 1, String(v));
    }
    assert.equal(balance(new Array(400).fill(2)), 0);
    assert.equal(symmetry(new Array(400).fill(0), 20, 20), 0, 'blank paper is not symmetric art');
    assert.equal(roundMeasure({ a: 0.123456 }).a, 0.1235);
  });

  it('the default program keeps dancing, uses every ink, and leaves the council work', () => {
    const machine = compileMachine(rulesToFsm(DEFAULT_RULES));
    let world = startWorld();
    for (const ticks of [600, 2400]) {
      const past = stepWorld(machine, world, ticks - 240 - world.tick).world;
      world = stepWorld(machine, past, 240).world;
      const m = measure(world, past.tape);
      assert.ok(m.motion > 0.5, `still moving at ${ticks}: ${m.motion}`);
      assert.ok(m.balance > 0.8, `every ink at ${ticks}: ${m.balance}`);
      assert.ok(m.harmony < 0.7, `room to improve at ${ticks}: ${m.harmony}`);
    }
  });
});

describe('the council', () => {
  it('applies, simulates, votes on and describes changes', () => {
    const p = program();
    const w = stepWorld(compileMachine(p.machine), startWorld(), 200).world;
    const rule = applyChange(p, w, { kind: 'rule', state: 'leap', symbol: 2, member: 'write', value: 4 });
    assert.equal(fsmToRules(rule.program.machine).leap[2].write, 4);
    assert.deepEqual(rule.inverse, [{ op: 'replace', path: '/transitions/8/effects/0/with', value: DEFAULT_RULES.leap[2].write }]);
    assert.equal(applyChange(p, w, { kind: 'tempo', tempo: 99 }).program.tempo, TEMPO_MAX);
    assert.equal(applyChange(p, w, { kind: 'tempo', tempo: 0 }).program.tempo, TEMPO_MIN);
    const outcome = simulate(p, w, { kind: 'tape', op: 'mirror' });
    assert.ok(outcome.after.symmetry > outcome.before.symmetry);
    assert.ok(voteOf(member('architect'), outcome) > 0);
    assert.equal(voteOf(member('human'), outcome), 0);
    assert.equal(describeChange({ kind: 'rule', state: 'dance', symbol: 2, member: 'write', value: 3 }), 'When dance reads amber, paint red');
    assert.equal(describeChange({ kind: 'rule', state: 'leap', symbol: 0, member: 'turn', value: 'U' }), 'When leap reads paper, turn around');
    assert.equal(describeChange({ kind: 'tempo', tempo: 9 }), 'Dance at 9 steps a second');
    assert.equal(SYMBOL_NAMES.length, SYMBOLS);
  });

  it('admits only changes that name what the program has', () => {
    const machine = program().machine;
    assert.equal(fitsProgram({ kind: 'rule', state: 'sleep', symbol: 1, member: 'write', value: 2 }, machine), false);
    assert.equal(fitsProgram({ kind: 'rule', state: 'dance', symbol: 1, member: 'next', value: 'sleep' }, machine), false);
    assert.equal(fitsProgram({ kind: 'rule', state: 'dance', symbol: 1, member: 'next', value: 'leap' }, machine), true);
    assert.equal(fitsProgram({ kind: 'tape', op: 'clear' }, machine), true);
    assert.equal(isTempo(12), true);
    assert.equal(isTempo(31), false);
  });

  it('proposes deterministically, by temperament, and judges every proposal', () => {
    const p = program();
    const w = stepWorld(compileMachine(p.machine), startWorld(), 300).world;
    assert.ok(candidates(member('dancer'), p, mulberry32(7), 12).some((c) => c.kind === 'tempo'));
    assert.ok(candidates(member('architect'), p, mulberry32(7), 12).some((c) => c.kind === 'tape' && c.op === 'mirror'));
    const proposals = MEMBERS.map((m) => propose(m, p, w, 42)).filter((x) => x !== null);
    assert.ok(proposals.length >= 2);
    assert.deepEqual(MEMBERS.map((m) => propose(m, p, w, 42)).filter((x) => x !== null), proposals, 'same seed, same proposals');
    const { ballots, outcomes } = deliberate(proposals, p, w);
    assert.equal(ballots.length, proposals.length * MEMBERS.filter((m) => m.taste !== null).length);
    assert.deepEqual(Object.keys(outcomes).sort(), proposals.map((x) => x.id).sort());
    assert.notEqual(hashString('painter'), hashString('dancer'));
  });
});
