/**
 * A seeded PRNG, and the one draw the instruments make with it.
 *
 * Checked before writing it (BOUNDARY §"What the suite already has"):
 * no `@jarenjs/*` package publishes a seeded generator — jarenjs keeps
 * mulberry32 inside its own benchmark scripts, and `@tangleai/core`'s
 * k-means INJECTS a random source rather than owning one. So this is the
 * generator jarenjs's seeded corpora use, written once here, and it is
 * the only random source a benchmark row in this repository may draw
 * from: `Math.random()` in an instrument would make the random gate row
 * unrepeatable, and an unrepeatable gate is not a gate.
 */

/** mulberry32 — uniform in [0, 1), identical on every host for a seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function random(): number {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `k` distinct indices from `[0, n)`, uniformly — a partial Fisher–Yates
 * over an index pool, the same draw jarenjs's `random` retrieval policy
 * makes. Asks for more than `n` and it answers `n`: a draw cannot invent
 * a memory the corpus does not hold.
 */
export function drawDistinct(random: () => number, n: number, k: number): number[] {
  const pool = Array.from({ length: n }, (_, i) => i);
  const count = Math.min(k, n);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
