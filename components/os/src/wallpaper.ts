/**
 * The desktop's default wallpaper: threads woven across the screen, drawn as
 * an SVG from a seed and the theme's thread colours. Deterministic (the same
 * seed draws the same weave), resolution-independent and cheap: one string,
 * built once per theme.
 */
export type WeaveOptions = { seed?: number, threads?: number, ground: [string, string], colours: string[], knot: string };

/** A small seeded generator (mulberry32), so a weave is reproducible. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const escape = (value: string) => value.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));

export function weaveSvg(options: WeaveOptions): string {
  const rand = random(options.seed ?? 7);
  const W = 1600, H = 1000;
  const count = options.threads ?? 22;
  const paths: string[] = [];
  const crossings: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    // each thread enters on the left, rises and falls twice, and leaves on the right
    const y0 = H * (0.08 + 0.84 * rand());
    const lift = H * (0.12 + 0.3 * rand()) * (rand() < 0.5 ? -1 : 1);
    const y1 = y0 + lift, y2 = y0 - lift * (0.4 + 0.8 * rand()), y3 = H * (0.08 + 0.84 * rand());
    const d = `M -60 ${y0.toFixed(1)} C ${(W * 0.22).toFixed(0)} ${y1.toFixed(1)}, ${(W * 0.36).toFixed(0)} ${y2.toFixed(1)}, ${(W * 0.52).toFixed(0)} ${((y1 + y2) / 2).toFixed(1)} S ${(W * 0.82).toFixed(0)} ${y3.toFixed(1)}, ${W + 60} ${(y3 + lift * 0.3).toFixed(1)}`;
    const colour = options.colours[i % options.colours.length];
    const width = (0.6 + rand() * (i % 5 === 0 ? 5 : 2.2)).toFixed(2);
    const opacity = (0.16 + rand() * 0.42).toFixed(2);
    paths.push(`<path d="${d}" stroke="${escape(colour)}" stroke-width="${width}" stroke-opacity="${opacity}" fill="none" stroke-linecap="round"/>`);
    // a knot sits on the thread itself: a point of its first curve
    if (i % 3 === 0) {
      const t = 0.35 + rand() * 0.55, u = 1 - t;
      const bx = u ** 3 * -60 + 3 * u * u * t * W * 0.22 + 3 * u * t * t * W * 0.36 + t ** 3 * W * 0.52;
      const by = u ** 3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * ((y1 + y2) / 2);
      crossings.push([bx, by]);
    }
  }
  const knots = crossings.filter(([, y]) => y > 30 && y < H - 30).slice(0, 6).map(([x, y]) => `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(2.5 + rand() * 2.5).toFixed(1)}" fill="${escape(options.knot)}" fill-opacity="0.7"/>`).join('');
  const [g0, g1] = options.ground;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">`
    + `<defs><radialGradient id="g" cx="18%" cy="12%" r="110%"><stop offset="0" stop-color="${escape(g0)}"/><stop offset="1" stop-color="${escape(g1)}"/></radialGradient></defs>`
    + `<rect width="${W}" height="${H}" fill="url(#g)"/>${paths.join('')}${knots}</svg>`;
}

/** The weave as a CSS background value. */
export function weaveBackground(options: WeaveOptions): string {
  return `url("data:image/svg+xml,${encodeURIComponent(weaveSvg(options))}") center / cover no-repeat`;
}

