/**
 * Radiant OS stage (Pages, Tangle edition): the camera, the figures, the
 * frame composer, both paint backends, the stage widget and the
 * sculpture — still frames, the frame loop, verdict animation, picks and
 * the sculptor.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { renderToString } from '@jarenjs/view';
import { StubDocument, createStubHost, fire, serialize } from '../assistant/dom.stub.ts';
import { HOME_CAMERA, viewOf, project, orbit, dolly, DISTANCE_MAX } from '../../apps/pages/src/os/stage/camera.ts';
import { POSES, person, baby, hand, signGlyph } from '../../apps/pages/src/os/stage/figures.ts';
import { composeFrame, HUMAN_INK, STAGE_THEMES } from '../../apps/pages/src/os/stage/scene.ts';
import type { Motion } from '../../apps/pages/src/os/stage/scene.ts';
import { paintCanvas, toSvg } from '../../apps/pages/src/os/stage/paint.ts';
import { stillFrame, stageWidget, createAnim, absorb, motionAt } from '../../apps/pages/src/os/stage/widget.ts';
import { sculpt, layoutSculpture, composeSculpture, labelOf } from '../../apps/pages/src/os/stage/sculpture.ts';
import { sceneOf } from '../../apps/pages/src/os/app/scene.ts';
import { initialState } from '../../apps/pages/src/os/app/state.ts';
import { compileMachine, stepWorld } from '../../apps/pages/src/os/kernel/machine.ts';

function sceneAfter(ticks = 120, tweak?: (state: any) => void) {
  const state = initialState({ edition: 'test', title: 'Radiant OS' });
  state.world = stepWorld(compileMachine(state.program.machine), state.world, ticks).world;
  tweak?.(state);
  return sceneOf(state);
}
const still = (): Motion => ({ time: 0, now: 0, moving: false, heads: {}, heights: null, stamps: [], effects: [] });
const view = viewOf(HOME_CAMERA, 960, 640);

/** A 2D context that records every call and assignment. */
function recorder() {
  const calls: any[] = [];
  const target: any = { calls };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      return (...args: any[]) => { calls.push([prop, ...args]); };
    },
    set(t, prop, value) {
      t[prop] = value;
      calls.push([`=${String(prop)}`, value]);
      return true;
    },
  });
}

/**
 * A stub host for a surface: a fake window with a clock, optional
 * animation frames and an optional ResizeObserver, and a canvas that has
 * a 2D context only when asked.
 */
function stageHost(options: { canvas?: boolean, raf?: boolean, observer?: boolean } = {}) {
  const frames = new Map<number, (t: number) => void>();
  const listeners = new Map<string, Function>();
  let nextFrame = 1;
  const win: any = {
    devicePixelRatio: 3,
    time: 1000,
    performance: { now: () => win.time },
    addEventListener: (type: string, fn: Function) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
    listeners,
    frames,
    /** Run every pending frame at the window's time. */
    flush() {
      const pending = [...frames.values()];
      frames.clear();
      for (const fn of pending) fn(win.time);
    },
  };
  if (options.raf) {
    win.requestAnimationFrame = (fn: (t: number) => void) => { frames.set(nextFrame, fn); return nextFrame++; };
    win.cancelAnimationFrame = (id: number) => { frames.delete(id); };
  }
  if (options.observer) {
    win.ResizeObserver = class {
      constructor(fn: () => void) { win.resize = fn; }
      observe(el: any) { win.observed = el; }
      disconnect() { win.disconnected = true; }
    };
  }
  const document: any = new StubDocument();
  document.defaultView = win;
  const ctx = options.canvas ? recorder() : null;
  const make = document.createElement.bind(document);
  document.createElement = (tag: string) => {
    const el = make(tag);
    if (tag === 'canvas') {
      el.style = {};
      if (ctx) el.getContext = () => ctx;
    }
    return el;
  };
  const host = document.createElement('div');
  host.clientWidth = 800;
  host.clientHeight = 500;
  return { win, document, host, ctx };
}

