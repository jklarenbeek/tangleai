/**
 * Drawing helpers the games share with the desk, in the stage's own
 * display-list vocabulary: a lit outlined block, a ground slab, water
 * drawn as moving wave strokes, a hard shadow, a cut-out figure (posed or
 * simulated by a ragdoll), and a label standing over a point. Each answers
 * a painter's group `{ d, items }` — its distance from the eye and what it
 * draws — and `flatten` paints a set of groups far to near, so a game
 * composes its world the way the desk composes the tape.
 */

import { lerpColor } from '@jarenjs/core/color';
import { project, depthOf } from '../stage/camera.ts';
import type { View } from '../stage/camera.ts';
import { cutout } from '../stage/scene.ts';
import type { Item } from '../stage/scene.ts';
import type { Shape } from '../stage/figures.ts';
import { shade, shadowPolygon } from './light.ts';
import type { Lighting } from './light.ts';

export type Group = { d: number, items: Item[] };
export type Theme = { ink: string, paper: string, floor: string, shade: string, glow: string, grid: string, ray: string, neon?: boolean };
export type Box = { x0: number, x1: number, z0: number, z1: number, y0?: number, y1: number };

const flat = (view: View, pts: number[][]): number[] => pts.flatMap(([x, y, z]) => project(view, x, y, z).slice(0, 2));

/**
 * A solid outlined block: the faces the eye can see, each shaded by the
 * light (cel bands) or, without one, by the desk's two fixed tones.
 * `top` recolours the lid (a lit tile, a painted cell).
 */
export function blockGroup(view: View, box: Box, color: string, options: { theme: Theme, light?: Lighting | null, px?: number, top?: string }): Group {
  const { theme, light = null, px = 1 } = options;
  const { x0, x1, z0, z1, y1 } = box;
  const y0 = box.y0 ?? 0;
  const [ex, ey, ez] = view.eye;
  const items: Item[] = [];
  const neon = theme.neon === true;
  const tone = (normal: [number, number, number], fallback: number) => (neon
    ? lerpColor(theme.floor, color, 0.34 - fallback * 0.5)
    : light ? shade(color, normal, light, theme.shade) : lerpColor(color, theme.shade, fallback));
  const quad = (pts: number[][], fill: string) => {
    items.push({ t: 'poly', p: flat(view, pts), fill, stroke: neon ? color : theme.ink, w: 2.6 * px });
  };
  if (ez > z1) quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], tone([0, 0, 1], 0.16));
  else if (ez < z0) quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], tone([0, 0, -1], 0.16));
  if (ex > x1) quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], tone([1, 0, 0], 0.32));
  else if (ex < x0) quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], tone([-1, 0, 0], 0.32));
  if (ey > y1) {
    const lid = options.top ?? color;
    quad([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], neon ? lerpColor(theme.floor, lid, 0.42) : light ? shade(lid, [0, 1, 0], light, theme.shade) : lid);
  }
  return { d: depthOf(view, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), items };
}

/** A flat slab of ground at height `y` (drawn under everything that stands on it). */
export function slabItem(view: View, x0: number, z0: number, x1: number, z1: number, y: number, color: string, theme: Theme, px = 1): Item {
  return { t: 'poly', p: flat(view, [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]]), fill: color, stroke: theme.ink, w: 3 * px };
}

/**
 * Water: a flat sheet with rows of wave strokes that roll with time (in
 * ms) — the sea around an island, the pool of a chamber.
 */
