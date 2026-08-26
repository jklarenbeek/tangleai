/**
 * The Tangle memory record, as plain JSON Schema — memflow's `MemoryUnit`
 * re-modelled to be a strict SUPERSET of the @jarenjs/ai ledger memory.
 *
 * The alignment is the design decision that matters. A jarenjs ledger
 * memory is `{ id, text, evidence, tags, at }` with evidence REQUIRED —
 * a memory without evidence is a guess. memflow's MemoryUnit had
 * `content`/`timestamp`/`metadata` and no evidence rule, which is one
 * reason its consolidation loops could never be audited. Tangle keeps
 * jarenjs's five fields under jarenjs's names and adds what the
 * consolidation policies need on top:
 *
 *   kind        — fact | event | summary | relation (memflow's `type`)
 *   embedding   — the vector, present once an embed pass has run, and
 *   embeddedBy  — its identity `{ model, dims }`, the jarenjs ledger's
 *                 own rule (a vector never travels without the model
 *                 that made it: vectors from two models compare into
 *                 plausible garbage). Both-or-neither, as in the ledger.
 *   confidence  — [0,1], moved by outcome learning, never below the floor
 *   supersededBy / supersededAt / supersededReason — contradiction
 *                 resolution marks the loser instead of deleting it, so
 *                 "what did we believe before" stays answerable
 *   mergedFrom  — crystallization provenance: the ids this record absorbed
 *   relations   — typed edges to other memories, document-shaped; a graph
 *                 store may index these later, nothing requires one now
 *
 * `toLedgerMemory()` projects a Tangle record down to the jarenjs fields
 * — the five the ledger always held plus the optional embedding pair —
 * so any Tangle memory can be mirrored into a real ledger and recalled
 * by an unmodified @jarenjs/ai agent, by tag AND by meaning
 * (`recall({ near })` through the same embedder that wrote the vector).
 * The projection is lossy by design — the ledger's strictness
 * (`additionalProperties: false`) is a feature we align with, not a
 * limitation we fight.
 *
 * The interfaces are hand-written beside the schemas rather than derived
 * from them: the schemas are the runtime contract (what a validator
 * enforces at the store boundary), the interfaces are the compile-time
 * one, and the schema tests are what keep them honest with each other.
 */

/** A JSON Schema document. `Record<string, any>` rather than
 * `Record<string, unknown>` on purpose: this package is dependency-free
 * and cannot name `@jarenjs/validate`'s `JSONSchema` type, and `unknown`
 * values do not assign to its keyword intersection — `any` does, in both
 * directions, which is exactly what a document crossing that boundary
 * needs. (Recorded in JARENASK.md.) */
export type JsonSchema = Record<string, any>;

/** RFC 3339 timestamp — same shape and same reasoning as the jarenjs ledger:
 * `format` is honest metadata, `pattern` is the zero-dependency enforcement,
 * and recency sorts these strings lexicographically. */
const AT: JsonSchema = {
  type: 'string',
  format: 'date-time',
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})$',
};

/** A non-empty identifier. */
const ID: JsonSchema = { type: 'string', minLength: 1 };

/** A stored embedding: plain numbers, never a typed array — a
 * `Float32Array` does not survive JSON, and the store boundary is JSON.
 * Finiteness and width are the identity's job, checked where the vector
 * is used (`@jarenjs/core/vector` `isVector`). */
const EMBEDDING: JsonSchema = { type: 'array', items: { type: 'number' }, minItems: 1 };

/** A vector's identity, byte-for-byte the jarenjs ledger's `EMBEDDED_BY`. */
const EMBEDDED_BY: JsonSchema = {
  type: 'object',
  properties: {
    model: { type: 'string', minLength: 1 },
    dims: { type: 'integer', minimum: 1 },
  },
  required: ['model', 'dims'],
  additionalProperties: false,
};

/** Both-or-neither, spelled as draft-07 `dependencies` — the ledger's
 * spelling, under the validator's draft-07 default. */
const EMBEDDING_PAIR = { embedding: ['embeddedBy'], embeddedBy: ['embedding'] };

export const MEMORY_KINDS = ['fact', 'event', 'summary', 'relation'] as const;
export type MemoryKind = typeof MEMORY_KINDS[number];

export interface MemoryRelation {
  target: string;
  relType: string;
  weight?: number;
}

/** Which model produced a vector, at what width — the same shape as
 * `LedgerEmbeddedBy` in `@jarenjs/ai/schemas/ledger`, restated here
 * because this package is dependency-free (the mirror test pins the
 * two against each other). */
export interface EmbeddedBy {
  model: string;
  dims: number;
}

