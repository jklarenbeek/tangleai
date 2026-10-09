/** Preregistered exact golden scores and a seeded independent random ranking. */
import { mulberry32 } from '@jarenjs/core/random';
import { cosineSimilarity } from '@jarenjs/core/vector';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { compareLightRagScores } from '@tangleai/lightrag';
import registered from '../fixtures/vector/registration.json' with { type: 'json' };
import { compareRankings } from './vector-parity.ts';
import type { VectorControls } from './vector-scale.types.ts';

export async function vectorScaleControls(): Promise<VectorControls> {
  const v = (first: number, second = 0) => [first, second, ...Array(registered.dims - 2).fill(0)];
  const query = v(1), vectors = [v(1), v(0, 1), v(0, 1), v(-1)];
  const ids = ['positive', 'B', 'b', 'negative'];
  const goldenRows = vectors.map((vector, index) => ({ id: ids[index], score: cosineSimilarity(query, vector) })).sort(compareLightRagScores);
  const golden = compareRankings({ rows: [{ id: 'positive', score: 1 }, { id: 'B', score: 0 }, { id: 'b', score: 0 }, { id: 'negative', score: -1 }], skipped: {} },
    { rows: goldenRows, skipped: {} });
  const random = mulberry32(registered.seed), randomOrder = mulberry32(registered.seed + 1);
  const rows = Array.from({ length: registered.randomRows }, (_, index) => ({ id: 'row-' + String(index).padStart(4, '0'),
    vector: Array.from({ length: registered.dims }, () => 2 * random() - 1) }));
  const rankings = []; let randomOverlap = 0;
  for (let probe = 0; probe < registered.randomProbes; probe++) {
    const vector = Array.from({ length: registered.dims }, () => 2 * random() - 1);
    const exact = rows.map(row => ({ id: row.id, score: cosineSimilarity(vector, row.vector) })).sort(compareLightRagScores).slice(0, registered.randomK);
    const shuffled = rows.map(row => ({ id: row.id, score: randomOrder() })).sort(compareLightRagScores).slice(0, registered.randomK);
    const selected = new Set(exact.map(row => row.id)); randomOverlap += shuffled.filter(row => selected.has(row.id)).length;
    rankings.push({ exact, random: shuffled.map(row => row.id) });
  }
  return { golden, goldenRows, randomSeed: registered.seed, randomQueries: registered.randomProbes, randomOverlap,
    randomOverlapPassed: randomOverlap >= registered.randomOverlapMin && randomOverlap <= registered.randomOverlapMax,
    randomOrderDigest: await canonicalSha256(rankings) };
}