export function waterItems(view: View, x0: number, z0: number, x1: number, z1: number, time: number, options: { theme: Theme, color: string, px?: number, rows?: number }): Item[] {
  const { theme, color, px = 1, rows = 7 } = options;
  const items: Item[] = [{ t: 'poly', p: flat(view, [[x0, -0.05, z0], [x1, -0.05, z0], [x1, -0.05, z1], [x0, -0.05, z1]]), fill: color, stroke: null, w: 0 }];
  const ink = lerpColor(color, theme.paper, 0.55);
  for (let r = 0; r < rows; r++) {
    const z = z0 + ((r + 0.5) / rows) * (z1 - z0);
    const wave: number[][] = [];
    const steps = 18;
    for (let k = 0; k <= steps; k++) {
      const x = x0 + (k / steps) * (x1 - x0);
      wave.push([x, -0.04 + Math.sin(x * 1.3 + time / 520 + r * 1.7) * 0.06, z + Math.sin(x * 0.7 + time / 900 + r) * 0.12]);
    }
    items.push({ t: 'line', p: flat(view, wave), stroke: ink, w: 2 * px, a: 0.9 });
  }
  return items;
}

/**
 * The hard shadow a block casts on the ground under it, or null when
 * the light casts none (night without a moon high enough, flat blocks).
 */
export function shadowItem(view: View, box: Box, light: Lighting | null | undefined, theme: Theme): Item | null {
  if (!light || !light.shadows) return null;
  const y0 = box.y0 ?? 0;
  const poly = shadowPolygon({ x0: box.x0, x1: box.x1, z0: box.z0, z1: box.z1, h: box.y1 - y0 }, light.sun);
  if (poly.length === 0) return null;
  const pts: number[][] = [];
  for (let i = 0; i < poly.length; i += 2) pts.push([poly[i], y0 + 0.01, poly[i + 1]]);
  return { t: 'poly', p: flat(view, pts), fill: theme.shade, stroke: null, w: 0, a: 0.16 };
}

/**
 * A cut-out figure standing at a world point, `stature` world units
 * tall: its anchor, scale and sway set like the desk's dancers. null
 * behind the eye.
 */
export function figureGroup(view: View, at: [number, number, number], shape: Shape,
  options: { color: string, theme: Theme, stature?: number, sway?: number, alpha?: number }): (Group & { pick: { x: number, y: number, r: number } }) | null {
  const stature = options.stature ?? 1.6;
  const anchor = project(view, at[0], at[1], at[2]);
  if (anchor[2] <= 0) return null;
  const up = project(view, at[0], at[1] + stature, at[2]);
  const unit = Math.abs(anchor[1] - up[1]) / 2.1;
  const items: Item[] = [];
  cutout(items, shape, { x: anchor[0], y: anchor[1], unit, sway: options.sway ?? 0.3 }, options.color, options.theme, options.alpha ?? 1);
  return {
    d: depthOf(view, at[0], at[1] + stature * 0.5, at[2]) - 0.3,
    items,
    pick: { x: anchor[0], y: anchor[1] - shape.center[1] * unit, r: Math.max(16, unit * 1.2) },
  };
}

/**
 * A label standing over a world point (a number on a stone, a name over
 * a player), sized in world units so it shrinks with distance.
 */
export function labelGroup(view: View, at: [number, number, number], text: string,
  options: { theme: Theme, size?: number, fill?: string, stroke?: string | null, alpha?: number }): Group | null {
  const c = project(view, at[0], at[1], at[2]);
  if (c[2] <= 0) return null;
  const top = project(view, at[0], at[1] + (options.size ?? 0.5), at[2]);
  const size = Math.max(8, Math.abs(c[1] - top[1]));
  const stroke = options.stroke === undefined ? options.theme.paper : options.stroke;
  const item: Item = { t: 'text', x: c[0], y: c[1], text, size, fill: options.fill ?? options.theme.ink, stroke, w: stroke ? size * 0.16 : 0 };
  if (options.alpha !== undefined) item.a = options.alpha;
  return { d: depthOf(view, at[0], at[1], at[2]) - 0.6, items: [item] };
}

/** Paint painter's groups far to near into one list. */
export function flatten(groups: ReadonlyArray<Group | null>): Item[] {
  const live: Group[] = [];
  for (const g of groups) if (g) live.push(g);
  live.sort((a, b) => b.d - a.d);
  const out: Item[] = [];
  for (const g of live) for (const item of g.items) out.push(item);
  return out;
}
