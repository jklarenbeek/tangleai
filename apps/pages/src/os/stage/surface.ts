/**
 * What the stage and the sculpture widgets share: a drawing surface —
 * a canvas sized to its host at the device pixel ratio, or an SVG tree
 * through `@jarenjs/view` where no 2D context exists — and the hand on
 * the camera: drag to orbit, pinch or wheel to dolly, double-click or
 * `0` to go home, arrow keys to turn, a tap to pick.
 */

import { createDomRenderer } from '@jarenjs/view';
import { orbit, dolly } from './camera.ts';
import type { Camera } from './camera.ts';
import { paintCanvas, toSvg } from './paint.ts';
import type { Context2D } from './paint.ts';
import type { Item } from './scene.ts';

/** Pixels a pointer may travel and still count as a tap. */
const TAP_SLOP = 6;

export type Surface = ReturnType<typeof createSurface>;
export type Hand = {
  get: () => Camera, set: (c: Camera) => void, home: () => Camera, changed: () => void,
  tap?: (e: any) => void, resized: () => void,
};

/** Create the drawing surface inside a widget host. */
export function createSurface(host: any, doc: any) {
  const win: any = doc.defaultView ?? globalThis;
  const canvas: any = doc.createElement('canvas');
  const ctx: Context2D | null = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  const svg: any = ctx ? null : createDomRenderer(host, { document: doc } as any);
  if (ctx) {
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);
  }
  const surface = {
    win, ctx, canvas, svg,
    width: 960, height: 640, dpr: 1,
    /** Size to the host. */
    measure() {
      surface.width = host.clientWidth || 960;
      surface.height = host.clientHeight || 640;
      surface.dpr = Math.min(2, win.devicePixelRatio || 1);
      if (ctx) {
        canvas.width = Math.round(surface.width * surface.dpr);
        canvas.height = Math.round(surface.height * surface.dpr);
        canvas.style.width = `${surface.width}px`;
        canvas.style.height = `${surface.height}px`;
      }
    },
    /** Draw one display list. */
    paint(items: readonly Item[], background: string, title: string) {
      if (ctx) {
        ctx.setTransform(surface.dpr, 0, 0, surface.dpr, 0, 0);
        paintCanvas(ctx, items, background, surface.width, surface.height);
      }
      else if (svg) {
        svg(toSvg(items, { width: surface.width, height: surface.height, background, title }));
      }
    },
    /** The time of a frame, ms. */
    now(): number {
      return win.performance?.now?.() ?? Date.now();
    },
    destroy() {
      svg?.destroy();
    },
  };
  surface.measure();
  return surface;
}

/** Put the viewer's hand on a camera; returns the cleanups. */
export function bindCamera(host: any, surface: Pick<Surface, 'win' | 'measure'>, hand: Hand): Array<() => void> {
  const cleanups: Array<() => void> = [];
  const on = (target: any, type: string, fn: any, opts?: any) => {
    if (typeof target?.addEventListener !== 'function') return;
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  };
  const pointers = new Map<number, { x: number, y: number }>();
  let drag: { moved: number, pinch: number } | null = null;
  const span = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const move = (c: Camera) => { hand.set(c); hand.changed(); };

  on(host, 'pointerdown', (e: PointerEvent) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag = { moved: 0, pinch: span() };
    host.setPointerCapture?.(e.pointerId);
    hand.changed();
  });
  on(host, 'pointermove', (e: PointerEvent) => {
    const last = pointers.get(e.pointerId);
    if (!last || !drag) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {
      const now = span();
      if (drag.pinch > 0 && now > 0) move(dolly(hand.get(), drag.pinch / now));
      drag.pinch = now;
      drag.moved += TAP_SLOP;
      return;
    }
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    move(orbit(hand.get(), dx, dy));
  });
  const release = (e: PointerEvent) => {
    const was = drag;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) drag = null;
    if (was && was.moved < TAP_SLOP && e.type === 'pointerup') hand.tap?.(e);
  };
  on(host, 'pointerup', release);
  on(host, 'pointercancel', release);
  on(host, 'wheel', (e: WheelEvent) => {
    e.preventDefault();
    move(dolly(hand.get(), Math.exp(e.deltaY * 0.0012)));
  }, { passive: false });
  on(host, 'dblclick', () => move(hand.home()));
  on(host, 'keydown', (e: KeyboardEvent) => {
    const step = 18;
    const keys: Record<string, () => Camera> = {
      ArrowLeft: () => orbit(hand.get(), -step, 0),
      ArrowRight: () => orbit(hand.get(), step, 0),
      ArrowUp: () => orbit(hand.get(), 0, -step),
      ArrowDown: () => orbit(hand.get(), 0, step),
      '+': () => dolly(hand.get(), 0.9),
      '=': () => dolly(hand.get(), 0.9),
      '-': () => dolly(hand.get(), 1.1),
      0: () => hand.home(),
    };
    const next = keys[e.key];
    if (!next) return;
    e.preventDefault();
    e.stopPropagation();
    move(next());
  });
  const Observer = surface.win.ResizeObserver;
  if (typeof Observer === 'function') {
    const observer = new Observer(() => { surface.measure(); hand.resized(); });
    observer.observe(host);
    cleanups.push(() => observer.disconnect());
  }
  else {
    on(surface.win, 'resize', () => { surface.measure(); hand.resized(); });
  }
  return cleanups;
}
