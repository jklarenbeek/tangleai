import type { Embedder } from '@jarenjs/ai/embed';
import { cosineSimilarity } from '@jarenjs/core/vector';
import { kMeans } from '@tangleai/core/clustering';
import { CHARS_PER_TOKEN, estimateTokens } from '@tangleai/core/tokens';

import {
  RECURSIVE_CHUNKER_VERSION,
  S2_CHUNKER_VERSION,
  type BoundingBox,
  type ChunkDraft,
  type ChunkResult,
  type Chunker,
  type DocumentElement,
} from './contracts.ts';

/** Below this a repeated tail carries no recoverable context. */
const MIN_OVERLAP_CHARS = 16;

interface AtomicPart {
  element: DocumentElement;
  text: string;
  tokens: number;
}

export interface RecursiveChunkerOptions {
  maxTokens?: number;
  overlapTokens?: number;
}

function splitAtBoundary(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const output: string[] = [];
  let rest = text.trim();
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars + 1);
    const candidates = [window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf('. '), window.lastIndexOf(' ')]
      .filter((index) => index >= Math.floor(maxChars * 0.45));
    const boundary = candidates.length > 0 ? Math.max(...candidates) + 1 : maxChars;
    output.push(rest.slice(0, boundary).trim());
    rest = rest.slice(boundary).trim();
  }
  if (rest !== '') output.push(rest);
  return output;
}

function atomicParts(elements: DocumentElement[], contentTokens: number): AtomicPart[] {
  const maxChars = Math.max(4, contentTokens * CHARS_PER_TOKEN);
  return elements.flatMap((element) => splitAtBoundary(element.text, maxChars).map((text) => ({
    element,
    text,
    tokens: estimateTokens(text),
  })));
}

function commonHeading(parts: AtomicPart[]): string[] {
  const paths = parts.map((part) => part.element.headingPath);
  if (paths.length === 0) return [];
  const prefix: string[] = [];
  for (let index = 0; index < Math.min(...paths.map((path) => path.length)); index++) {
    if (paths.every((path) => path[index] === paths[0][index])) prefix.push(paths[0][index]);
    else break;
  }
  if (prefix.length > 0) return prefix;
  for (let index = paths.length - 1; index >= 0; index--) if (paths[index].length > 0) return [...paths[index]];
  return [];
}

