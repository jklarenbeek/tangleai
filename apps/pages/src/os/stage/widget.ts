/**
 * The stage widget: the one imperative island of the OS chrome,
 * registered with `@jarenjs/app` under the name `stage` (VIEW-FORMAT §7).
 * The view stylesheet hands it the scene document as props; the widget
 * owns its host's subtree (`surface.ts`), its frame loop and its camera.
 *
 * The app never dispatches per frame. A state change arrives as one
 * `update` with a new scene; the widget turns the difference into
 * animation state (a head hopping to its next cell, a block rising, the
 * veto hand coming down) and its own `requestAnimationFrame` loop draws
 * the in-between frames. The only thing it sends back is a pick — the
 * figure, sign or cell the viewer tapped — through the binding its props
 * carry (`onPick`), composed with what was picked.
 *
 * Reduced motion (`props.reduce`) draws the final state of every change
 * at once and runs no loop: the camera still answers the viewer's hand,
 * because a frame drawn on request is not an animation.
 */

import { HOME_CAMERA, viewOf, project } from './camera.ts';
import type { Camera } from './camera.ts';
import { composeFrame, blockHeight, EFFECT_MS, themeOf } from './scene.ts';
import type { Scene, Motion } from './scene.ts';
import { toSvg } from './paint.ts';
import { createSurface, bindCamera } from './surface.ts';

export type StageProps = { scene: Scene, reduce?: boolean, label?: string, onPick?: any, tempo?: number };
type Hop = { fx: number, fz: number, tx: number, tz: number, start: number, dur: number };
export type Anim = ReturnType<typeof createAnim>;

/** How long a head takes to hop one cell, at most (it is also bounded by the tick). */
const HOP_MS = 220;
/** How long a block takes to rise to a new height. */
const RISE_MS = 340;
/** After the viewer lets go, the camera waits this long before drifting again. */
const IDLE_MS = 9000;
/** How far the idle camera drifts per frame, radians. */
const DRIFT = 0.004;

/** easeOutBack: arrives with a little overshoot, the way a stamp lands. */
const settle = (k: number) => {
  const c = 1.70158;
  const x = k - 1;
  return 1 + (c + 1) * x * x * x + c * x * x;
};

/**
 * The still frame of a scene as an SVG vnode — the widget's `ssr`, the
 * artwork export and the frame a host without a canvas draws.
 */
export function stillFrame(scene: Scene, options: { width?: number, height?: number, camera?: Camera, title?: string } = {}): any[] {
  const width = options.width ?? 960;
  const height = options.height ?? 640;
  const view = viewOf(options.camera ?? HOME_CAMERA, width, height);
  const { items } = composeFrame(scene, view, stillMotion());
  return toSvg(items, { width, height, background: themeOf(scene.theme).paper, title: options.title ?? 'Radiant OS stage' });
}

/** The motion of a frame in which nothing moves. */
function stillMotion(): Motion {
  return { time: 0, now: Date.now(), moving: false, heads: {}, heights: null, stamps: [], effects: [] };
}

/** The widget definition. */
export const stageWidget = {
  mount(host: any, props: StageProps, emit: (binding: any, event?: any) => void, context?: { document?: any }) {
    const surface = createSurface(host, context?.document ?? host.ownerDocument);
    const handle: any = {
      host, emit, surface, props,
      camera: { ...HOME_CAMERA },
      raf: 0, alive: true, lastInput: -Infinity,
      picks: [], view: null,
      anim: createAnim(props.scene),
    };
    host.setAttribute('tabindex', '0');
    host.setAttribute('role', 'img');
    host.setAttribute('aria-label', props.label ?? 'Radiant OS stage');
    handle.cleanups = bindCamera(host, surface, {
      get: () => handle.camera,
      set: (c: Camera) => { handle.camera = c; },
      home: () => ({ ...HOME_CAMERA }),
      changed: () => { handle.lastInput = surface.now(); if (handle.props.reduce) schedule(handle); },
      tap: (e: any) => pick(handle, e),
      resized: () => { if (handle.props.reduce) schedule(handle); },
    });
    schedule(handle);
    return handle;
  },

  update(handle: any, props: StageProps, prev?: StageProps) {
    handle.props = props;
    if (props.label !== prev?.label) handle.host.setAttribute('aria-label', props.label ?? 'Radiant OS stage');
    absorb(handle.anim, props.scene, handle.surface.now(), props.tempo ?? 12);
    schedule(handle);
  },

  unmount(handle: any) {
    handle.alive = false;
    if (handle.raf) handle.surface.win.cancelAnimationFrame?.(handle.raf);
    for (const off of handle.cleanups) off();
    handle.surface.destroy();
  },

  ssr(props: StageProps) {
    return stillFrame(props.scene, { title: props.label });
  },
};

