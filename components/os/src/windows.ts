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
};
export type Desktop = { windows: WindowState[], focus: string | null, nextId: number, viewport: { w: number, h: number } };
export type WindowRequest = { module: string, title: string, width?: number, height?: number, minWidth?: number, minHeight?: number, singleton?: boolean };

export const emptyDesktop = (viewport = { w: 1280, h: 800 }): Desktop => ({ windows: [], focus: null, nextId: 1, viewport });

const topZ = (d: Desktop) => d.windows.reduce((max, w) => Math.max(max, w.z), 0);
const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));
/** Keep at least a grabbable strip of the title bar on screen. */
const GRIP = 48;

export function fit(rect: Rect, viewport: Desktop['viewport'], min = { w: 200, h: 120 }): Rect {
  const w = clamp(Math.round(rect.w), min.w, Math.max(min.w, viewport.w));
  const h = clamp(Math.round(rect.h), min.h, Math.max(min.h, viewport.h));
  return { x: clamp(Math.round(rect.x), GRIP - w, viewport.w - GRIP), y: clamp(Math.round(rect.y), 0, viewport.h - 32), w, h };
}

/** Open a window, or focus the existing one of a single-instance module. Cascades new windows. */
export function openWindow(d: Desktop, request: WindowRequest): Desktop {
  if (request.singleton) {
    const existing = d.windows.find(w => w.module === request.module);
    if (existing) return focusWindow({ ...d, windows: d.windows.map(w => w.id === existing.id ? { ...w, minimized: false } : w) }, existing.id);
  }
  const offset = (d.windows.length % 8) * 28;
  const w = request.width ?? 640, h = request.height ?? 440;
  const rect = fit({ x: Math.round((d.viewport.w - w) / 2) - 84 + offset, y: Math.round((d.viewport.h - h) / 2) - 60 + offset, w, h }, d.viewport, { w: request.minWidth ?? 200, h: request.minHeight ?? 120 });
  const id = `w${d.nextId}`;
  const win: WindowState = { id, module: request.module, title: request.title, rect, z: topZ(d) + 1, minimized: false, maximized: false };
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
  return { ...d, windows: d.windows.map(w => w.id === id && !w.maximized ? { ...w, rect: fit({ ...w.rect, x, y }, d.viewport) } : w) };
}

export function resizeWindow(d: Desktop, id: string, width: number, height: number, min = { w: 200, h: 120 }): Desktop {
  return { ...d, windows: d.windows.map(w => w.id === id && !w.maximized ? { ...w, rect: fit({ ...w.rect, w: width, h: height }, d.viewport, min) } : w) };
}

export function toggleMaximize(d: Desktop, id: string): Desktop {
  return focusWindow({ ...d, windows: d.windows.map(w => {
    if (w.id !== id) return w;
    if (w.maximized) return { ...w, maximized: false, rect: w.restore ?? w.rect, restore: undefined };
    return { ...w, maximized: true, restore: w.rect, rect: { x: 0, y: 0, w: d.viewport.w, h: d.viewport.h } };
  }) }, id);
}

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
  return { ...d, viewport, windows: d.windows.map(w => w.maximized ? { ...w, rect: { x: 0, y: 0, w: viewport.w, h: viewport.h } } : { ...w, rect: fit(w.rect, viewport) }) };
}

/** Windows in stacking order, bottom first. */
export const stacked = (d: Desktop) => [...d.windows].sort((a, b) => a.z - b.z);
