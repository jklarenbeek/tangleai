/**
 * Window state as a JSON document with pure transitions: what is open, where,
 * in which order, and which window has focus. The shell renders it; the tests
 * drive it headless. Nothing here touches the DOM.
 */
export type Rect = { x: number, y: number, w: number, h: number };
export type WindowState = {
  id: string;
  module: string;
  title: string;
  rect: Rect;
  /** The rect to return to from maximized. */
  restore?: Rect;
  z: number;
  minimized: boolean;
  maximized: boolean;
  /** The smallest size the person may resize it to: the manifest's `minWidth` and `minHeight`. */
  min?: { w: number, h: number };
  /** Maximized by the compact desktop, not by the person: restored when the desktop is wide again. */
  compacted?: boolean;
};
/**
 * `compact`: a narrow desktop (a phone): every window is maximized and only
 * the focused one is shown; the host decides the width (see the shell's
 * `compact` option).
 */
export type Desktop = { windows: WindowState[], focus: string | null, nextId: number, viewport: { w: number, h: number }, compact?: boolean };
export type WindowRequest = { module: string, title: string, width?: number, height?: number, minWidth?: number, minHeight?: number, singleton?: boolean };

export const emptyDesktop = (viewport = { w: 1280, h: 800 }): Desktop => ({ windows: [], focus: null, nextId: 1, viewport });

const topZ = (d: Desktop) => d.windows.reduce((max, w) => Math.max(max, w.z), 0);
const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));
/** Keep at least a grabbable strip of the title bar on screen. */
const GRIP = 48;
const DEFAULT_MIN = { w: 200, h: 120 };
const full = (d: Desktop): Rect => ({ x: 0, y: 0, w: d.viewport.w, h: d.viewport.h });

export function fit(rect: Rect, viewport: Desktop['viewport'], min = { w: 200, h: 120 }): Rect {
  const w = clamp(Math.round(rect.w), min.w, Math.max(min.w, viewport.w));
  const h = clamp(Math.round(rect.h), min.h, Math.max(min.h, viewport.h));
  return { x: clamp(Math.round(rect.x), GRIP - w, viewport.w - GRIP), y: clamp(Math.round(rect.y), 0, viewport.h - 32), w, h };
}

/**
 * Open a window, or focus the existing one of a single-instance module. New
 * windows cascade, sized to the desktop and placed wholly on it; on a compact
 * desktop they open maximized.
 */
export function openWindow(d: Desktop, request: WindowRequest): Desktop {
  if (request.singleton) {
    const existing = d.windows.find(w => w.module === request.module);
    if (existing) return focusWindow({ ...d, windows: d.windows.map(w => w.id === existing.id ? { ...w, minimized: false } : w) }, existing.id);
  }
  const min = { w: request.minWidth ?? DEFAULT_MIN.w, h: request.minHeight ?? DEFAULT_MIN.h };
  const size = fit({ x: 0, y: 0, w: request.width ?? 640, h: request.height ?? 440 }, d.viewport, min);
  const offset = (d.windows.length % 8) * 28;
  // placed from the size it will have, wholly on the desktop where it fits
  const rect = {
    x: clamp(Math.round((d.viewport.w - size.w) / 2) - 84 + offset, 0, Math.max(0, d.viewport.w - size.w)),
    y: clamp(Math.round((d.viewport.h - size.h) / 2) - 60 + offset, 0, Math.max(0, d.viewport.h - size.h)),
    w: size.w, h: size.h,
  };
  const id = `w${d.nextId}`;
  const placed: WindowState = { id, module: request.module, title: request.title, rect, z: topZ(d) + 1, minimized: false, maximized: false, min };
  const win = d.compact ? { ...placed, maximized: true, compacted: true, restore: rect, rect: full(d) } : placed;
  return { ...d, windows: [...d.windows, win], focus: id, nextId: d.nextId + 1 };
}

