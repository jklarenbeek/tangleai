/**
 * Tape Dancers: a Turing-machine puzzle game for the Radiant arcade. A
 * Haring dancer stands on a one-dimensional tape of paper and three
 * inks; the player programs it with a rule table — for each control
 * state and ink under its feet, the ink to stamp, the step to take and
 * the state to go to, or halt — and presses Run, and the dancer dances
 * the program on the beat until it halts. Each level gives test tapes
 * and what each must become; the program is graded on every one, with
 * stars for solving it, for doing so within the par states and within
 * the par steps, and every graded run feeds the player's skill ladder.
 *
 * The program is a jaren-fsm document (`program.ts`) stepped by the
 * flow engine; the levels are data (`levels.json`, `levels.ts`); every
 * move is a pure function over plain JSON (`state.ts`) that the HUD's
 * buttons and grid, the keys and the language-model tools (`tools.ts`)
 * all reach the same way. This module is the GameModule the arcade
 * hosts: it dispatches actions and keys to those moves.
 */

import {
  CAMERA, addState, advance, createState, cycleCell, hint, nextLevel, openLevel, outcomeOf, removeState, resetRun,
  saveOf, setRule, stepOnce, toggleRun,
} from './state.ts';
import type { DancersState, Move } from './state.ts';
import { draw } from './draw.ts';
import { hud } from './hud.ts';
import { TOOLS } from './tools.ts';
import type { GameModule, GameInput, GameEvent } from '../game.ts';

export { programChars, rulesToProgram, programToRules, compileProgram, runProgram } from './program.ts';
export { LEVELS, TIERS, SKILLS, judge, suggestLevel } from './levels.ts';

export type Handler = (state: DancersState, action: any) => Move;

/** What `act` answers, by action type: the HUD's buttons, its grid's cells and the OS's moves. */
const ACTIONS: Readonly<Record<string, Handler>> = Object.freeze({
  level: (state, action) => openLevel(state, action.id),
  cell: (state, action) => cycleCell(state, action.id),
  rule: (state, action) => setRule(state, action),
  addState: (state) => addState(state),
  removeState: (state, action) => removeState(state, action.state),
  run: (state) => toggleRun(state),
  step: (state) => stepOnce(state),
  reset: (state) => resetRun(state),
  hint: (state) => hint(state),
  next: (state) => nextLevel(state),
});

/** The keys the arcade passes as pressed actions: act runs (or moves on after a solve), hint hints, restart resets. */
const KEYS: Readonly<Record<string, (state: DancersState) => Move>> = Object.freeze({
  act: (state) => (state.verdict?.solved ? nextLevel(state) : toggleRun(state)),
  hint: (state) => hint(state),
  restart: (state) => resetRun(state),
});

/**
 * Answer a discrete move; an action of a type the game does not know
 * changes nothing.
 */
function act(state: DancersState, action: { type: string, [k: string]: any }): Move {
  const handler = Object.hasOwn(ACTIONS, action?.type) ? ACTIONS[action.type] : null;
  return handler ? handler(state, action) : { state, events: [] };
}

/**
 * One fixed tick: the keys pressed since the last one, then the dance
 * clock.
 */
function step(state: DancersState, input: GameInput): Move {
  let next = state;
  const events: GameEvent[] = [];
  for (const key of input.pressed) {
    if (!Object.hasOwn(KEYS, key)) continue;
    const out = KEYS[key](next);
    next = out.state;
    events.push(...out.events);
  }
  const out = advance(next);
  return { state: out.state, events: events.length > 0 ? [...events, ...out.events] : out.events };
}

/** The Tape Dancers game module. */
export const dancers: GameModule = Object.freeze({
  id: 'dancers',
  title: 'Tape Dancers',
  blurb: 'Program a Haring dancer as a Turing machine: a rule table of inks, steps and states, danced on the beat and graded on every tape.',
  track: 'dancers',
  camera: CAMERA,
  duel: false,
  create: createState,
  step,
  act,
  draw,
  hud,
  over: outcomeOf,
  save: saveOf,
  tools: TOOLS,
});
