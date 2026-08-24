/**
 * Turning raw observations into memory units.
 *
 * Ids are content-addressed — `m-<fnv1a(text)>-<length>` via the same
 * `hashContent` the @jarenjs/ai recall slots use — so ingesting the same
 * observation twice produces the same id and the second write is an
 * overwrite, not a duplicate. Idempotence by construction beats
 * deduplication by policy; the crystallizer then only has to handle
 * NEAR-duplicates, which no hash can catch.
 */

import { hashContent } from '@jarenjs/core/string';
import type { MemoryKind, MemoryUnit } from '@tangleai/core/schemas/memory';

export function memoryId(text: string): string {
  return `m-${hashContent(text)}-${text.length}`;
}

export interface MemoryUnitInput {
  text: string;
  /** Where this came from — required at the call site, not defaulted:
   * the jarenjs rule that an unevidenced memory is a guess starts here,
   * where it is cheapest to enforce. */
  evidence: string;
  /** RFC 3339 timestamp (injected, never Date.now here). */
  at: string;
  tags?: string[];
  kind?: MemoryKind;
  embedding?: number[];
  confidence?: number;
}

export function createMemoryUnit(input: MemoryUnitInput): MemoryUnit {
  const unit: MemoryUnit = {
    id: memoryId(input.text),
    text: input.text,
    evidence: input.evidence,
    tags: input.tags ?? [],
    at: input.at,
    kind: input.kind ?? 'fact',
  };
  if (input.embedding !== undefined) unit.embedding = input.embedding;
  if (input.confidence !== undefined) unit.confidence = input.confidence;
  return unit;
}