/** Ask for a frame: the next one when animating, otherwise draw now. */
function schedule(handle: any) {
  if (!handle.alive) return;
  const win = handle.surface.win;
  if (handle.props.reduce || typeof win.requestAnimationFrame !== 'function') {
    draw(handle, handle.surface.now());
    return;
  }
  if (handle.raf) return;
  const loop = (t: number) => {
    handle.raf = 0;
    if (!handle.alive) return;
    draw(handle, t);
    if (!handle.props.reduce) handle.raf = win.requestAnimationFrame(loop);
  };
  handle.raf = win.requestAnimationFrame(loop);
}

/** Draw one frame at time `t`. */
function draw(handle: any, t: number) {
  const moving = !handle.props.reduce;
  if (moving && t - handle.lastInput > IDLE_MS) {
    handle.camera = { ...handle.camera, azimuth: handle.camera.azimuth + DRIFT };
  }
  const { surface } = handle;
  const view = viewOf(handle.camera, surface.width, surface.height);
  const { items, picks } = composeFrame(handle.props.scene, view, motionAt(handle.anim, t, moving));
  handle.picks = picks;
  handle.view = view;
  surface.paint(items, themeOf(handle.props.scene.theme).paper, handle.props.label ?? 'Radiant OS stage');
}

/**
 * Animation state for a scene: where each head is coming from, how high
 * each block stands, which stamps and effects are still playing.
 */
export function createAnim(scene: Scene) {
  const cells = scene.width * scene.height;
  const heights = new Float64Array(cells);
  for (let i = 0; i < cells; i++) heights[i] = blockHeight(scene.tape[i] ?? 0);
  return {
    scene,
    heads: new Map<string, Hop>(),
    from: Float64Array.from(heights),
    to: Float64Array.from(heights),
    rise: new Float64Array(cells).fill(-Infinity),
    stamps: [] as Array<{ cell: number, start: number }>,
    effects: [] as Array<{ kind: string, start: number, by?: string, change?: any, seq: number }>,
    seen: Math.max(0, ...(scene.events ?? []).map((e) => e.seq)),
  };
}

/** Fold a new scene into the animation state. */
export function absorb(anim: Anim, scene: Scene, t: number, tempo: number) {
  const previous = anim.scene;
  anim.scene = scene;
  if (previous.width !== scene.width || previous.height !== scene.height) {
    Object.assign(anim, createAnim(scene));
    return;
  }
  const hw = scene.width / 2;
  const hh = scene.height / 2;
  const dur = Math.min(HOP_MS, 1000 / Math.max(1, tempo));
  for (const head of scene.heads) {
    const before = previous.heads.find((h) => h.id === head.id);
    const tx = head.x - hw + 0.5;
    const tz = head.y - hh + 0.5;
    if (!before) { anim.heads.set(head.id, { fx: tx, fz: tz, tx, tz, start: t, dur: 0 }); continue; }
    const steps = Math.abs(before.x - head.x) + Math.abs(before.y - head.y);
    const current = positionAt(anim.heads.get(head.id), t) ?? { x: before.x - hw + 0.5, z: before.y - hh + 0.5 };
    // one cell over hops; a wrap round the folded tape or a burst of
    // steps between two frames lands at once
    if (steps === 1) anim.heads.set(head.id, { fx: current.x, fz: current.z, tx, tz, start: t, dur });
    else if (steps > 1) anim.heads.set(head.id, { fx: tx, fz: tz, tx, tz, start: t, dur: 0 });
  }
  if (scene.tape !== previous.tape) {
    for (let i = 0; i < anim.to.length; i++) {
      const next = blockHeight(scene.tape[i] ?? 0);
      if (next === anim.to[i]) continue;
      anim.from[i] = heightAt(anim, i, t);
      anim.to[i] = next;
      anim.rise[i] = t;
      anim.stamps.push({ cell: i, start: t });
    }
    if (anim.stamps.length > 64) anim.stamps.splice(0, anim.stamps.length - 64);
  }
  for (const event of scene.events ?? []) {
    if (event.seq <= anim.seen) continue;
    anim.seen = Math.max(anim.seen, event.seq);
    anim.effects.push({ kind: event.kind, by: event.by, change: event.change, start: t, seq: event.seq });
  }
}

