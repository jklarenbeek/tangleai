/**
 * The figure vocabulary, as geometry: dancers, the television-headed
 * oracle, the crawling radiant baby who holds the veto, the hand that
 * comes down when it is used, hearts, signs and motion marks.
 *
 * Everything here is flat 2D in a figure's own frame — feet at v = 0,
 * one unit ≈ a third of a figure's height — and is built from three
 * primitives that make the drawing style possible:
 *
 *   - `strokes` — polylines with a width, drawn with round caps/joins;
 *   - `dots`    — filled circles;
 *   - `boxes`   — rounded rectangles.
 *
 * The bold uniform outline comes from drawing every primitive twice:
 * first in ink, widened by the outline on each side, then in the fill
 * colour at its true width. Each later fill covers the inner ink, so
 * overlapping limbs read as one silhouette with one outline — the way a
 * brush-drawn figure is outlined once, around everything. The stage
 * places these frames in 3D (`scene.ts`); nothing here knows a camera.
 */

export type P2 = [number, number];
export type Stroke = { pts: P2[], w: number };
export type Dot = { c: P2, r: number };
export type Box = { c: P2, w: number, h: number, r: number };
export type Shape = { strokes: Stroke[], dots: Dot[], boxes: Box[], center: P2, top: number, screen?: Box };
export type Pose = { lean: number, head: number, aL: P2, aR: P2, lL: P2, lR: P2 };

/** A direction in the figure frame: 0 points down, π points up,
 * positive angles swing toward +u (the figure's left as we see it). */
const dir = (a: number): P2 => [Math.sin(a), -Math.cos(a)];
const along = (p: P2, d: P2, l: number): P2 => [p[0] + d[0] * l, p[1] + d[1] * l];

/**
 * The pose library. Each limb is (upper angle, bend), legs from the hip,
 * arms from the neck; `lean` tilts the torso and `head` the head on it.
 */
export const POSES: Readonly<Record<string, Pose>> = Object.freeze({
  jubilant: { lean: 0, head: 0, aL: [-2.55, 0.35], aR: [2.55, -0.35], lL: [-0.28, 0.12], lR: [0.28, -0.12] },
  dance: { lean: 0.18, head: 0.2, aL: [-2.3, -1.0], aR: [1.25, 1.05], lL: [-0.55, 0.95], lR: [0.32, -0.05] },
  lift: { lean: 0, head: 0, aL: [-2.95, 0.55], aR: [2.95, -0.55], lL: [-0.2, 0], lR: [0.2, 0] },
  kick: { lean: -0.2, head: -0.15, aL: [-1.4, -0.6], aR: [2.4, 0.4], lL: [-0.1, 0.0], lR: [1.2, -0.9] },
  stamp: { lean: 0.1, head: 0.25, aL: [-0.5, 0.2], aR: [0.5, -0.2], lL: [-0.35, 0.5], lR: [0.35, -0.5] },
  hold: { lean: 0, head: 0.1, aL: [-2.75, 0.2], aR: [2.75, -0.2], lL: [-0.25, 0.1], lR: [0.25, -0.1] },
  bow: { lean: 0.9, head: 0.4, aL: [-0.2, 0.0], aR: [0.25, 0.0], lL: [-0.12, 0.0], lR: [0.18, 0.0] },
  tumble: { lean: 1.5, head: 0.5, aL: [-2.0, 1.2], aR: [1.0, 1.4], lL: [-1.1, 1.0], lR: [0.9, -0.6] },
} as Record<string, Pose>);

/** Interpolate two poses, `t` in [0, 1]. */
export function mixPose(a: Pose, b: Pose, t: number): Pose {
  const l = (x: number, y: number) => x + (y - x) * t;
  const l2 = (x: P2, y: P2): P2 => [l(x[0], y[0]), l(x[1], y[1])];
  return { lean: l(a.lean, b.lean), head: l(a.head, b.head), aL: l2(a.aL, b.aL), aR: l2(a.aR, b.aR), lL: l2(a.lL, b.lL), lR: l2(a.lR, b.lR) };
}

/** Limb and body widths in figure units. */
const BODY = 0.36;
const ARM = 0.17;
const LEG = 0.19;
const HEAD = 0.25;

/** The joints of a figure, in drawing order: what a pose places and a
 * ragdoll simulates. */
export const JOINTS = Object.freeze(['hip', 'neck', 'skull', 'elbowL', 'handL', 'elbowR', 'handR', 'kneeL', 'footL', 'kneeR', 'footR'] as const);

/** Bone lengths in figure units: torso, neck to skull (round, television),
 * upper and lower arm, thigh and shin. */
export const BONES = Object.freeze({ torso: 0.62, skull: 0.36, screen: 0.4, upperArm: 0.38, foreArm: 0.34, thigh: 0.48, shin: 0.48 });

