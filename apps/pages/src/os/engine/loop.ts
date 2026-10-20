/**
 * What makes a game a game: a lifecycle you can pause, continue, restart
 * and stop, a clock that runs the rules at a fixed rate whatever the
 * display does, and controls that mean the same on a keyboard and a
 * touch screen.
 *
 * The lifecycle is a jaren-fsm document (`GAME_FLOW`) — title, playing,
 * paused, over — whose transitions answer the effects the shell performs
 * (a sound, the music, a reset), so the menu logic is data the Source app
 * can show and a test can read; the OS hosts it with `fsmToApp`, so the
 * pause menu's buttons are the document's events. The loop is the classic fixed-step
 * accumulator: rules advance in equal steps, the frame draws between the
 * last two, and a tab that slept for a minute catches up a few steps and
 * no more instead of fast-forwarding through the game.
 */

import { compileFsm } from '@jarenjs/flow';

/** The game lifecycle. */
export const GAME_FLOW = Object.freeze({
  $fsm: '0.1',
  initial: 'title',
  states: ['title', 'playing', 'paused', 'over'],
  transitions: [
    { from: 'title', event: 'start', to: 'playing', effects: [{ run: 'game', with: 'reset' }, { run: 'sound', with: 'start' }, { run: 'music', with: 'play' }] },
    { from: 'playing', event: 'pause', to: 'paused', effects: [{ run: 'music', with: 'pause' }, { run: 'sound', with: 'click' }] },
    { from: 'paused', event: 'resume', to: 'playing', effects: [{ run: 'music', with: 'resume' }, { run: 'sound', with: 'click' }] },
    { from: 'playing', event: 'finish', to: 'over', effects: [{ run: 'sound', with: 'levelup' }, { run: 'music', with: 'stop' }] },
    { from: 'paused', event: 'restart', to: 'playing', effects: [{ run: 'game', with: 'reset' }, { run: 'music', with: 'play' }] },
    { from: 'over', event: 'restart', to: 'playing', effects: [{ run: 'game', with: 'reset' }, { run: 'music', with: 'play' }] },
    { from: 'playing', event: 'stop', to: 'title', effects: [{ run: 'music', with: 'stop' }, { run: 'sound', with: 'stop' }] },
    { from: 'paused', event: 'stop', to: 'title', effects: [{ run: 'music', with: 'stop' }, { run: 'sound', with: 'stop' }] },
    { from: 'over', event: 'stop', to: 'title', effects: [{ run: 'music', with: 'stop' }] },
  ],
});

let flowMachine: ReturnType<typeof compileFsm> | null = null;

/**
 * Where an event takes a game, and what the shell must do on the way.
 * An event the state has no transition for leaves it where it is.
 */
export function gameStep(state: string, event: string): { state: string, effects: Array<{ run: string, with?: any }>, moved: boolean } {
  flowMachine ??= compileFsm(GAME_FLOW);
  const allowed = GAME_FLOW.transitions.some((t) => t.from === state && t.event === event);
  if (!allowed) return { state, effects: [], moved: false };
  const result = flowMachine.step(state, event, {});
  return { state: result.state, effects: result.effects, moved: result.state !== state || result.effects.length > 0 };
}

/** The events a state answers — what the menu offers. */
export function gameEvents(state: string): string[] {
  return GAME_FLOW.transitions.filter((t) => t.from === state).map((t) => t.event);
}

/** A fixed-step loop. */
export function createLoop(options: {
  update: (dtMs: number) => void,
  render: (alpha: number, now: number) => void,
  frame?: (cb: (t: number) => void) => any, cancel?: (id: any) => void,
  stepMs?: number, maxSteps?: number,
}) {
  const frame = options.frame ?? ((cb: (t: number) => void) => globalThis.requestAnimationFrame(cb));
  const cancel = options.cancel ?? ((id: any) => globalThis.cancelAnimationFrame(id));
  const stepMs = options.stepMs ?? 1000 / 60;
  const maxSteps = options.maxSteps ?? 5;
  let id: any = null;
  let last = -1;
  let carry = 0;
  let paused = false;
  let steps = 0;

  function tick(t: number) {
    id = null;
    if (last < 0) last = t;
    const elapsed = Math.max(0, t - last);
    last = t;
    if (!paused) {
      carry += elapsed;
      let n = 0;
      while (carry >= stepMs && n < maxSteps) {
        options.update(stepMs);
        carry -= stepMs;
        n += 1;
        steps += 1;
      }
      // a long sleep is dropped, not replayed: whole steps go, the phase stays
      if (n === maxSteps) carry %= stepMs;
    }
    options.render(paused ? 1 : carry / stepMs, t);
    id = frame(tick);
  }

  return {
    /** Rule steps run so far. */
    get steps() { return steps; },
    get running() { return id !== null; },
    get paused() { return paused; },
    start() {
      if (id !== null) return;
      last = -1;
      carry = 0;
      id = frame(tick);
    },
    stop() {
      if (id !== null) cancel(id);
      id = null;
    },
    /** Freeze the rules; frames keep drawing (the menu over the frozen game). */
    pause() { paused = true; },
    resume() {
      paused = false;
      // the time spent paused never reaches the rules
      last = -1;
    },
    /** Run one frame at time `t` by hand (tests, a still render). */
    tick,
  };
}

/** Keys to game actions: arrows and WASD move, Space/Enter act, E hints, Esc/P pause. */
export const KEYMAP: Readonly<Record<string, string>> = Object.freeze({
  arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right',
  ' ': 'act', enter: 'act', e: 'hint', escape: 'pause', p: 'pause', r: 'restart', m: 'mute',
});

/**
 * The controls of a game: key presses become actions; held movement keys
 * are tracked for continuous moves. A key typed into a text field is
 * never taken.
 */
export function createInput(
  target: { addEventListener: Function, removeEventListener: Function } | null,
  onAction: (action: string, event?: any) => void,
  keymap: Readonly<Record<string, string>> = KEYMAP,
) {
  const held = new Set<string>();
  const typing = (e: any) => {
    const tag = e?.target?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e?.target?.isContentEditable === true;
  };
  const down = (e: any) => {
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
    const action = keymap[String(e.key).toLowerCase()];
    if (!action) return;
    e.preventDefault?.();
    if (!held.has(action) || !e.repeat) onAction(action, e);
    held.add(action);
  };
  const up = (e: any) => {
    const action = keymap[String(e.key).toLowerCase()];
    if (action) held.delete(action);
  };
  target?.addEventListener('keydown', down);
  target?.addEventListener('keyup', up);
  return {
    held,
    /** Whether an action's key is down. */
    isHeld: (action: string) => held.has(action),
    dispose() {
      target?.removeEventListener('keydown', down);
      target?.removeEventListener('keyup', up);
      held.clear();
    },
  };
}
