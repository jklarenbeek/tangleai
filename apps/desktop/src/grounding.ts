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

import { createStructuredOutput } from '@jarenjs/ai';
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

/**
 * The measured grounded-answer contract — the one schema the benchmark
 * scored and configured chat now generates under. An answer is either
 * claims-with-citations or an explicit abstention; there is no
 * free-prose member a material claim can hide in, because the visible
 * answer is DERIVED from the claim texts (or the abstention reason) by
 * `renderGroundedAnswer`.
 */
export const GROUNDED_ANSWER_SCHEMA = {
  $id: 'https://tangleai.dev/schemas/grounding-answer',
  oneOf: [
    {
      type: 'object',
      required: ['disposition', 'claims'],
      additionalProperties: false,
      properties: {
        disposition: { const: 'answer' },
        claims: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['id', 'text', 'citations'],
            additionalProperties: false,
            properties: {
              id: { type: 'string', minLength: 1, description: 'A reply-local claim id, unique within this answer.' },
              text: { type: 'string', minLength: 1, description: 'One factual proposition, complete on its own.' },
              citations: { type: 'array', items: { type: 'string', minLength: 1 }, description: 'The evidence ids this claim was read from — only ids listed in the prompt.' },
            },
          },
        },
      },
    },
    {
      type: 'object',
      required: ['disposition', 'reason', 'claims'],
      additionalProperties: false,
      properties: {
        disposition: { const: 'abstain' },
        reason: { type: 'string', minLength: 1, description: 'Why the supplied evidence cannot answer the question.' },
        claims: { type: 'array', maxItems: 0 },
      },
    },
  ],
} as const;

export interface GroundedClaim {
  id: string;
  text: string;
  citations: string[];
}

export type GroundedAnswer =
  | { disposition: 'answer', claims: GroundedClaim[] }
  | { disposition: 'abstain', reason: string, claims: [] };

/** The visible answer, derived from the ledger — never free prose. */
export function renderGroundedAnswer(answer: GroundedAnswer): string {
  if (answer.disposition === 'abstain') return answer.reason;
  return answer.claims.map((claim) => claim.text).join('; ');
}

/**
 * The supplied-reference gate: every cited id must be one the request
 * actually serialized, and reply-local claim ids must be unique. Its
 * pointered errors go back through the suite's one bounded repair, so a
 * fabricated id is corrected instead of surfacing. This proves
 * answer-declared USE plus reference integrity — semantic support needs
 * a domain oracle the runtime does not have, and no claim of it is made.
 */
export function suppliedReferenceGate(listed: ReadonlySet<string>): (value: unknown) => true | { valid: false, errors: Array<{ instancePath: string, keyword: string, message: string }> } {
  return (value) => {
    const answer = value as GroundedAnswer;
    if (answer.disposition !== 'answer') return true;
    const errors: Array<{ instancePath: string, keyword: string, message: string }> = [];
    const ids = new Set<string>();
    answer.claims.forEach((claim, claimIndex) => {
      if (ids.has(claim.id)) {
        errors.push({ instancePath: `/claims/${claimIndex}/id`, keyword: 'duplicate-claim-id', message: `the claim id "${claim.id}" repeats; every claim carries its own id` });
      }
      ids.add(claim.id);
      claim.citations.forEach((citation, citationIndex) => {
        if (!listed.has(citation)) {
          errors.push({
            instancePath: `/claims/${claimIndex}/citations/${citationIndex}`,
            keyword: 'unknown-citation',
            message: `"${citation}" is not an id listed in this request's evidence; cite only listed ids, or drop the citation`,
          });
        }
      });
    });
    return errors.length === 0 ? true : { valid: false, errors };
  };
}

export interface GroundedGenerationOutcome {
  /** The validated answer, or null when generation stayed invalid after repair. */
  answer: GroundedAnswer | null;
  /** Why there is no answer, when there is none. */
  failure: { kind: 'invalid' | 'wire', detail: string } | null;
  /** Provider-reported usage of the last completed call, verbatim. */
  usage: unknown;
  attempts: number;
}

/**
 * Generate one grounded answer through the suite's structured output —
 * the schema above, one bounded repair, and the supplied-reference gate
 * over exactly the ids this request serialized. The app owns no parser,
 * repair loop or provider response mode; a wire failure and a
 * permanently invalid reply are values the caller degrades on.
 */
export async function generateGroundedAnswer(
  client: { endpoint: { provider: string }, complete: (request: any) => Promise<any> },
  messages: Array<{ role: string, content: string }>,
  listedIds: ReadonlySet<string>,
): Promise<GroundedGenerationOutcome> {
  let usage: unknown = null;
  const observed = {
    endpoint: client.endpoint,
    async complete(request: any) {
      const result = await client.complete(request) as { usage?: unknown };
      usage = result.usage ?? null;
      return result;
    },
  };
  const generator = createStructuredOutput({
    client: observed,
    schema: GROUNDED_ANSWER_SCHEMA,
    name: 'grounding_answer',
    maxRepairs: 1,
    gate: suppliedReferenceGate(listedIds),
  });
  try {
    const reply = await generator.generate(messages) as
      | { value: GroundedAnswer, attempts: number }
      | { errors: unknown[], raw: string, attempts: number };
    if ('value' in reply) return { answer: reply.value, failure: null, usage, attempts: reply.attempts };
    return {
      answer: null,
      failure: { kind: 'invalid', detail: `the reply failed the answer contract after repair (${reply.errors.length} error(s))` },
      usage,
      attempts: reply.attempts,
    };
  } catch (error) {
    return {
      answer: null,
      failure: { kind: 'wire', detail: error instanceof Error ? error.message : String(error) },
      usage,
      attempts: 0,
    };
  }
}

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
  | { ok: true, evidence: DocumentEvidence }
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
    return { ok: true, evidence: describeDocumentEvidence(recall.ranked) };
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
