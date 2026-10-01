/**
 * The current document-grounding lane, observable.
 *
 * This module is the ONE serializer of document evidence for the
 * grounded chat prompt — extracted from the chat engine so the
 * benchmark measures the exact bytes the product sends, instead of a
 * copy that would drift. It deliberately does NOT improve the path it
 * observes: expanded neighbour context is serialized exactly as before,
 * including a chunk repeated by two nearby hits, and the counts publish
 * that cost rather than deduplicating it away.
 *
 * Failure is a value here: `collectDocumentEvidence` returns an error
 * instead of an empty result, so a dead embedding or store wire is
 * distinguishable from a genuinely empty corpus. The chat engine keeps
 * its current degradation (an error empties the evidence lanes); what
 * changed is that an observer CAN now tell the difference.
 *
 * Nothing here generates, scores, or decides that a candidate was
 * cited — a retrieved chunk is a candidate, and this module keeps it
 * one.
 */

import type { Vector } from '@jarenjs/core/vector';
import { estimateTokens } from '@tangleai/core/tokens';
import {
  recallDocumentChunks,
  type DocumentCorpusStore,
  type EmbeddedBy,
  type RankedDocumentChunk,
} from '@tangleai/documents';

/** The shipped retrieval values the measured lane runs at. */
export const GROUNDING_DEFAULTS = { k: 6, minScore: 0, maxPerSource: 2, neighbours: 1 } as const;

export { GROUNDED_ANSWER_SCHEMA, renderGroundedAnswer, suppliedReferenceGate, generateGroundedAnswer,
  type GroundedClaim, type GroundedAnswer, type GroundedGenerationOutcome } from '@tangleai/documents/grounding';

export interface DocumentEvidenceOptions {
  k?: number;
  minScore?: number;
  maxPerSource?: number;
  neighbours?: number;
}

/** One serialized evidence block: a ranked candidate plus its expanded context, exactly as the prompt carries it. */
export interface EvidenceBlock {
  /** The ranked candidate the block is headed by. */
  chunkId: string;
  /** Every chunk serialized into this block, candidate and neighbours, in serialization order. */
  serializedChunkIds: string[];
  /** The block's exact prompt text. */
  text: string;
}

export interface DocumentEvidence {
  ranked: RankedDocumentChunk[];
  blocks: EvidenceBlock[];
  /** The exact `DOCUMENT CHUNKS` section the chat prompt sends, byte for byte. */
  context: string;
  /** Unique chunk ids that reached the prompt, first-seen order. */
  suppliedChunkIds: string[];
  /** Every serialized chunk occurrence, duplicates retained. */
  serializedChunkIds: string[];
  /** Serialized occurrences beyond each chunk's first — the cost of independent neighbour expansion. */
  duplicateExpansions: number;
  /** The stable evidence addresses of every supplied chunk. */
  addresses: Array<{ chunkId: string, sourceId: string, versionId: string, elementIds: string[] }>;
  characters: number;
  estimatedTokens: number;
}

export type DocumentEvidenceOutcome =
  /** `skipped` is the recall's own count of chunks another identity embedded — a cost, not an absence. */
  | { ok: true, evidence: DocumentEvidence, skipped: number }
  | { ok: false, error: { code: string, message: string } };

/** One block, exactly as the chat engine has always serialized it. */
function blockOf(item: RankedDocumentChunk): EvidenceBlock {
  const { chunk, context, source, score } = item;
  const expanded = context.map((entry) => entry.text).join('\n\n');
  return {
    chunkId: chunk.id,
    serializedChunkIds: context.map((entry) => entry.id),
    text: `[${chunk.id}] (${score.toFixed(3)}) ${expanded}\n    source: ${source.canonicalUrl}${chunk.pageStart === undefined ? '' : ` page ${chunk.pageStart}`}`,
  };
}

/** The `DOCUMENT CHUNKS` prompt section over ranked candidates — the one serialization, empty case included. */
export function serializeDocumentEvidence(ranked: RankedDocumentChunk[]): { blocks: EvidenceBlock[], context: string } {
  if (ranked.length === 0) return { blocks: [], context: 'DOCUMENT CHUNKS: (none recalled)' };
  const blocks = ranked.map(blockOf);
  return { blocks, context: `DOCUMENT CHUNKS:\n${blocks.map((block) => block.text).join('\n')}` };
}

/** The complete evidence description of one ranked recall — candidates, blocks, bytes and addresses. */
export function describeDocumentEvidence(ranked: RankedDocumentChunk[]): DocumentEvidence {
  const { blocks, context } = serializeDocumentEvidence(ranked);
  const serializedChunkIds = blocks.flatMap((block) => block.serializedChunkIds);
  const suppliedChunkIds: string[] = [];
  const seen = new Set<string>();
  for (const id of serializedChunkIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    suppliedChunkIds.push(id);
  }
  const chunkById = new Map(ranked.flatMap((item) => item.context.map((chunk) => [chunk.id, chunk] as const)));
  return {
    ranked,
    blocks,
    context,
    suppliedChunkIds,
    serializedChunkIds,
    duplicateExpansions: serializedChunkIds.length - suppliedChunkIds.length,
    addresses: suppliedChunkIds.map((chunkId) => {
      const chunk = chunkById.get(chunkId)!;
      return { chunkId, sourceId: chunk.sourceId, versionId: chunk.versionId, elementIds: [...chunk.elementIds] };
    }),
    characters: context.length,
    estimatedTokens: estimateTokens(context),
  };
}

/**
 * The current retrieval/supply path as one observable step: recall at
 * the given options over the given query vector and identity, then the
 * exact serialization above. An embedding-identity mismatch, a dead
 * store or any thrown failure comes back as an error value — never as
 * an empty result pretending the corpus was empty.
 */
export async function collectDocumentEvidence(
  store: DocumentCorpusStore,
  query: Vector,
  identity: EmbeddedBy,
  options: DocumentEvidenceOptions = {},
): Promise<DocumentEvidenceOutcome> {
  try {
    const recall = await recallDocumentChunks(store, query, identity, {
      k: options.k ?? GROUNDING_DEFAULTS.k,
      minScore: options.minScore ?? GROUNDING_DEFAULTS.minScore,
      maxPerSource: options.maxPerSource ?? GROUNDING_DEFAULTS.maxPerSource,
      neighbours: options.neighbours ?? GROUNDING_DEFAULTS.neighbours,
    });
    return { ok: true, evidence: describeDocumentEvidence(recall.ranked), skipped: recall.skipped };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return {
      ok: false,
      error: {
        code: typeof code === 'string' ? code : 'document-recall-failed',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