describe('the stage', () => {
  it('projects, orbits and dollies the camera', () => {
    assert.ok(Math.abs(project(view, 0, 0, 0)[0] - 480) < 1e-6);
    assert.ok(orbit(HOME_CAMERA, 100, 0).azimuth > HOME_CAMERA.azimuth);
    assert.equal(dolly(HOME_CAMERA, 100).distance, DISTANCE_MAX);
  });

  it('draws figures, signs and the human’s hand', () => {
    assert.equal(person(POSES.dance).strokes.length, 5);
    assert.ok(person(POSES.dance, { head: 'tv' }).screen);
    assert.equal(baby(0).dots.length, 1);
    assert.equal(hand().strokes.length, 6);
    assert.deepEqual(signGlyph({ kind: 'rule', member: 'write', value: 3 }), { strokes: [], swatch: 3 });
    assert.equal(signGlyph({ kind: 'tape', op: 'mirror' }).strokes.length, 3);
  });

  it('composes the floor, the dancers, the seats and the verdict', () => {
    const { items, picks } = composeFrame(sceneAfter(200), view, still());
    assert.deepEqual(picks.map((p) => p.id).sort(), ['architect', 'critic', 'dancer', 'human', 'oracle', 'painter']);
    const winner = { id: 'critic-1', by: 'critic', title: 'Wash', why: '', change: { kind: 'tape', op: 'clear' } };
    const verdict = composeFrame(sceneAfter(80, (s) => { Object.assign(s.council, { phase: 'veto', winner, proposals: [winner], deadline: 9000, window: 9000 }); }), view, still());
    assert.ok(verdict.picks.some((p) => p.kind === 'sign'));
    assert.ok(verdict.items.some((i) => i.t === 'arc'), 'the countdown ring');
    const vetoed = composeFrame(sceneAfter(80), view, { ...still(), time: 5000, moving: true, effects: [{ kind: 'veto', age: 800, by: 'critic', change: winner.change }] });
    assert.ok(vetoed.items.some((i) => i.t === 'line' && i.stroke === HUMAN_INK), 'the hand comes down');
    assert.ok(items.length > 100);
  });

  it('paints the same list to a canvas and to SVG', () => {
    const calls: string[] = [];
    const ctx: any = new Proxy({}, { get: (t: any, p) => (p in t ? t[p] : () => { calls.push(String(p)); }), set: (t: any, p, v) => { t[p] = v; return true; } });
    const items = composeFrame(sceneAfter(40), view, still()).items;
    paintCanvas(ctx, items, '#fff7e6', 960, 640);
    assert.equal(calls[0], 'fillRect');
    const svg = toSvg(items, { width: 960, height: 640, background: '#fff7e6', title: 'Still' });
    assert.match(renderToString(svg as any), /^<svg[^>]*aria-label="Still"/);
    assert.equal(stillFrame(sceneAfter(40), { title: 'Snapshot' })[2][2], 'Snapshot');
  });

  it('mounts as a widget that draws still frames under reduced motion, and animates hops', () => {
    const { document, container } = createStubHost();
    const host = document.createElement('div');
    container.appendChild(host);
    const scene = sceneAfter(30);
    const handle = stageWidget.mount(host, { scene, reduce: true, label: 'Stage' }, () => {}, { document });
    assert.match(serialize(container as any), /aria-label="Stage"/);
    stageWidget.update(handle, { scene: sceneAfter(31), reduce: true, label: 'Stage 31' }, { scene, reduce: true, label: 'Stage' });
    assert.equal(host.getAttribute('aria-label'), 'Stage 31');
    stageWidget.unmount(handle);
    const anim = createAnim(scene);
    const moved = { ...scene, heads: scene.heads.map((h, i) => (i === 0 ? { ...h, x: (h.x + 1) % scene.width } : h)) };
    absorb(anim, moved, 100, 10);
    assert.ok(motionAt(anim, 150, true).heads[scene.heads[0].id].hop > 0.9, 'mid-hop is the top of the jump');
    assert.deepEqual(motionAt(anim, 150, false).heads, {});
  });

  it('sculpts any document into a crowd of figures', () => {
    const layout = layoutSculpture(sculpt({ name: 'radiant', ok: true, list: [1, 'two', null] }));
    assert.equal(layout.nodes.length, 7);
    assert.equal(labelOf("$['list'][2]"), '#2');
    const items = composeSculpture(layout, viewOf({ azimuth: 0.5, elevation: 0.62, distance: 24, lift: 0.6, fov: 0.62 }, 640, 480),
      { time: 0, moving: false, active: new Set(['$']) }, 'dark');
    assert.equal((items[0] as any).fill, STAGE_THEMES.dark.floor);
    assert.ok(items.some((i) => i.t === 'disc' && i.fill === STAGE_THEMES.dark.glow), 'what executes glows');
  });
});

describe('the stage widget', () => {
  it('runs its own frame loop, drifting when the viewer lets go', () => {
    const { host, document, win, ctx } = stageHost({ canvas: true, raf: true, observer: true });
    const scene = sceneAfter(30);
    const handle = stageWidget.mount(host, { scene, tempo: 12 }, () => {}, undefined);
    assert.equal(win.frames.size, 1);
    fire(host, 'keydown', { key: 'ArrowLeft', preventDefault() {}, stopPropagation() {} });
    assert.ok(handle.director.camera.azimuth < HOME_CAMERA.azimuth, 'the arrow keys turn the stage');
    handle.director.cut(HOME_CAMERA);
    host.clientWidth = 640;
    win.resize();
    assert.equal(handle.surface.width, 640, 'the stage follows its host’s size');
    assert.equal(win.frames.size, 1, 'a resize while animating waits for the next frame');
    stageWidget.update(handle, { scene: sceneAfter(31), tempo: 12 }, { scene, tempo: 12 });
    assert.equal(win.frames.size, 1, 'one frame at a time');
    const sparks = handle.fx.particles.length;
    const cheered = { scene: sceneAfter(31), tempo: 12, cheer: { who: 'painter', seq: 1 } };
    stageWidget.update(handle, cheered, { scene: sceneAfter(31), tempo: 12 });
    assert.ok(handle.fx.particles.length > sparks, 'a crew member who built a block hops for joy in sparks');
    const after = handle.fx.particles.length;
    stageWidget.update(handle, cheered, cheered);
    stageWidget.update(handle, { ...cheered, cheer: { who: 'nobody', seq: 2 } }, cheered);
    assert.equal(handle.fx.particles.length, after, 'once per cheer, and only for a member on the stage');
    const azimuth = handle.director.camera.azimuth;
    win.time = 20000;
    win.flush();
    assert.ok(handle.director.camera.azimuth > azimuth, 'the idle camera drifts');
    assert.ok(ctx.calls.some((c: any[]) => c[0] === 'fillRect'));
    assert.equal(win.frames.size, 1, 'and asks for the next frame');
    fire(host, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
    const held = handle.director.camera.azimuth;
    win.time = 20016;
    win.flush();
    assert.equal(handle.director.camera.azimuth, held, 'not while the viewer holds it');
    handle.props = { ...handle.props, reduce: true };
    win.flush();
    assert.equal(win.frames.size, 0, 'reduced motion stops the loop');
    handle.props = { ...handle.props, reduce: false };
    stageWidget.update(handle, handle.props, handle.props);
    stageWidget.unmount(handle);
    assert.equal(win.frames.size, 0, 'unmounting cancels the pending frame');
    win.flush();
    assert.equal(document.defaultView, win);
  });
});
