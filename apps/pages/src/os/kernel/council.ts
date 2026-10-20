/**
 * The council: who sits in it, what each member proposes, and how the
 * members judge one another's proposals.
 *
 * Radiant OS is governed as a meritocracy with a human veto. Every
 * member has one taste (`metrics.ts`) and a merit — the weight of its
 * vote. A session asks every seat for one amendment, lets every member
 * judge every amendment by SIMULATING it (the same tape unit, the same
 * compiled program, a few hundred steps ahead) against the status quo,
 * and tallies the judgements by merit. The winner then waits for the
 * human, who may always refuse it; the workflow document
 * (`council.workflow.json`) owns that order, the merit document
 * (`merit.dag.json`) owns the arithmetic of reward. This module only
 * supplies the members' judgement — host code a task node calls.
 *
 * Everything is deterministic for a given session seed: proposals draw
 * from `mulberry32`, never from `Math.random`, so a replayed session
 * proposes and votes exactly as it did.
 */

import { mulberry32, randomInt } from '@jarenjs/core/random';
import { applyJSONPatch } from '@jarenjs/json/patch';
import { compileMachine, stepWorld, mirrorWorld, clearWorld } from './machine.ts';
import type { World } from './machine.ts';
import { measure } from './metrics.ts';
import type { Measure, Taste } from './metrics.ts';
import { SYMBOLS, TURNS, programStates, rulePointer } from './program.ts';
import type { Turn } from './program.ts';

export type Member = {
  id: string, name: string, taste: Taste | null, ink: number,
  figure: 'person' | 'tv' | 'baby', pose: string, motto: string,
};
export type Change =
  | { kind: 'rule', state: string, symbol: number, member: 'write' | 'turn' | 'next', value: string | number }
  | { kind: 'tape', op: 'mirror' | 'clear' }
  | { kind: 'tempo', tempo: number };
export type Proposal = { id: string, by: string, title: string, why: string, change: Change };
export type Ballot = { voter: string, proposal: string, vote: number };
export type Program = { machine: any, tempo: number };
export type Outcome = { before: Measure, after: Measure };

/** The seats, in totem order. `ink` is the palette index the member
 * wears; the human wears the orange no tape symbol uses. */
export const MEMBERS: readonly Member[] = Object.freeze([
  { id: 'painter', name: 'Painter', taste: 'balance', ink: 1, figure: 'person', pose: 'jubilant',
    motto: 'every colour gets the floor' },
  { id: 'dancer', name: 'Dancer', taste: 'motion', ink: 2, figure: 'person', pose: 'dance',
    motto: 'leave footprints, not a flood' },
  { id: 'critic', name: 'Critic', taste: 'structure', ink: 3, figure: 'person', pose: 'kick',
    motto: 'draw lines, not noise' },
  { id: 'architect', name: 'Architect', taste: 'symmetry', ink: 4, figure: 'person', pose: 'lift',
    motto: 'what stands on one side stands on the other' },
  { id: 'oracle', name: 'Oracle', taste: 'harmony', ink: 5, figure: 'tv', pose: 'dance',
    motto: 'the language model in the room — it proposes, the documents decide' },
  { id: 'human', name: 'You', taste: null, ink: -1, figure: 'baby', pose: 'crawl',
    motto: 'the veto is yours, always' },
] as Member[]);

/** The members that dance on the tape: every seat with a taste and a body
 * on the floor. The oracle watches from its plinth; the human holds the veto. */
export const DANCERS: readonly string[] = ['painter', 'dancer', 'critic', 'architect'];

/** How many steps a member looks ahead when it judges an amendment. */
export const LOOKAHEAD = 240;

/** A vote is the voter's taste delta over the look-ahead, scaled so a
 * swing of this size is a full yes (or no). */
const VOTE_SCALE = 0.08;

/** Tempo bounds a tempo amendment may ask for, in steps per second. */
export const TEMPO_MIN = 2;
export const TEMPO_MAX = 30;

/** True when a value is a tempo an amendment could have set. */
export const isTempo = (tempo: unknown): tempo is number => Number.isInteger(tempo) && (tempo as number) >= TEMPO_MIN && (tempo as number) <= TEMPO_MAX;