export type Skeleton = Record<'hip' | 'neck' | 'skull' | 'elbowL' | 'handL' | 'elbowR' | 'handR' | 'kneeL' | 'footL' | 'kneeR' | 'footR', P2>;

/** Where a pose puts every joint of a standing figure. */
export function skeleton(pose: Pose, options: { bounce?: number, head?: 'round' | 'tv' } = {}): Skeleton {
  const hip: P2 = [0, 0.98 + (options.bounce ?? 0)];
  const neck = along(hip, dir(Math.PI + pose.lean), BONES.torso);
  const skull = along(neck, dir(Math.PI + pose.lean + pose.head), options.head === 'tv' ? BONES.screen : BONES.skull);
  const elbowL = along(neck, dir(pose.aL[0]), BONES.upperArm);
  const elbowR = along(neck, dir(pose.aR[0]), BONES.upperArm);
  const kneeL = along(hip, dir(pose.lL[0]), BONES.thigh);
  const kneeR = along(hip, dir(pose.lR[0]), BONES.thigh);
  return {
    hip, neck, skull,
    elbowL, handL: along(elbowL, dir(pose.aL[0] + pose.aL[1]), BONES.foreArm),
    elbowR, handR: along(elbowR, dir(pose.aR[0] + pose.aR[1]), BONES.foreArm),
    kneeL, footL: along(kneeL, dir(pose.lL[0] + pose.lL[1]), BONES.shin),
    kneeR, footR: along(kneeR, dir(pose.lR[0] + pose.lR[1]), BONES.shin),
  };
}

/**
 * The drawn figure over a skeleton — posed, or simulated by a ragdoll.
 * `head` picks the head: a round one, or a television set — the oracle,
 * a voice that comes out of a machine.
 */
export function skeletonShape(s: Skeleton, options: { head?: 'round' | 'tv' } = {}): Shape {
  const shape: Shape = {
    strokes: [
      { pts: [s.hip, s.neck], w: BODY },
      { pts: [s.neck, s.elbowL, s.handL], w: ARM },
      { pts: [s.neck, s.elbowR, s.handR], w: ARM },
      { pts: [s.hip, s.kneeL, s.footL], w: LEG },
      { pts: [s.hip, s.kneeR, s.footR], w: LEG },
    ],
    dots: [],
    boxes: [],
    center: [s.hip[0], s.hip[1] + 0.22],
    top: s.skull[1] + HEAD,
  };
  const skull = s.skull;
  if (options.head === 'tv') {
    shape.boxes.push({ c: skull, w: 0.66, h: 0.48, r: 0.08 });
    shape.screen = { c: skull, w: 0.42, h: 0.27, r: 0.05 };
    // the two antennae
    shape.strokes.push({ pts: [[skull[0] - 0.12, skull[1] + 0.22], [skull[0] - 0.3, skull[1] + 0.48]], w: 0.06 });
    shape.strokes.push({ pts: [[skull[0] + 0.12, skull[1] + 0.22], [skull[0] + 0.32, skull[1] + 0.46]], w: 0.06 });
    shape.top = skull[1] + 0.5;
  }
  else {
    shape.dots.push({ c: skull, r: HEAD });
  }
  return shape;
}

/** A standing figure in a pose. */
export function person(pose: Pose, options: { bounce?: number, head?: 'round' | 'tv' } = {}): Shape {
  return skeletonShape(skeleton(pose, options), options);
}

/**
 * The radiant baby: on all fours, crawling, the human's figure. `t`
 * drives the crawl (any real number; the gait repeats every 2π).
 */
export function baby(t: number): Shape {
  const swing = Math.sin(t) * 0.18;
  const back: P2 = [-0.42, 0.62];
  const front: P2 = [0.32, 0.66];
  return {
    strokes: [
      { pts: [back, front], w: 0.42 },
      { pts: [front, [0.42 + swing, 0.0]], w: 0.16 },
      { pts: [front, [0.22 - swing, 0.0]], w: 0.16 },
      { pts: [back, [-0.3 - swing, 0.0]], w: 0.18 },
      { pts: [back, [-0.55 + swing, 0.0]], w: 0.18 },
    ],
    dots: [{ c: [0.68, 0.86], r: 0.24 }],
    boxes: [],
    center: [0.05, 0.62],
    top: 1.1,
  };
}

/** A heart, the human's sign, as a closed polygon (two lobes and a point). */
export function heartOutline(size = 1): P2[] {
  const pts: P2[] = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    // the classic parametric heart, normalized to roughly [-1, 1]
    const x = 16 * Math.sin(a) ** 3;
    const y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
    pts.push([(x / 17) * size, (y / 17) * size]);
  }
  return pts;
}

/**
 * The veto hand: an open palm, fingers up, as strokes (a palm and five
 * fingers), drawn large over the sign it refuses.
 */
