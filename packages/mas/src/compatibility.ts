/**
 * Conservative structural schema compatibility.
 *
 * `schemaAccepts(source, target)` answers whether every value valid
 * under `source` is provably valid under `target`. Identical documents
 * are compatible first; a conservative structural subset is accepted
 * only where the rules below prove it; anything uncertain — an unknown
 * keyword, an unprovable constraint, a cross-field `$query` — refuses.
 * A wire the compiler cannot prove is a wire the workflow does not get,
 * which is the D10 reading of typed edges: uncertainty is refusal, not
 * hope.
 */

import { equalsJson } from '@jarenjs/core/object';

const SCALAR_CONSTRAINTS = ['pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'format'] as const;
const KNOWN_KEYWORDS = new Set([
  'type', 'enum', 'const', 'anyOf', 'properties', 'required', 'additionalProperties',
  'propertyNames', 'items', 'minItems', 'maxItems', 'minProperties',
  ...SCALAR_CONSTRAINTS,
  'title', 'description', '$comment',
]);

function typesOf(schema: Record<string, unknown>): string[] | null {
  const type = schema.type;
  if (type === undefined) return null;
  return Array.isArray(type) ? type as string[] : [type as string];
}

function typeCovered(sourceType: string, targetTypes: string[]): boolean {
  if (targetTypes.includes(sourceType)) return true;
  return sourceType === 'integer' && targetTypes.includes('number');
}

export function schemaAccepts(source: unknown, target: unknown): boolean {
  if (equalsJson(source, target)) return true;
  if (target === true) return true;
  if (source === false) return true;
  if (source === true || target === false) return false;
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return false;
  if (target === null || typeof target !== 'object' || Array.isArray(target)) return false;
  const src = source as Record<string, unknown>;
  const tgt = target as Record<string, unknown>;

  // An empty target schema accepts anything.
  if (Object.keys(tgt).length === 0) return true;

  // A target union is satisfied when any member provably accepts the source;
  // a source union requires every member to be accepted.
  if (Array.isArray(tgt.anyOf)) {
    return (tgt.anyOf as unknown[]).some((member) => schemaAccepts(src, member));
  }
  if (Array.isArray(src.anyOf)) {
    return (src.anyOf as unknown[]).every((member) => schemaAccepts(member, tgt));
  }

  // Unknown target keywords cannot be proven; uncertainty refuses.
  for (const keyword of Object.keys(tgt)) {
    if (!KNOWN_KEYWORDS.has(keyword)) return false;
  }

  if (tgt.const !== undefined) {
    return src.const !== undefined && equalsJson(src.const, tgt.const);
  }
  if (Array.isArray(tgt.enum)) {
    const sourceValues = Array.isArray(src.enum) ? src.enum as unknown[] : (src.const !== undefined ? [src.const] : null);
    if (sourceValues === null) return false;
    return sourceValues.every((value) => (tgt.enum as unknown[]).some((allowed) => equalsJson(value, allowed)));
  }

  const targetTypes = typesOf(tgt);
  const sourceTypes = typesOf(src);
  if (targetTypes !== null) {
    if (sourceTypes === null) return false;
    if (!sourceTypes.every((sourceType) => typeCovered(sourceType, targetTypes))) return false;
  }

  // Scalar constraints must be present on the source at equal or stronger value.
  for (const constraint of SCALAR_CONSTRAINTS) {
    const wanted = tgt[constraint];
    if (wanted === undefined) continue;
    const held = src[constraint];
    if (held === undefined) return false;
    switch (constraint) {
      case 'minLength':
      case 'minimum':
      case 'exclusiveMinimum':
        if ((held as number) < (wanted as number)) return false;
        break;
      case 'maxLength':
      case 'maximum':
      case 'exclusiveMaximum':
        if ((held as number) > (wanted as number)) return false;
        break;
      default:
        if (!equalsJson(held, wanted)) return false;
    }
  }

  // Objects: the target's required members must be required and declared by
  // the source; shared members must be compatible; a closed target needs a
  // closed source whose members it all knows.
  if (targetTypes?.includes('object') || tgt.properties !== undefined || tgt.required !== undefined) {
    const sourceProperties = (src.properties ?? {}) as Record<string, unknown>;
    const targetProperties = (tgt.properties ?? {}) as Record<string, unknown>;
    const sourceRequired = new Set((src.required ?? []) as string[]);
    const targetRequired = (tgt.required ?? []) as string[];
    for (const member of targetRequired) {
      if (!sourceRequired.has(member)) return false;
      if (sourceProperties[member] === undefined) return false;
    }
    for (const [member, memberSchema] of Object.entries(sourceProperties)) {
      const targetMember = targetProperties[member];
      if (targetMember !== undefined) {
        if (!schemaAccepts(memberSchema, targetMember)) return false;
      } else if (tgt.additionalProperties === false) {
        return false;
      } else if (tgt.additionalProperties !== undefined && tgt.additionalProperties !== true) {
        if (!schemaAccepts(memberSchema, tgt.additionalProperties)) return false;
      }
    }
    if (tgt.additionalProperties === false && src.additionalProperties !== false) return false;
  }

  // Arrays: items must be compatible and bounds must not loosen.
  if (targetTypes?.includes('array') || tgt.items !== undefined) {
    if (tgt.items !== undefined) {
      if (src.items === undefined) return false;
      if (!schemaAccepts(src.items, tgt.items)) return false;
    }
    const targetMin = (tgt.minItems ?? 0) as number;
    const sourceMin = (src.minItems ?? 0) as number;
    if (targetMin > sourceMin) return false;
    if (tgt.maxItems !== undefined && ((src.maxItems ?? Infinity) as number) > (tgt.maxItems as number)) return false;
  }

  return true;
}