export function focusWindow(d: Desktop, id: string): Desktop {
  const target = d.windows.find(w => w.id === id);
  if (!target) return d;
  if (d.focus === id && target.z === topZ(d) && !target.minimized) return d;
  const z = topZ(d) + 1;
  return { ...d, focus: id, windows: d.windows.map(w => w.id === id ? { ...w, z, minimized: false } : w) };
}

export function closeWindow(d: Desktop, id: string): Desktop {
  const windows = d.windows.filter(w => w.id !== id);
  const next = windows.filter(w => !w.minimized).sort((a, b) => b.z - a.z)[0];
  return { ...d, windows, focus: d.focus === id ? next?.id ?? null : d.focus };
}

export function moveWindow(d: Desktop, id: string, x: number, y: number): Desktop {
  return { ...d, windows: d.windows.map(w => w.id === id && !w.maximized ? { ...w, rect: fit({ ...w.rect, x, y }, d.viewport, w.min) } : w) };
}

/** Resize, never below the window's own minimum (its manifest's `minWidth` and `minHeight`) unless `min` says otherwise. */
export function resizeWindow(d: Desktop, id: string, width: number, height: number, min?: { w: number, h: number }): Desktop {
  return { ...d, windows: d.windows.map(w => w.id === id && !w.maximized ? { ...w, rect: fit({ ...w.rect, w: width, h: height }, d.viewport, min ?? w.min) } : w) };
}

/** Maximize or restore; on a compact desktop every window stays maximized. */
export function toggleMaximize(d: Desktop, id: string): Desktop {
  if (d.compact) return focusWindow(d, id);
  return focusWindow({ ...d, windows: d.windows.map(w => {
    if (w.id !== id) return w;
    if (w.maximized) return { ...w, maximized: false, compacted: undefined, rect: w.restore ?? w.rect, restore: undefined };
    return { ...w, maximized: true, restore: w.rect, rect: full(d) };
  }) }, id);
}

/**
 * Enter or leave the compact desktop: entering maximizes every window the
 * person had not maximized (marked `compacted`), leaving restores exactly those.
 */
export function setCompact(d: Desktop, compact: boolean): Desktop {
  if ((d.compact === true) === compact) return d;
  return { ...d, compact, windows: d.windows.map(w => {
    if (compact) return w.maximized ? w : { ...w, maximized: true, compacted: true, restore: w.rect, rect: full(d) };
    if (!w.compacted) return w;
    return { ...w, maximized: false, compacted: undefined, rect: fit(w.restore ?? w.rect, d.viewport, w.min), restore: undefined };
  }) };
}

/**
 * A new desktop size, compact or not: entering compact happens before the
 * windows are fitted to the narrower desktop, so each keeps the place and size
 * it returns to.
 */
export function resizeDesktop(d: Desktop, viewport: Desktop['viewport'], compact = d.compact === true): Desktop {
  return setViewport(setCompact({ ...d, viewport }, compact), viewport);
}

/** Whether a window is on screen: not minimized, and on a compact desktop the focused one. */
export const isVisible = (d: Desktop, w: WindowState) => !w.minimized && (!d.compact || d.focus === w.id);

export function minimizeWindow(d: Desktop, id: string): Desktop {
  const windows = d.windows.map(w => w.id === id ? { ...w, minimized: true } : w);
  const next = windows.filter(w => !w.minimized).sort((a, b) => b.z - a.z)[0];
  return { ...d, windows, focus: d.focus === id ? next?.id ?? null : d.focus };
}

export function setTitle(d: Desktop, id: string, title: string): Desktop {
  return { ...d, windows: d.windows.map(w => w.id === id ? { ...w, title } : w) };
}

/** A new viewport keeps every window reachable and maximized windows full size. */
export function setViewport(d: Desktop, viewport: Desktop['viewport']): Desktop {
  return { ...d, viewport, windows: d.windows.map(w => w.maximized ? { ...w, rect: { x: 0, y: 0, w: viewport.w, h: viewport.h } } : { ...w, rect: fit(w.rect, viewport, w.min) }) };
}

/** Windows in stacking order, bottom first. */
export const stacked = (d: Desktop) => [...d.windows].sort((a, b) => a.z - b.z);