export function hand(): Shape {
  const palm: P2 = [0, 0.6];
  return {
    strokes: [
      { pts: [[0, 0], palm], w: 0.95 },
      { pts: [[-0.34, 0.75], [-0.42, 1.5]], w: 0.24 },
      { pts: [[-0.11, 0.85], [-0.13, 1.72]], w: 0.24 },
      { pts: [[0.12, 0.85], [0.14, 1.66]], w: 0.24 },
      { pts: [[0.33, 0.75], [0.4, 1.38]], w: 0.22 },
      { pts: [[0.42, 0.3], [0.78, 0.82]], w: 0.24 },
    ],
    dots: [],
    boxes: [],
    center: [0, 0.8],
    top: 1.8,
  };
}

/**
 * Motion marks: the short paired strokes radiating from a figure that
 * say it is moving. Returns segments in figure units around `center`,
 * skipping the arc below the floor. `pulse` breathes their distance.
 */
export function motionMarks(center: P2, radius: number, count: number, pulse = 0): Array<[P2, P2]> {
  const marks: Array<[P2, P2]> = [];
  for (let k = 0; k < count; k++) {
    const a = -Math.PI * 0.92 + (k / Math.max(1, count - 1)) * Math.PI * 1.84;
    const r1 = radius + pulse;
    const r2 = radius * 1.26 + pulse;
    for (const off of [-0.065, 0.065]) {
      const s = Math.sin(a + off);
      const c = Math.cos(a + off);
      const p1: P2 = [center[0] + s * r1, center[1] + c * r1 * 1.05];
      const p2: P2 = [center[0] + s * r2, center[1] + c * r2 * 1.05];
      if (p1[1] < 0.05 || p2[1] < 0.05) continue;
      marks.push([p1, p2]);
    }
  }
  return marks;
}

/**
 * The glyph a proposal's sign carries, in sign units ([-1, 1] square):
 * a paint swatch for a write, an arrow for a turn, a fork for a change of
 * state, a fold for the mirror, a wave for the wash, a metronome stroke
 * for tempo. Each entry is a stroke list; `swatch` names the swatch colour.
 */
export function signGlyph(change: any): { strokes: Stroke[], swatch: number | null } {
  if (change?.kind === 'rule' && change.member === 'write') {
    return { strokes: [], swatch: Number(change.value) };
  }
  if (change?.kind === 'rule' && change.member === 'turn') {
    const turn = change.value;
    if (turn === 'N') return { strokes: [{ pts: [[0, -0.7], [0, 0.7]], w: 0.16 }, { pts: [[-0.35, 0.35], [0, 0.7], [0.35, 0.35]], w: 0.16 }], swatch: null };
    if (turn === 'U') return { strokes: [{ pts: [[-0.4, -0.6], [-0.4, 0.3], [-0.2, 0.6], [0.2, 0.6], [0.4, 0.3], [0.4, -0.3]], w: 0.16 }, { pts: [[0.1, -0.05], [0.4, -0.35], [0.7, -0.05]], w: 0.16 }], swatch: null };
    const s = turn === 'L' ? -1 : 1;
    return { strokes: [{ pts: [[0, -0.7], [0, 0.2], [0.65 * s, 0.2]], w: 0.16 }, { pts: [[0.35 * s, 0.5], [0.65 * s, 0.2], [0.35 * s, -0.1]], w: 0.16 }], swatch: null };
  }
  if (change?.kind === 'rule') {
    return { strokes: [{ pts: [[0, -0.7], [0, 0]], w: 0.16 }, { pts: [[0, 0], [-0.5, 0.6]], w: 0.16 }, { pts: [[0, 0], [0.5, 0.6]], w: 0.16 }], swatch: null };
  }
  if (change?.kind === 'tape' && change.op === 'mirror') {
    return { strokes: [{ pts: [[0, -0.8], [0, 0.8]], w: 0.1 }, { pts: [[-0.75, -0.5], [-0.2, 0], [-0.75, 0.5]], w: 0.16 }, { pts: [[0.75, -0.5], [0.2, 0], [0.75, 0.5]], w: 0.16 }], swatch: null };
  }
  if (change?.kind === 'tape') {
    return { strokes: [{ pts: [[-0.75, 0.15], [-0.4, 0.45], [0, 0.15], [0.4, 0.45], [0.75, 0.15]], w: 0.15 }, { pts: [[-0.75, -0.35], [-0.4, -0.05], [0, -0.35], [0.4, -0.05], [0.75, -0.35]], w: 0.15 }], swatch: null };
  }
  return { strokes: [{ pts: [[-0.5, -0.7], [0.5, -0.7], [0.15, 0.75], [-0.15, 0.75], [-0.5, -0.7]], w: 0.13 }, { pts: [[0, -0.45], [0.42, 0.55]], w: 0.13 }], swatch: null };
}
