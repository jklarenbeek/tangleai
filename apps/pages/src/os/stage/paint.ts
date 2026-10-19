/**
 * The two backends of the stage's display list (`scene.ts`):
 *
 *   - `paintCanvas` draws it into a 2D canvas context — the running OS,
 *     sixty frames a second, where a vnode per primitive would be a
 *     thousand DOM nodes rewritten per frame;
 *   - `toSvg` turns it into one `@jarenjs/view` vnode tree — the still
 *     frame for reduced motion, the server render (`renderToString`),
 *     the exported artwork, and every headless test.
 *
 * Both read the same list in the same order, so the two pictures are
 * the same picture.
 */

import type { Item } from './scene.ts';

/** The slice of `CanvasRenderingContext2D` the painter uses. */
export type Context2D = {
  globalAlpha: number, fillStyle: string, strokeStyle: string, lineWidth: number, lineCap: string, lineJoin: string,
  fillRect(x: number, y: number, w: number, h: number): void,
  beginPath(): void, closePath(): void, moveTo(x: number, y: number): void, lineTo(x: number, y: number): void,
  arc(x: number, y: number, r: number, a0: number, a1: number): void,
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void,
  fill(): void, stroke(): void,
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void,
};

/** Draw a display list into a canvas 2D context. */
export function paintCanvas(ctx: Context2D, items: readonly Item[], background: string, width: number, height: number) {
  ctx.globalAlpha = 1;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const item of items) {
    ctx.globalAlpha = item.a ?? 1;
    switch (item.t) {
      case 'poly': {
        ctx.beginPath();
        tracePoints(ctx, item.p);
        ctx.closePath();
        if (item.fill) { ctx.fillStyle = item.fill; ctx.fill(); }
        if (item.stroke && item.w > 0) { ctx.strokeStyle = item.stroke; ctx.lineWidth = item.w; ctx.stroke(); }
        break;
      }
      case 'line': {
        ctx.beginPath();
        tracePoints(ctx, item.p);
        ctx.strokeStyle = item.stroke;
        ctx.lineWidth = item.w;
        ctx.stroke();
        break;
      }
      case 'disc': {
        ctx.beginPath();
        ctx.arc(item.x, item.y, Math.max(0, item.r), 0, Math.PI * 2);
        if (item.fill) { ctx.fillStyle = item.fill; ctx.fill(); }
        if (item.stroke && item.w > 0) { ctx.strokeStyle = item.stroke; ctx.lineWidth = item.w; ctx.stroke(); }
        break;
      }
      case 'rect': {
        ctx.beginPath();
        roundedRect(ctx, item.x, item.y, item.wd, item.ht, item.r);
        if (item.fill) { ctx.fillStyle = item.fill; ctx.fill(); }
        if (item.stroke && item.w > 0) { ctx.strokeStyle = item.stroke; ctx.lineWidth = item.w; ctx.stroke(); }
        break;
      }
      case 'arc': {
        ctx.beginPath();
        ctx.arc(item.x, item.y, Math.max(0, item.r), item.a0, item.a1);
        ctx.strokeStyle = item.stroke;
        ctx.lineWidth = item.w;
        ctx.stroke();
        break;
      }
    }
  }
  ctx.globalAlpha = 1;
}

function tracePoints(ctx: Context2D, p: readonly number[]) {
  ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
}

/**
 * A rounded rectangle path, written out rather than `ctx.roundRect` so
 * engines that predate it draw the same corners.
 */
function roundedRect(ctx: Context2D, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + k, y);
  ctx.lineTo(x + w - k, y);
  ctx.arcTo(x + w, y, x + w, y + k, k);
  ctx.lineTo(x + w, y + h - k);
  ctx.arcTo(x + w, y + h, x + w - k, y + h, k);
  ctx.lineTo(x + k, y + h);
  ctx.arcTo(x, y + h, x, y + h - k, k);
  ctx.lineTo(x, y + k);
  ctx.arcTo(x, y, x + k, y, k);
}

/** Two decimals: enough for a pixel, short enough for a 2000-node SVG. */
const n2 = (v: number) => Math.round(v * 100) / 100;

function pathData(p: readonly number[], closed = false) {
  let d = `M${n2(p[0])} ${n2(p[1])}`;
  for (let i = 2; i < p.length; i += 2) d += `L${n2(p[i])} ${n2(p[i + 1])}`;
  return closed ? `${d}Z` : d;
}

/** The display list as one SVG vnode tree (`@jarenjs/view` format): an `svg` element vnode. */
export function toSvg(items: readonly Item[], frame: { width: number, height: number, background: string, title: string, className?: string }): any[] {
  const children: any[] = [['rect', { x: 0, y: 0, width: frame.width, height: frame.height, fill: frame.background }]];
  for (const item of items) {
    const common: Record<string, any> = item.a !== undefined && item.a < 1 ? { opacity: n2(Math.max(0, item.a)) } : {};
    switch (item.t) {
      case 'poly':
        children.push(['path', { ...common, d: pathData(item.p, true), fill: item.fill ?? 'none',
          stroke: item.stroke ?? 'none', 'stroke-width': n2(item.w), 'stroke-linejoin': 'round' }]);
        break;
      case 'line':
        children.push(['path', { ...common, d: pathData(item.p), fill: 'none', stroke: item.stroke,
          'stroke-width': n2(item.w), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }]);
        break;
      case 'disc':
        children.push(['circle', { ...common, cx: n2(item.x), cy: n2(item.y), r: n2(Math.max(0, item.r)),
          fill: item.fill ?? 'none', stroke: item.stroke ?? 'none', 'stroke-width': n2(item.w) }]);
        break;
      case 'rect':
        children.push(['rect', { ...common, x: n2(item.x), y: n2(item.y), width: n2(Math.max(0, item.wd)),
          height: n2(Math.max(0, item.ht)), rx: n2(item.r), fill: item.fill ?? 'none',
          stroke: item.stroke ?? 'none', 'stroke-width': n2(item.w) }]);
        break;
      case 'arc': {
        const sweep = item.a1 - item.a0;
        if (Math.abs(sweep) < 1e-3) break;
        const x0 = item.x + Math.cos(item.a0) * item.r;
        const y0 = item.y + Math.sin(item.a0) * item.r;
        const x1 = item.x + Math.cos(item.a1) * item.r;
        const y1 = item.y + Math.sin(item.a1) * item.r;
        const large = Math.abs(sweep) > Math.PI ? 1 : 0;
        // a full circle cannot be one arc command; stop just short of it
        const full = Math.abs(sweep) >= Math.PI * 2 - 1e-3;
        const d = full
          ? `M${n2(item.x - item.r)} ${n2(item.y)}a${n2(item.r)} ${n2(item.r)} 0 1 0 ${n2(item.r * 2)} 0a${n2(item.r)} ${n2(item.r)} 0 1 0 ${n2(-item.r * 2)} 0`
          : `M${n2(x0)} ${n2(y0)}A${n2(item.r)} ${n2(item.r)} 0 ${large} 1 ${n2(x1)} ${n2(y1)}`;
        children.push(['path', { ...common, d, fill: 'none', stroke: item.stroke, 'stroke-width': n2(item.w), 'stroke-linecap': 'round' }]);
        break;
      }
    }
  }
  return ['svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: `0 0 ${n2(frame.width)} ${n2(frame.height)}`,
    width: n2(frame.width),
    height: n2(frame.height),
    role: 'img',
    'aria-label': frame.title,
    class: frame.className ?? 'os-stage-svg',
  }, ['title', {}, frame.title], ...children];
}