/**
 * Apply one change to a program and a world — the semantics every
 * proposal, simulation and enactment share. Returns the new program,
 * the new world, the RFC 6902 patch applied to the program (empty for
 * tape and tempo changes) and its inverse, which is what a repeal runs.
 */
export function applyChange(program: Program, world: World, change: Change): { program: Program, world: World, patch: any[], inverse: any[] } {
  if (change.kind === 'rule') {
    const states = programStates(program.machine);
    const path = rulePointer(states, change.state, change.symbol, change.member);
    const before = readPointer(program.machine, path);
    const patch = [{ op: 'replace', path, value: change.value }];
    const inverse = [{ op: 'replace', path, value: before }];
    const machine = applyJSONPatch(program.machine, patch as any);
    return { program: { ...program, machine }, world, patch, inverse };
  }
  if (change.kind === 'tempo') {
    const tempo = Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, Math.round(change.tempo)));
    return { program: { ...program, tempo }, world, patch: [], inverse: [] };
  }
  const next = change.op === 'mirror' ? mirrorWorld(world) : clearWorld(world);
  return { program, world: next, patch: [], inverse: [] };
}

/**
 * True when a change names only what the program has: a rule change's
 * state, and the state a `next` change points at. The contract's schema
 * cannot know the program's states, so every road a proposal takes in —
 * `council.propose`, the oracle seam, the queue a session picks up, the
 * enactment — asks this before the change touches a simulation.
 */
export function fitsProgram(change: Change, machine: any): boolean {
  if (change.kind !== 'rule') return true;
  const states = programStates(machine);
  return states.includes(change.state) && (change.member !== 'next' || states.includes(String(change.value)));
}

/** Resolve a JSON Pointer the program layout guarantees exists. */
function readPointer(doc: any, pointer: string): any {
  let at = doc;
  for (const raw of pointer.split('/').slice(1)) at = at[raw.replace(/~1/g, '/').replace(/~0/g, '~')];
  return at;
}

/**
 * Run the status quo and a change side by side for the look-ahead and
 * measure both. Simulation steps the SAME compiled machine the screen
 * runs; a rule change recompiles once (memoized by document identity).
 */
export function simulate(program: Program, world: World, change: Change, steps = LOOKAHEAD): Outcome {
  const base = stepWorld(compileMachine(program.machine), world, steps).world;
  const changed = applyChange(program, world, change);
  // a tempo change does not alter what a step does, only how often one
  // happens: judge it over the steps the new tempo fits into the same time
  const ratio = change.kind === 'tempo' ? changed.program.tempo / program.tempo : 1;
  const after = stepWorld(compileMachine(changed.program.machine), changed.world,
    Math.max(1, Math.round(steps * ratio))).world;
  // liveliness is judged against where each future started from, so a
  // one-shot tape change is not mistaken for the machine's own motion
  return { before: measure(base, world.tape), after: measure(after, changed.world.tape) };
}

/** A member's vote on a simulated outcome, in [-1, 1]. */
export function voteOf(member: Member, outcome: { before: Partial<Measure>, after: Partial<Measure> }): number {
  if (member.taste === null) return 0;
  const delta = (outcome.after[member.taste] ?? 0) - (outcome.before[member.taste] ?? 0);
  return Math.max(-1, Math.min(1, delta / VOTE_SCALE));
}

/** A readable name for a symbol, for titles and the rule table. */
export const SYMBOL_NAMES: readonly string[] = Object.freeze(['paper', 'blue', 'amber', 'red', 'green', 'cyan']);

/** A readable name for a turn. */
export const TURN_NAMES: Readonly<Record<Turn, string>> = Object.freeze({ L: 'turn left', R: 'turn right', U: 'turn around', N: 'go straight' });