function positionAt(hop: Hop | undefined, t: number) {
  if (!hop) return null;
  const k = hop.dur <= 0 ? 1 : Math.min(1, Math.max(0, (t - hop.start) / hop.dur));
  return { x: hop.fx + (hop.tx - hop.fx) * k, z: hop.fz + (hop.tz - hop.fz) * k, hop: Math.sin(k * Math.PI) };
}

function heightAt(anim: Anim, i: number, t: number) {
  const k = Math.min(1, Math.max(0, (t - anim.rise[i]) / RISE_MS));
  return anim.from[i] + (anim.to[i] - anim.from[i]) * settle(k);
}

/** The motion of the frame at time `t`. */
export function motionAt(anim: Anim, t: number, moving: boolean): Motion {
  if (!moving) return stillMotion();
  const heads: Motion['heads'] = {};
  for (const [id, hop] of anim.heads) heads[id] = positionAt(hop, t)!;
  const heights = new Float64Array(anim.to.length);
  for (let i = 0; i < heights.length; i++) heights[i] = heightAt(anim, i, t);
  anim.stamps = anim.stamps.filter((s) => t - s.start < 600);
  const longest = Math.max(...Object.values(EFFECT_MS));
  anim.effects = anim.effects.filter((e) => t - e.start < longest);
  return {
    time: t,
    now: Date.now(),
    moving: true,
    heads,
    heights,
    stamps: anim.stamps.map((s) => ({ cell: s.cell, age: t - s.start })),
    effects: anim.effects.map((e) => ({ kind: e.kind, by: e.by, change: e.change, age: t - e.start })),
  };
}

/**
 * Resolve a tap to the figure, sign or cell under it and emit the pick
 * binding the view gave the stage.
 */
export function pick(handle: any, e: { clientX: number, clientY: number }) {
  const binding = handle.props.onPick;
  if (!binding || !handle.view) return;
  const rect = handle.host.getBoundingClientRect?.() ?? { left: 0, top: 0 };
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  let hit: any = null;
  let best = Infinity;
  for (const p of handle.picks) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < p.r && d < best) { best = d; hit = { kind: p.kind, id: p.id }; }
  }
  if (!hit) {
    const scene: Scene = handle.props.scene;
    const hw = scene.width / 2;
    const hh = scene.height / 2;
    for (let j = 0; j < scene.height; j++) {
      for (let i = 0; i < scene.width; i++) {
        const cell = j * scene.width + i;
        const [cx, cy] = project(handle.view, i - hw + 0.5, blockHeight(scene.tape[cell]), j - hh + 0.5);
        const d = Math.hypot(cx - x, cy - y);
        if (d < best) { best = d; hit = { kind: 'cell', id: String(cell), x: i, y: j, symbol: scene.tape[cell] }; }
      }
    }
    if (best > 48) hit = null;
  }
  if (!hit) return;
  const base = typeof binding === 'string' ? { action: binding } : binding;
  handle.emit({ ...base, with: { ...(base.with ?? {}), ...hit } }, e);
}