/** Whether two identities name the same vector space. Two absent
 * identities are NOT the same: an un-embedded record has no space to
 * share, and "no identity" must never rank against "no identity". */
export function sameEmbeddedBy(a: EmbeddedBy | undefined, b: EmbeddedBy | undefined): boolean {
  return a !== undefined && b !== undefined && a.model === b.model && a.dims === b.dims;
}

export interface MemoryUnit {
  id: string;
  text: string;
  evidence: string;
  tags: string[];
  /** RFC 3339. */
  at: string;
  kind: MemoryKind;
  /** Present exactly when `embeddedBy` is. */
  embedding?: number[];
  /** Present exactly when `embedding` is. */
  embeddedBy?: EmbeddedBy;
  confidence?: number;
  supersededBy?: string;
  supersededAt?: string;
  supersededReason?: string;
  mergedFrom?: string[];
  relations?: MemoryRelation[];
}

export interface OutcomeReport {
  memoryIds: string[];
  outcome: 'success' | 'failure' | 'partial';
  /** RFC 3339. */
  at: string;
  /** What happened, in the world — the ground truth that makes the
   * adjustment an observation rather than a self-judgment. */
  evidence: string;
}

/** What a @jarenjs/ai ledger memory holds: the five fields, plus the
 * optional embedding pair. Structurally identical to `LedgerMemory` in
 * `@jarenjs/ai/schemas/ledger` — restated because this package is
 * dependency-free; `test/memory/ledger-mirror.test.ts` pins the two
 * against each other at compile time. */
export interface LedgerMemory {
  id: string;
  text: string;
  evidence: string;
  tags: string[];
  at: string;
  embedding?: number[];
  embeddedBy?: EmbeddedBy;
}

export const MEMORY_RELATION_SCHEMA: JsonSchema = {
  $id: 'https://tangleai.dev/schemas/memory-relation.json',
  type: 'object',
  properties: {
    target: ID,
    relType: { type: 'string', minLength: 1 },
    weight: { type: 'number', minimum: 0 },
  },
  required: ['target', 'relType'],
  additionalProperties: false,
};

export const MEMORY_UNIT_SCHEMA: JsonSchema = {
  $id: 'https://tangleai.dev/schemas/memory-unit.json',
  type: 'object',
  properties: {
    id: ID,
    text: { type: 'string', minLength: 1 },
    evidence: { type: 'string', minLength: 1 },
    tags: { type: 'array', items: { type: 'string', minLength: 1 } },
    at: AT,
    kind: { enum: [...MEMORY_KINDS] },
    embedding: EMBEDDING,
    embeddedBy: EMBEDDED_BY,
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    supersededBy: ID,
    supersededAt: AT,
    supersededReason: { type: 'string', minLength: 1 },
    mergedFrom: { type: 'array', items: ID },
    relations: { type: 'array', items: { $ref: 'https://tangleai.dev/schemas/memory-relation.json' } },
  },
  required: ['id', 'text', 'evidence', 'tags', 'at', 'kind'],
  dependencies: EMBEDDING_PAIR,
  additionalProperties: false,
};

/** The outcome report a host files after acting on recalled memories. */
export const OUTCOME_REPORT_SCHEMA: JsonSchema = {
  $id: 'https://tangleai.dev/schemas/outcome-report.json',
  type: 'object',
  properties: {
    memoryIds: { type: 'array', items: ID, minItems: 1 },
    outcome: { enum: ['success', 'failure', 'partial'] },
    at: AT,
    // what happened, in the world — the ground truth that makes the
    // adjustment an observation rather than a self-judgment
    evidence: { type: 'string', minLength: 1 },
  },
  required: ['memoryIds', 'outcome', 'at', 'evidence'],
  additionalProperties: false,
};

export const MEMORY_SCHEMAS = {
  unit: MEMORY_UNIT_SCHEMA,
  relation: MEMORY_RELATION_SCHEMA,
  outcome: OUTCOME_REPORT_SCHEMA,
} as const;

/**
 * Project a Tangle memory down to what a @jarenjs/ai ledger accepts:
 * the five fields, and the embedding pair when the unit carries one —
 * so a mirrored memory is recallable by meaning, not only by tag.
 * Lossy on purpose; see the header.
 */
export function toLedgerMemory(unit: MemoryUnit): LedgerMemory {
  const memory: LedgerMemory = {
    id: unit.id,
    text: unit.text,
    evidence: unit.evidence,
    tags: unit.tags,
    at: unit.at,
  };
  if (unit.embedding !== undefined && unit.embeddedBy !== undefined) {
    memory.embedding = unit.embedding;
    memory.embeddedBy = { ...unit.embeddedBy };
  }
  return memory;
}
