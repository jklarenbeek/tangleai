/**
 * Zero-dependency centroid k-means with k-means++ seeding. Ported from
 * memflow `src/utils/clustering.ts` with one deliberate change: the
 * random source is INJECTED. memflow called `Math.random()` inline,
 * which made every clustering run unreproducible — a test could assert
 * "it converged" but never "it converged to this". Pass a seeded
 * generator and the whole run is a pure function of its inputs.
 */

import { euclideanDistance } from './similarity.ts';

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
}

export function kMeans(vectors: number[][], k: number, options: KMeansOptions = {}): KMeansResult {
  const maxIterations = options.maxIterations ?? 100;
  const random = options.random ?? Math.random;

  if (vectors.length === 0 || k <= 0) {
    return { centroids: [], assignments: [], iterations: 0 };
  }

  const n = vectors.length;
  const dim = vectors[0].length;
  const effectiveK = Math.min(k, n);

  const centroids = initCentroids(vectors, effectiveK, random);
  const assignments: number[] = new Array(n).fill(0);

  let converged = false;
  let iter = 0;

  while (!converged && iter < maxIterations) {
    iter++;
    converged = true;

    for (let i = 0; i < n; i++) {
      let minDist = Infinity;
      let minIdx = 0;
      for (let c = 0; c < effectiveK; c++) {
        const dist = euclideanDistance(vectors[i], centroids[c]);
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
        const d = euclideanDistance(v, cent);
        if (d < minDist) minDist = d;
      }
      return minDist * minDist;
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
      if (threshold <= 0) {
        centroids.push([...vectors[i]]);
        break;
      }
    }
    if (centroids.length <= c) centroids.push([...vectors[c % n]]);
  }

  return centroids;
}