function unionBox(parts: AtomicPart[]): BoundingBox | undefined {
  const withBox = parts.filter((part) => part.element.bbox !== undefined);
  const pages = new Set(withBox.map((part) => part.element.page));
  if (withBox.length === 0 || pages.size > 1) return undefined;
  const boxes = withBox.map((part) => part.element.bbox as BoundingBox);
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.w));
  const maxY = Math.max(...boxes.map((box) => box.y + box.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function draft(parts: AtomicPart[], order: number): ChunkDraft {
  const pages = parts.map((part) => part.element.page).filter((page): page is number => page !== undefined);
  const headingPath = commonHeading(parts);
  const text = parts.map((part) => part.text).join('\n\n');
  return {
    elementIds: [...new Set(parts.map((part) => part.element.id))],
    text,
    tokenCount: estimateTokens(text),
    order,
    headingPath,
    pageStart: pages.length === 0 ? undefined : Math.min(...pages),
    pageEnd: pages.length === 0 ? undefined : Math.max(...pages),
    bbox: unionBox(parts),
  };
}

/** The characters a list of parts occupies once joined, without joining
 * them — the same `'\n\n'` separator `draft` uses. */
function joinedChars(parts: AtomicPart[]): number {
  if (parts.length === 0) return 0;
  return parts.reduce((sum, part) => sum + part.text.length, 0) + (parts.length - 1) * 2;
}

/** The last `budget` characters of `text`, started at a word boundary when
 * one falls near the cut. Empty below `MIN_OVERLAP_CHARS`, where a repeated
 * fragment is noise rather than context. */
function tailAtBoundary(text: string, budget: number): string {
  if (budget < MIN_OVERLAP_CHARS) return '';
  if (text.length <= budget) return text;
  const window = text.slice(text.length - budget);
  const boundary = window.search(/\s/);
  return (boundary >= 0 && boundary < budget / 2 ? window.slice(boundary + 1) : window).trim();
}

/** The tail of an emitted chunk, repeated at the head of the next one so a
 * match spanning a cut is still found whole in one piece.
 *
 * Whole parts are carried while they fit, and the last one is CUT to the
 * remaining budget rather than dropped. Carrying whole parts only — which
 * is what this did before 2026-08-26 — meant the budget applied solely to
 * elements smaller than itself, so ordinary prose (a paragraph is normally
 * longer than 48 tokens) silently got no overlap at all. The element id
 * travels with the cut text, so a repeated tail stays attributable to the
 * element it came from. */
function overlapTail(parts: AtomicPart[], budget: number): AtomicPart[] {
  if (budget < MIN_OVERLAP_CHARS || parts.length === 0) return [];
  const tail: AtomicPart[] = [];
  let used = 0;
  for (let index = parts.length - 1; index >= 0; index--) {
    const part = parts[index];
    const separator = tail.length === 0 ? 0 : 2;
    if (used + separator + part.text.length <= budget) {
      tail.unshift(part);
      used += separator + part.text.length;
      continue;
    }
    const cut = tailAtBoundary(part.text, budget - used - separator);
    if (cut !== '') tail.unshift({ element: part.element, text: cut, tokens: estimateTokens(cut) });
    break;
  }
  return tail;
}

/** Group parts into chunks that never exceed `maxTokens`, repeating an
 * `overlapTokens` tail across every cut. Sizes are compared in characters
 * (`ceil(chars / 4)` is the token estimate, so the two orders agree
 * exactly) and carried forward, which keeps the pass linear in the
 * document instead of re-joining `current` for every part. */
function pack(parts: AtomicPart[], maxTokens: number, overlapTokens: number): ChunkDraft[] {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const overlapChars = overlapTokens * CHARS_PER_TOKEN - 2;
  const chunks: ChunkDraft[] = [];
  let current: AtomicPart[] = [];
  let chars = 0;
  const withPart = (part: AtomicPart): number => chars + part.text.length + (current.length === 0 ? 0 : 2);
  for (const part of parts) {
    const headingBoundary = part.element.role === 'heading' && current.length > 0
      && Math.ceil(chars / CHARS_PER_TOKEN) >= Math.floor(maxTokens * 0.55);
    if (headingBoundary || withPart(part) > maxChars) {
      if (current.length > 0) {
        chunks.push(draft(current, chunks.length));
        current = overlapTail(current, overlapChars);
        chars = joinedChars(current);
      }
      // The carry is context, never content: drop it whole rather than
      // let it push this part over the budget or split it again.
      if (withPart(part) > maxChars) {
        current = [];
        chars = 0;
      }
    }
    chars = withPart(part);
    current.push(part);
  }
  if (current.length > 0) chunks.push(draft(current, chunks.length));
  return chunks;
}

export class RecursiveDocumentChunker implements Chunker {
  readonly version = RECURSIVE_CHUNKER_VERSION;
  readonly maxTokens: number;
  readonly overlapTokens: number;

  constructor(options: RecursiveChunkerOptions = {}) {
    this.maxTokens = Math.max(16, options.maxTokens ?? 450);
    this.overlapTokens = Math.max(0, Math.min(options.overlapTokens ?? 48, Math.floor(this.maxTokens / 3)));
  }

  /** The budget an atomic part is split to: the chunk budget less the tail
   * the next chunk repeats, so a part and its carried overlap always fit. */
  get contentTokens(): number {
    return this.maxTokens - this.overlapTokens;
  }

  async chunk(elements: DocumentElement[]): Promise<ChunkResult> {
    const parts = atomicParts(elements, this.contentTokens);
    return {
      chunks: pack(parts, this.maxTokens, this.overlapTokens),
      diagnostic: { algorithm: this.version, warnings: [] },
    };
  }
}

function seedFrom(value: string): () => number {
  let seed = 2166136261;
  for (const char of value) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  return (): number => {
    seed += 0x6d2b79f5;
    let next = seed;
    next = Math.imul(next ^ next >>> 15, next | 1);
    next ^= next + Math.imul(next ^ next >>> 7, next | 61);
    return ((next ^ next >>> 14) >>> 0) / 4294967296;
  };
}

function jacobi(matrix: number[][]): { values: number[]; vectors: number[][]; converged: boolean; rotations: number } {
  const n = matrix.length;
  const values = matrix.map((row) => [...row]);
  const vectors: number[][] = Array.from({ length: n }, (_, row) => Array.from({ length: n }, (_, col) => row === col ? 1 : 0));
  const maxRotations = Math.max(20, n * n * 16);
  let rotations = 0;
  let converged = n <= 1;
  for (; rotations < maxRotations; rotations++) {
    let largest = 0;
    let p = 0;
    let q = Math.min(1, n - 1);
    for (let row = 0; row < n; row++) {
      for (let col = row + 1; col < n; col++) {
        const candidate = Math.abs(values[row][col]);
        if (candidate > largest) {
          largest = candidate;
          p = row;
          q = col;
        }
      }
    }
    if (largest < 1e-9) {
      converged = true;
      break;
    }
    const angle = 0.5 * Math.atan2(2 * values[p][q], values[q][q] - values[p][p]);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    for (let row = 0; row < n; row++) {
      if (row === p || row === q) continue;
      const rp = values[row][p];
      const rq = values[row][q];
      values[row][p] = values[p][row] = c * rp - s * rq;
      values[row][q] = values[q][row] = s * rp + c * rq;
    }
    const pp = values[p][p];
    const qq = values[q][q];
    const pq = values[p][q];
    values[p][p] = c * c * pp - 2 * s * c * pq + s * s * qq;
    values[q][q] = s * s * pp + 2 * s * c * pq + c * c * qq;
    values[p][q] = values[q][p] = 0;
    for (let row = 0; row < n; row++) {
      const vp = vectors[row][p];
      const vq = vectors[row][q];
      vectors[row][p] = c * vp - s * vq;
      vectors[row][q] = s * vp + c * vq;
    }
  }
  return { values: values.map((row, index) => row[index]), vectors, converged, rotations };
}

function eigengap(values: number[], maximum: number, fallback: number): number {
  if (values.length <= 1) return 1;
  const limit = Math.min(maximum, values.length - 1);
  const gaps = Array.from({ length: limit }, (_, index) => values[index + 1] - values[index]);
  const positive = gaps.filter((gap) => gap > 1e-9).sort((a, b) => a - b);
  const median = positive[Math.floor(positive.length / 2)] ?? 0;
  let best = -1;
  let index = -1;
  gaps.forEach((gap, offset) => {
    if (gap > best) {
      best = gap;
      index = offset;
    }
  });
  return best > Math.max(1e-6, median * 2) ? index + 1 : fallback;
}

function coordinates(part: AtomicPart): { x: number; y: number } {
  if (part.element.centroid !== undefined) return part.element.centroid;
  if (part.element.bbox !== undefined) {
    return { x: part.element.bbox.x + part.element.bbox.w / 2, y: part.element.bbox.y + part.element.bbox.h / 2 };
  }
  return { x: part.element.headingPath.length, y: part.element.order };
}

export interface S2ChunkerOptions extends RecursiveChunkerOptions {
  embedder: Embedder;
  alpha?: number;
  structuralWeight?: number;
  maxSpectralElements?: number;
  random?: () => number;
}

export class S2DocumentChunker implements Chunker {
  readonly version = S2_CHUNKER_VERSION;
  private readonly baseline: RecursiveDocumentChunker;
  get maxTokens(): number { return this.baseline.maxTokens; }
  get overlapTokens(): number { return this.baseline.overlapTokens; }
  private readonly alpha: number;
  private readonly structuralWeight: number;
  private readonly maxSpectralElements: number;
  private readonly embedder: Embedder;
  private readonly random?: () => number;

  constructor(options: S2ChunkerOptions) {
    this.baseline = new RecursiveDocumentChunker(options);
    this.alpha = Math.max(0, Math.min(1, options.alpha ?? 0.55));
    this.structuralWeight = Math.max(0.01, options.structuralWeight ?? 2);
    this.maxSpectralElements = Math.max(8, options.maxSpectralElements ?? 72);
    this.embedder = options.embedder;
    this.random = options.random;
  }

  private cluster(parts: AtomicPart[], embeddings: number[][], random: () => number): { runs: AtomicPart[][]; converged: boolean; rotations: number } {
    const n = parts.length;
    if (n <= 1) return { runs: parts.length === 0 ? [] : [parts], converged: true, rotations: 0 };
    const points = parts.map(coordinates);
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const diagonal = Math.hypot((maxX - minX) * this.structuralWeight, maxY - minY) || 1;
    const affinity = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let row = 0; row < n; row++) {
      for (let col = row + 1; col < n; col++) {
        const semantic = (Math.max(-1, Math.min(1, cosineSimilarity(embeddings[row], embeddings[col]))) + 1) / 2;
        const dx = (points[row].x - points[col].x) * this.structuralWeight;
        const dy = points[row].y - points[col].y;
        const spatial = 1 / (1 + Math.hypot(dx, dy) / diagonal);
        const adjacency = 1 / (1 + Math.abs(row - col) / 8);
        const weight = this.alpha * semantic + (1 - this.alpha) * spatial * adjacency;
        affinity[row][col] = affinity[col][row] = weight;
      }
    }
    const degree = affinity.map((row) => row.reduce((sum, item) => sum + item, 0));
    const laplacian = Array.from({ length: n }, (_, row) => Array.from({ length: n }, (_, col) => {
      if (row === col) return degree[row] > 0 ? 1 : 0;
      return degree[row] > 0 && degree[col] > 0 ? -affinity[row][col] / Math.sqrt(degree[row] * degree[col]) : 0;
    }));
    const eigen = jacobi(laplacian);
    if (!eigen.converged) return { runs: [parts], converged: false, rotations: eigen.rotations };
    const pairs = eigen.values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
    const hint = Math.max(1, Math.min(n, Math.ceil(parts.reduce((sum, part) => sum + part.tokens, 0) / this.baseline.maxTokens)));
    const clusters = Math.max(1, Math.min(n, eigengap(pairs.map((pair) => pair.value), Math.min(n - 1, hint * 2), hint)));
    const features = Array.from({ length: n }, (_, row) => {
      const vector = Array.from({ length: clusters }, (_, col) => eigen.vectors[row][pairs[col].index]);
      const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0)) || 1;
      return vector.map((item) => item / norm);
    });
    const assignments = kMeans(features, clusters, { random }).assignments;
    const runs: AtomicPart[][] = [];
    let current: AtomicPart[] = [];
    let assignment = assignments[0];
    parts.forEach((part, index) => {
      if (assignments[index] !== assignment && current.length > 0) {
        runs.push(current);
        current = [];
        assignment = assignments[index];
      }
      current.push(part);
    });
    if (current.length > 0) runs.push(current);
    return { runs, converged: true, rotations: eigen.rotations };
  }

  async chunk(elements: DocumentElement[], options: { signal?: AbortSignal } = {}): Promise<ChunkResult> {
    const parts = atomicParts(elements, this.baseline.contentTokens);
    if (parts.length < 3) return this.baseline.chunk(elements);
    const raw = await this.embedder.embed(parts.map((part) => part.text), { signal: options.signal });
    const embeddings = raw.map((vector) => Array.from(vector));
    const partitions: Array<{ parts: AtomicPart[]; embeddings: number[][] }> = [];
    for (let start = 0; start < parts.length; start += this.maxSpectralElements) {
      partitions.push({
        parts: parts.slice(start, start + this.maxSpectralElements),
        embeddings: embeddings.slice(start, start + this.maxSpectralElements),
      });
    }
    const random = this.random ?? seedFrom(elements.map((element) => element.id).join('|'));
    const groups: AtomicPart[][] = [];
    let converged = true;
    let rotations = 0;
    for (const partition of partitions) {
      const clustered = this.cluster(partition.parts, partition.embeddings, random);
      rotations += clustered.rotations;
      converged &&= clustered.converged;
      groups.push(...clustered.runs);
    }
    if (!converged) {
      const fallback = await this.baseline.chunk(elements);
      fallback.diagnostic = {
        ...fallback.diagnostic,
        algorithm: this.version,
        fallback: RECURSIVE_CHUNKER_VERSION,
        partitions: partitions.length,
        spectralRuns: partitions.length,
        converged: false,
        rotations,
        warnings: ['spectral eigensolver did not converge; used recursive fallback'],
      };
      return fallback;
    }
    const chunks = groups.flatMap((group) => pack(group, this.baseline.maxTokens, this.baseline.overlapTokens));
    chunks.forEach((chunk, order) => { chunk.order = order; });
    return {
      chunks,
      diagnostic: {
        algorithm: this.version,
        partitions: partitions.length,
        spectralRuns: partitions.length,
        converged,
        rotations,
        warnings: [],
      },
    };
  }
}

