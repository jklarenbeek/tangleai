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
 *   embedding   — the vector, present once an embed pass has run
 *   confidence  — [0,1], moved by outcome learning, never below the floor
 *   supersededBy / supersededAt / supersededReason — contradiction
 *                 resolution marks the loser instead of deleting it, so
 *                 "what did we believe before" stays answerable
 *   mergedFrom  — crystallization provenance: the ids this record absorbed
 *   relations   — typed edges to other memories, document-shaped; a graph
 *                 store may index these later, nothing requires one now
 *
 * `toLedgerMemory()` projects a Tangle record down to the five jarenjs
 * fields, so any Tangle memory can be mirrored into a real ledger and
 * recalled by an unmodified @jarenjs/ai agent. The projection is lossy
 * by design — the ledger's strictness (`additionalProperties: false`)
 * is a feature we align with, not a limitation we fight.
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

export const MEMORY_KINDS = ['fact', 'event', 'summary', 'relation'] as const;
export type MemoryKind = typeof MEMORY_KINDS[number];

export interface MemoryRelation {
  target: string;
  relType: string;
  weight?: number;
}

export interface MemoryUnit {
  id: string;
  text: string;
  evidence: string;
  tags: string[];
  /** RFC 3339. */
  at: string;
  kind: MemoryKind;
  embedding?: number[];
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

/** The five fields a @jarenjs/ai ledger memory holds. */
export interface LedgerMemory {
  id: string;
  text: string;
  evidence: string;
  tags: string[];
  at: string;
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
    embedding: { type: 'array', items: { type: 'number' } },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    supersededBy: ID,
    supersededAt: AT,
    supersededReason: { type: 'string', minLength: 1 },
    mergedFrom: { type: 'array', items: ID },
    relations: { type: 'array', items: { $ref: 'https://tangleai.dev/schemas/memory-relation.json' } },
  },
  required: ['id', 'text', 'evidence', 'tags', 'at', 'kind'],
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
 * Project a Tangle memory down to the five fields a @jarenjs/ai ledger
 * accepts. Lossy on purpose; see the header.
 */
export function toLedgerMemory(unit: MemoryUnit): LedgerMemory {
  return {
    id: unit.id,
    text: unit.text,
    evidence: unit.evidence,
    tags: unit.tags,
    at: unit.at,
  };
}
