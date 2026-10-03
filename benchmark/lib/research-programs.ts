/** Declared pure fixture programs receive features and queries, never evaluation labels. */
import { kMeans } from '@tangleai/core/clustering';
import { mulberry32 } from '@jarenjs/core/random';
import { createLexicalIndex } from '@tangleai/core/lexical';
import { cosineSimilarity } from '@jarenjs/core/vector';
import { createHashEmbedder } from '@tangleai/models/embed';
import { RecursiveDocumentChunker } from '@tangleai/documents';
import type { ResearchDataset, ResearchCorpus, ProgramParams, ResearchRawOutput, ResearchIssue } from './research.types.ts';

type Program = (dataset: ResearchDataset, seed: number, params: ProgramParams) => Promise<ResearchRawOutput>;
export const RESEARCH_LEXICAL_LIMITS = { maxDocuments: 12, maxResults: 5, maxCandidates: 12 };
export const RESEARCH_PROGRAM_IDS = ['kmeans-seeding/random', 'kmeans-seeding/plusplus', 'lexical-ranking/bm25plus',
  'lexical-ranking/tf', 'embedder-width/64', 'embedder-width/256', 'throws', 'reads-hidden', 'writes-metrics'] as const;

/** Explicit feature projection prevents accidentally passing evaluator-only fields. */
export function researchProgramInput(dataset: ResearchDataset): ResearchDataset {
  if (dataset.kind === 'blobs') return { id: dataset.id, kind: 'blobs',
    points: dataset.points.map(point => ({ id: point.id, vector: [...point.vector] })) };
  return { id: dataset.id, kind: 'corpus',
    documents: dataset.documents.map(document => ({ id: document.id, text: document.text })),
    queries: dataset.queries.map(query => ({ id: query.id, text: query.text })) };
}
class ProgramRefusal extends Error {
  readonly issue: ResearchIssue;
  constructor(code: string, path: string, detail: string) {
    super(detail); this.issue = { code, path, detail };
  }
}
function corpus(dataset: ResearchDataset): ResearchCorpus {
  if (dataset.kind !== 'corpus') throw new ProgramRefusal('TRSH1001', '/dataset/kind', 'Ranking needs the registered corpus.');
  return dataset;
}
async function documents(dataset: ResearchCorpus): Promise<Array<{ id: string; text: string }>> {
  const chunker = new RecursiveDocumentChunker({ maxTokens: 450, overlapTokens: 0 });
  return Promise.all(dataset.documents.map(async document => {
    const result = await chunker.chunk([{ id: document.id + '-element', sourceId: document.id, versionId: 'fixture-v1',
      order: 0, role: 'paragraph', text: document.text, headingPath: ['Fixture'] }]);
    return { id: document.id, text: result.chunks.map(chunk => chunk.text).join(' ') };
  }));
}
const cluster = (initialization: 'random' | 'kmeans++'): Program => async (dataset, seed, params) => {
  if (dataset.kind !== 'blobs') throw new ProgramRefusal('TRSH1001', '/dataset/kind', 'Clustering needs the registered point features.');
  return { kind: 'clusters', ...kMeans(dataset.points.map(point => [...point.vector]), params.k ?? 3,
    { random: mulberry32(seed), initialization, maxIterations: params.maxIterations ?? 100 }) };
};
const lexical: Program = async (dataset, _seed, params) => {
  const input = corpus(dataset), rows = await documents(input), index = createLexicalIndex(rows, { limits: RESEARCH_LEXICAL_LIMITS });
  return { kind: 'rankings', methodIdentity: index.identity,
    rankings: input.queries.map(query => ({ queryId: query.id, hits: index.rank(query.text, params.limit ?? 5) })) };
};
const termFrequency: Program = async (dataset, _seed, params) => {
  const input = corpus(dataset), rows = await documents(input);
  // The fixture vocabulary is lowercase ASCII words separated by spaces.
  return { kind: 'rankings', methodIdentity: 'plain-term-frequency/1;ascii-spaces;source-order-ties', rankings: input.queries.map(query => {
    const terms = new Set(query.text.split(' ').filter(Boolean));
    const hits = rows.map(row => ({ id: row.id, score: row.text.split(' ').filter(word => terms.has(word)).length }))
      .filter(hit => hit.score > 0).sort((left, right) => right.score - left.score).slice(0, params.limit ?? 5);
    return { queryId: query.id, hits };
  }) };
};
const embedding = (dims: number): Program => async (dataset, _seed, params) => {
  const input = corpus(dataset), rows = await documents(input), embedder = createHashEmbedder({ dims });
  const vectors = await embedder.embed(rows.map(row => row.text));
  const queries = await embedder.embed(input.queries.map(query => query.text));
  return { kind: 'rankings', methodIdentity: embedder.model, rankings: input.queries.map((query, queryIndex) => ({ queryId: query.id,
    hits: rows.map((row, index) => ({ id: row.id, score: cosineSimilarity(queries[queryIndex], vectors[index]) }))
      .sort((left, right) => right.score - left.score).slice(0, params.limit ?? 5) })) };
};
const programs: Record<typeof RESEARCH_PROGRAM_IDS[number], Program> = {
  'kmeans-seeding/random': cluster('random'),
  'kmeans-seeding/plusplus': cluster('kmeans++'),
  'lexical-ranking/bm25plus': lexical,
  'lexical-ranking/tf': termFrequency,
  'embedder-width/64': embedding(64),
  'embedder-width/256': embedding(256),
  'throws': async () => { throw new ProgramRefusal('TRSH1008', '/program', 'Registered fixture program failure.'); },
  'reads-hidden': async () => { throw new ProgramRefusal('TRSH1005', '/inputs', 'Hidden evaluation labels are outside program authority.'); },
  'writes-metrics': async () => ({ kind: 'files', files: [{ path: 'metrics.json', content: '{"accuracy":1}' }] }),
};
export async function executeResearchProgram(programId: string, dataset: ResearchDataset, seed: number, params: ProgramParams):
Promise<{ ok: true; output: ResearchRawOutput } | { ok: false; issue: ResearchIssue }> {
  if (!Object.hasOwn(programs, programId)) return { ok: false, issue: { code: 'TRSH1003', path: '/programId', detail: 'Unknown fixture program.' } };
  try {
    const output = await programs[programId as keyof typeof programs](researchProgramInput(dataset), seed, structuredClone(params));
    return { ok: true, output };
  } catch (cause) {
    if (cause instanceof ProgramRefusal) return { ok: false, issue: cause.issue };
    throw cause;
  }
}