/** What every generator draws with: a seed, a density (0.3–2) and the theme's colours. */
export type PatternOptions = { seed: number, density: number, ground: [string, string], ink: [string, string, string], mark: string };
const W = 1600, H = 1000;
const frame = (o: PatternOptions, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">`
  + `<defs><radialGradient id="g" cx="18%" cy="12%" r="110%"><stop offset="0" stop-color="${escape(o.ground[0])}"/><stop offset="1" stop-color="${escape(o.ground[1])}"/></radialGradient></defs>`
  + `<rect width="${W}" height="${H}" fill="url(#g)"/>${body}</svg>`;

/** A smooth seeded field: a sum of a few radial hills and valleys. */
function field(rand: () => number, count: number) {
  const hills = Array.from({ length: count }, () => ({ x: rand() * W, y: rand() * H, r: 160 + rand() * 420, h: (rand() < 0.3 ? -1 : 1) * (0.5 + rand()) }));
  return (x: number, y: number) => hills.reduce((sum, p) => sum + p.h * Math.exp(-((x - p.x) ** 2 + (y - p.y) ** 2) / (2 * p.r * p.r)), 0);
}

/** Contour lines of a seeded landscape (marching squares), every fifth line heavier. */
function contours(o: PatternOptions) {
  const rand = random(o.seed), f = field(rand, 9);
  const step = Math.round(26 / Math.sqrt(o.density)), cols = Math.ceil(W / step) + 1, rows = Math.ceil(H / step) + 1;
  const grid: number[][] = [];
  for (let j = 0; j < rows; j++) { grid.push([]); for (let i = 0; i < cols; i++) grid[j].push(f(i * step, j * step)); }
  const levels = Math.round(14 * o.density);
  let body = '';
  for (let l = 1; l <= levels; l++) {
    const t = -0.9 + (2.4 * l) / levels;
    let d = '';
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
      const a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i + 1], e = grid[j + 1][i];
      const pts: [number, number][] = [];
      const edge = (v1: number, v2: number, x1: number, y1: number, x2: number, y2: number) => {
        if ((v1 < t) !== (v2 < t)) { const k = (t - v1) / (v2 - v1); pts.push([x1 + (x2 - x1) * k, y1 + (y2 - y1) * k]); }
      };
      const x = i * step, y = j * step;
      edge(a, b, x, y, x + step, y); edge(b, c, x + step, y, x + step, y + step); edge(c, e, x + step, y + step, x, y + step); edge(e, a, x, y + step, x, y);
      if (pts.length >= 2) d += `M${pts[0][0].toFixed(0)} ${pts[0][1].toFixed(0)}L${pts[1][0].toFixed(0)} ${pts[1][1].toFixed(0)}`;
      if (pts.length === 4) d += `M${pts[2][0].toFixed(0)} ${pts[2][1].toFixed(0)}L${pts[3][0].toFixed(0)} ${pts[3][1].toFixed(0)}`;
    }
    const heavy = l % 5 === 0;
    body += `<path d="${d}" stroke="${escape(heavy ? o.ink[0] : o.ink[1])}" stroke-width="${heavy ? 2.4 : 1.3}" stroke-opacity="${heavy ? 0.7 : 0.45}" fill="none" stroke-linecap="round"/>`;
  }
  const peaks = Array.from({ length: 3 }, () => [rand() * W, rand() * H]);
  return frame(o, body + peaks.map(([x, y]) => `<path d="M${(x - 5).toFixed(0)} ${(y + 4).toFixed(0)}l5 -9l5 9z" fill="${escape(o.mark)}" fill-opacity="0.7"/>`).join(''));
}

/** Two inks printed slightly off register: dot screens whose size follows a seeded field. */
function halftone(o: PatternOptions) {
  const rand = random(o.seed), f = field(rand, 6);
  const pitch = Math.round(22 / Math.sqrt(o.density));
  const screen = (colour: string, dx: number, dy: number, angle: number, bias: number) => {
    let dots = '';
    for (let y = -pitch; y < H + pitch; y += pitch) for (let x = -pitch; x < W + pitch; x += pitch) {
      const v = Math.max(0, Math.min(1, 0.5 + bias * f(x, y) * 0.6));
      if (v > 0.08) dots += `<circle cx="${x}" cy="${y}" r="${(v * pitch * 0.48).toFixed(1)}"/>`;
    }
    return `<g fill="${escape(colour)}" fill-opacity="0.6" style="mix-blend-mode:multiply" transform="translate(${dx} ${dy})">${dots}</g>`;
  };
  // the second ink is laid a half pitch over and a hair off register
  return frame(o, screen(o.ink[0], 0, 0, 0, 1) + screen(o.ink[1], pitch / 2 + 3, pitch / 2 + 2, 0, -1));
}