/** The title a proposal carries on its sign. */
export function describeChange(change: Change): string {
  if (change.kind === 'tape') return change.op === 'mirror' ? 'Fold the floor in half' : 'Wash the floor clean';
  if (change.kind === 'tempo') return `Dance at ${change.tempo} steps a second`;
  const when = `when ${change.state} reads ${SYMBOL_NAMES[change.symbol]}`;
  if (change.member === 'write') return `${cap(when)}, paint ${SYMBOL_NAMES[change.value as number]}`;
  if (change.member === 'turn') return `${cap(when)}, ${TURN_NAMES[change.value as Turn]}`;
  return `${cap(when)}, become ${change.value}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Draw candidate changes for one member: a handful of single-rule
 * edits, plus the one-shot the member's temperament reaches for.
 */
export function candidates(member: Member, program: Program, random: () => number, count = 6): Change[] {
  const states = programStates(program.machine);
  const out: Change[] = [];
  for (let i = 0; i < count; i++) {
    const state = states[randomInt(random, 0, states.length)];
    const symbol = randomInt(random, 0, SYMBOLS);
    const roll = random();
    if (member.id === 'painter' || (roll < 0.45 && member.id !== 'dancer')) {
      out.push({ kind: 'rule', state, symbol, member: 'write', value: randomInt(random, 0, SYMBOLS) });
    }
    else if (member.id === 'dancer' || roll < 0.85) {
      out.push({ kind: 'rule', state, symbol, member: 'turn', value: TURNS[randomInt(random, 0, TURNS.length)] });
    }
    else {
      out.push({ kind: 'rule', state, symbol, member: 'next', value: states[randomInt(random, 0, states.length)] });
    }
  }
  if (member.id === 'architect') out.push({ kind: 'tape', op: 'mirror' });
  if (member.id === 'critic') out.push({ kind: 'tape', op: 'clear' });
  if (member.id === 'dancer') {
    out.push({ kind: 'tempo', tempo: Math.min(TEMPO_MAX, program.tempo + 4) });
    out.push({ kind: 'tempo', tempo: Math.max(TEMPO_MIN, program.tempo - 4) });
  }
  return out;
}

/** True when a change would leave the program exactly as it is. */
function isNoop(program: Program, change: Change): boolean {
  if (change.kind !== 'rule') return change.kind === 'tempo' && change.tempo === program.tempo;
  const path = rulePointer(programStates(program.machine), change.state, change.symbol, change.member);
  return readPointer(program.machine, path) === change.value;
}

/**
 * One member's proposal for this session: the candidate that best
 * serves its own taste WITHOUT costing the shared harmony — a member
 * that only ever helped itself would be outvoted, and its merit would
 * wither, so the score it maximizes weighs both. `null` when nothing
 * it can think of helps.
 */
export function propose(member: Member, program: Program, world: World, seed: number): Proposal | null {
  const taste = member.taste;
  if (taste === null) return null;
  const random = mulberry32((seed ^ hashString(member.id)) >>> 0);
  let best: { change: Change, outcome: Outcome } | null = null;
  let bestScore = 0;
  for (const change of candidates(member, program, random)) {
    if (isNoop(program, change)) continue;
    const outcome = simulate(program, world, change);
    const own = outcome.after[taste] - outcome.before[taste];
    const shared = outcome.after.harmony - outcome.before.harmony;
    const score = 0.6 * own + 0.4 * shared;
    if (score > bestScore) { bestScore = score; best = { change, outcome }; }
  }
  if (best === null) return null;
  const own = best.outcome.after[taste] - best.outcome.before[taste];
  return {
    id: `${member.id}-${seed.toString(36)}`,
    by: member.id,
    title: describeChange(best.change),
    why: `${member.name} foresees ${taste} ${signed(own)} and harmony `
      + `${signed(best.outcome.after.harmony - best.outcome.before.harmony)} over ${LOOKAHEAD} steps.`,
    change: best.change,
  };
}

const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(3)}`;

/**
 * Every voting member's judgement of every proposal. The proposer
 * judges its own proposal like anyone else — by simulation, not by
 * pride — and the human casts no automatic vote (a cheer, when given,
 * arrives as its own ballot).
 */
export function deliberate(proposals: readonly Proposal[], program: Program, world: World): { ballots: Ballot[], outcomes: Record<string, Outcome> } {
  const ballots: Ballot[] = [];
  const outcomes: Record<string, Outcome> = {};
  for (const proposal of proposals) {
    const outcome = simulate(program, world, proposal.change);
    outcomes[proposal.id] = outcome;
    for (const member of MEMBERS) {
      if (member.taste === null) continue;
      ballots.push({ voter: member.id, proposal: proposal.id, vote: round3(voteOf(member, outcome)) });
    }
  }
  return { ballots, outcomes };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** A stable 32-bit hash of a string (FNV-1a), for per-member seeds. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