export interface SemanticBoundaryOptions extends RecursiveChunkerOptions {
  embedder: Embedder;
  threshold?: number;
}

/** Measured comparison baseline: adjacent embedding discontinuities become boundaries. */
export class SemanticBoundaryChunker implements Chunker {
  readonly version = 'semantic-boundary/1';
  private readonly baseline: RecursiveDocumentChunker;
  get maxTokens(): number { return this.baseline.maxTokens; }
  get overlapTokens(): number { return this.baseline.overlapTokens; }
  private readonly embedder: Embedder;
  private readonly threshold: number;

  constructor(options: SemanticBoundaryOptions) {
    this.baseline = new RecursiveDocumentChunker(options);
    this.embedder = options.embedder;
    this.threshold = options.threshold ?? 0.45;
  }

  async chunk(elements: DocumentElement[], options: { signal?: AbortSignal } = {}): Promise<ChunkResult> {
    const parts = atomicParts(elements, this.baseline.contentTokens);
    const vectors = (await this.embedder.embed(parts.map((part) => part.text), { signal: options.signal })).map((vector) => Array.from(vector));
    const groups: AtomicPart[][] = [];
    let current: AtomicPart[] = [];
    let tokens = 0;
    parts.forEach((part, index) => {
      const boundary = index > 0 && cosineSimilarity(vectors[index - 1], vectors[index]) < this.threshold;
      if (current.length > 0 && (boundary || tokens + part.tokens > this.baseline.maxTokens)) {
        groups.push(current);
        current = [];
        tokens = 0;
      }
      current.push(part);
      tokens += part.tokens;
    });
    if (current.length > 0) groups.push(current);
    const chunks = groups.flatMap((group) => pack(group, this.baseline.maxTokens, this.baseline.overlapTokens));
    chunks.forEach((chunk, order) => { chunk.order = order; });
    return { chunks, diagnostic: { algorithm: this.version, warnings: [] } };
  }
}