/** White stems and leaves on a deep ground, like a sun print of plants. */
function sunprint(o: PatternOptions) {
  const rand = random(o.seed);
  let body = '';
  const stems = Math.round(9 * o.density);
  for (let s = 0; s < stems; s++) {
    let x = rand() * W, y = H + 40, angle = -Math.PI / 2 + (rand() - 0.5) * 0.6;
    const length = 260 + rand() * 520, segments = 14;
    let d = `M${x.toFixed(0)} ${y.toFixed(0)}`;
    for (let k = 0; k < segments; k++) {
      angle += (rand() - 0.5) * 0.35;
      const nx = x + Math.cos(angle) * length / segments, ny = y + Math.sin(angle) * length / segments;
      d += `L${nx.toFixed(0)} ${ny.toFixed(0)}`;
      if (k > 2 && k % 2 === 0) {
        const side = k % 4 === 0 ? 1 : -1, la = angle + side * (0.7 + rand() * 0.5), ll = 26 + rand() * 46;
        const tx = nx + Math.cos(la) * ll, ty = ny + Math.sin(la) * ll;
        const cx = nx + Math.cos(la + side * 0.5) * ll * 0.6, cy = ny + Math.sin(la + side * 0.5) * ll * 0.6;
        const cx2 = nx + Math.cos(la - side * 0.5) * ll * 0.6, cy2 = ny + Math.sin(la - side * 0.5) * ll * 0.6;
        body += `<path d="M${nx.toFixed(0)} ${ny.toFixed(0)}Q${cx.toFixed(0)} ${cy.toFixed(0)} ${tx.toFixed(0)} ${ty.toFixed(0)}Q${cx2.toFixed(0)} ${cy2.toFixed(0)} ${nx.toFixed(0)} ${ny.toFixed(0)}z" fill="${escape(o.ink[0])}" fill-opacity="${(0.18 + rand() * 0.3).toFixed(2)}"/>`;
      }
      x = nx; y = ny;
    }
    body += `<path d="${d}" stroke="${escape(o.ink[0])}" stroke-opacity="0.5" stroke-width="${(1 + rand() * 1.6).toFixed(1)}" fill="none" stroke-linecap="round"/>`;
  }
  const spores = Array.from({ length: Math.round(60 * o.density) }, () => `<circle cx="${(rand() * W).toFixed(0)}" cy="${(rand() * H).toFixed(0)}" r="${(0.6 + rand() * 1.8).toFixed(1)}" fill="${escape(o.ink[1])}" fill-opacity="0.45"/>`).join('');
  return frame(o, body + spores);
}

/** Two sets of thin rings whose interference makes slow moiré tides. */
function moire(o: PatternOptions) {
  const rand = random(o.seed);
  const centres = [[W * (0.2 + rand() * 0.25), H * (0.3 + rand() * 0.4)], [W * (0.55 + rand() * 0.25), H * (0.3 + rand() * 0.4)]];
  const gap = 11 / Math.sqrt(o.density);
  let body = '';
  centres.forEach(([cx, cy], n) => {
    let rings = '';
    for (let r = gap; r < 1500; r += gap) rings += `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${r.toFixed(1)}"/>`;
    body += `<g fill="none" stroke="${escape(o.ink[n])}" stroke-width="1.1" stroke-opacity="0.42">${rings}</g>`;
  });
  return frame(o, body + `<circle cx="${centres[1][0].toFixed(0)}" cy="${centres[1][1].toFixed(0)}" r="5" fill="${escape(o.mark)}" fill-opacity="0.8"/>`);
}

function weavePattern(o: PatternOptions) {
  return weaveSvg({ seed: o.seed, threads: Math.round(22 * o.density), ground: o.ground, colours: o.ink, knot: o.mark });
}

/** Every procedural wallpaper the desktop can draw, by name. */
export const PATTERNS: Record<string, (o: PatternOptions) => string> = { weave: weavePattern, contours, halftone, sunprint, moire };

/** The wallpaper a theme's tokens ask for, as a CSS background value, or null when it is plain CSS. */
export function patternBackground(tokens: Record<string, string>): string | null {
  const draw = PATTERNS[tokens['--os-desktop']];
  if (!draw) return null;
  const options: PatternOptions = {
    seed: Number.parseInt(tokens['--os-pattern-seed'] ?? '7', 10) || 7,
    density: Math.max(0.3, Math.min(2, Number.parseFloat(tokens['--os-pattern-density'] ?? '1') || 1)),
    ground: [tokens['--os-ground-1'] ?? '#eef1f6', tokens['--os-ground-2'] ?? '#d6dfea'],
    ink: [tokens['--os-thread-1'] ?? '#0f9d94', tokens['--os-thread-2'] ?? '#3e5a8c', tokens['--os-thread-3'] ?? '#8c96b0'],
    mark: tokens['--os-knot'] ?? '#c2367b',
  };
  return `url("data:image/svg+xml,${encodeURIComponent(draw(options))}") center / cover no-repeat`;
}
