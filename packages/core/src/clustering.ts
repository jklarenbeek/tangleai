/**
 * Centroid k-means with selectable seeding and an injected random source.
 * Both initializers share the same bounded Lloyd iteration. A seeded
 * generator makes each result reproducible without modifying the inputs.
 */

import { drawDistinct } from '@jarenjs/core/random';

/**
 * Squared Euclidean distance, private to this module. `@jarenjs/core/vector`
 * is the suite's one home for vector arithmetic, but it publishes
 * SIMILARITIES (higher-is-better, `1 / (1 + distance)` for Euclidean) and
 * k-means++ seeding needs the squared distance itself; inverting the
 * similarity back into a distance is a round trip nobody should have to
 * read. Mismatched lengths answer Infinity — such a point joins no
 * cluster rather than a wrong one.
 */
function squaredDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return sum;
}

export interface KMeansResult {
  /** Final centroid positions. */
  centroids: number[][];
  /** Cluster assignment for each input vector (index into centroids). */
  assignments: number[];
  /** Iterations until convergence. */
  iterations: number;
}

export interface KMeansOptions {
  maxIterations?: number;
  random?: () => number;
  /** Uniform distinct input indices or distance-weighted k-means++ (default). */
  initialization?: 'random' | 'kmeans++';
}

export function kMeans(vectors: number[][], k: number, options: KMeansOptions = {}): KMeansResult {
  const maxIterations = options.maxIterations ?? 100;
  const random = options.random ?? Math.random;
  const initialization = options.initialization ?? 'kmeans++';
  if (initialization !== 'random' && initialization !== 'kmeans++') {
    throw new TypeError('Unknown k-means initialization');
  }

  if (vectors.length === 0 || k <= 0) {
    return { centroids: [], assignments: [], iterations: 0 };
  }

  const n = vectors.length;
  const dim = vectors[0].length;
  const effectiveK = Math.min(k, n);

  const centroids = initialization === 'random'
    ? drawDistinct(random, n, effectiveK).map(index => [...vectors[index]])
    : initCentroids(vectors, effectiveK, random);
  const assignments: number[] = new Array(n).fill(0);

  let converged = false;
  let iter = 0;

  while (!converged && iter < maxIterations) {
    iter++;
    // Initial zero assignments are placeholders, not a previous Lloyd pass.
    converged = iter > 1;

    for (let i = 0; i < n; i++) {
      let minDist = Infinity;
      let minIdx = 0;
      for (let c = 0; c < effectiveK; c++) {
        const dist = squaredDistance(vectors[i], centroids[c]);
        if (dist < minDist) {
          minDist = dist;
          minIdx = c;
        }
      }
      if (assignments[i] !== minIdx) {
        assignments[i] = minIdx;
        converged = false;
      }
    }

    for (let c = 0; c < effectiveK; c++) {
      const members: number[][] = [];
      for (let i = 0; i < n; i++) if (assignments[i] === c) members.push(vectors[i]);
      if (members.length === 0) continue;
      for (let d = 0; d < dim; d++) {
        let sum = 0;
        for (const m of members) sum += m[d];
        centroids[c][d] = sum / members.length;
      }
    }
  }

  return { centroids, assignments, iterations: iter };
}

/**
 * k-means++ seeding: first centroid uniform, the rest proportional to
 * squared distance from the nearest chosen centroid.
 */
function initCentroids(vectors: number[][], k: number, random: () => number): number[][] {
  const n = vectors.length;
  const centroids: number[][] = [];

  centroids.push([...vectors[Math.floor(random() * n)]]);

  for (let c = 1; c < k; c++) {
    const distances = vectors.map((v) => {
      let minDist = Infinity;
      for (const cent of centroids) {
        const d = squaredDistance(v, cent);
        if (d < minDist) minDist = d;
      }
      return minDist;
    });

    const totalDist = distances.reduce((a, b) => a + b, 0);
    if (totalDist === 0) {
      // remaining points coincide with existing centroids
      centroids.push([...vectors[c % n]]);
      continue;
    }

    let threshold = random() * totalDist;
    for (let i = 0; i < n; i++) {
      threshold -= distances[i];
      if (threshold < 0) {
        centroids.push([...vectors[i]]);
        break;
      }
    }
    if (centroids.length <= c) centroids.push([...vectors[c % n]]);
  }

  return centroids;
}
