/**
 * A proposal is a patch over a file map, and nothing more.
 *
 * The shape is narrow on purpose. `op` is `add`, `replace` or `remove` —
 * `move` and `copy` are absent because a rename expressed as one operation
 * would slip past a check that reads adds and removes, and `test` is absent
 * because a patch that can assert is a patch that can branch. A `path` is
 * `/files/` plus exactly ONE RFC 6901 segment, so the path is data the
 * policy decodes rather than structure the patch engine walks.
 *
 * Nothing here touches a filesystem: the file map is read by the host and
 * handed in.
 */

import { refuseOne, ok, type EvolveOutcome } from './errors.ts';
import { evolveRevision } from './identity.ts';

export type PatchOp = 'add' | 'replace' | 'remove';

export interface ProposalOperation {
  op: PatchOp;
  path: string;
  value?: string;
}

export interface EvolveProposalInput {
  proposalId: string;
  strategyId: string;
  rationale: string;
  evidence: string[];
  patch: ProposalOperation[];
  origin: 'hand-authored' | 'checked-skill' | 'model';
}

/** The schema a later order hands to a structured-output client. Exported, unused here. */
export const EVOLVE_PROPOSAL_SCHEMA = Object.freeze({
  type: 'object',
  required: ['proposalId', 'strategyId', 'rationale', 'evidence', 'patch', 'origin'],
  additionalProperties: false,
  properties: {
    proposalId: { type: 'string', minLength: 1, maxLength: 200 },
    strategyId: { type: 'string', minLength: 1, maxLength: 200 },
    rationale: { type: 'string', minLength: 1, maxLength: 2048 },
    evidence: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1 },
    origin: { enum: ['hand-authored', 'checked-skill', 'model'] },
    patch: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['op', 'path'],
        additionalProperties: false,
        properties: {
          op: { enum: ['add', 'replace', 'remove'] },
          path: { type: 'string', pattern: '^/files/[^/]+$' },
          value: { type: 'string' },
        },
      },
    },
  },
});

const SEGMENT = /^\/files\/[^/]+$/;

/** RFC 6901: `~1` is `/` and `~0` is `~`, decoded in that order. */
export function decodePointerSegment(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

/** The repository-relative path an operation addresses. */
export function operationPath(operation: ProposalOperation): string {
  return decodePointerSegment(operation.path.slice('/files/'.length));
}

function refuseAt(index: number, detail: string): EvolveOutcome<never> {
  return refuseOne('TEVO1001', '/patch/' + index, detail);
}

/** Validate the closed shape. Every refusal points at the offending operation. */
export function loadProposal(value: unknown): EvolveOutcome<EvolveProposalInput> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return refuseOne('TEVO1001', '', 'A proposal must be a JSON object.');
  }
  const input = value as Record<string, unknown>;

  for (const [name, limit] of [['proposalId', 200], ['strategyId', 200], ['rationale', 2048]] as const) {
    const held = input[name];
    if (typeof held !== 'string' || held.length === 0 || held.length > limit) {
      return refuseOne('TEVO1001', '/' + name, 'Expected a string of 1 to ' + limit + ' characters.');
    }
  }
  if (!['hand-authored', 'checked-skill', 'model'].includes(input.origin as string)) {
    return refuseOne('TEVO1001', '/origin', 'A proposal declares where it came from.');
  }
  if (!Array.isArray(input.evidence) || input.evidence.length === 0
    || input.evidence.some(one => typeof one !== 'string' || one.length === 0)) {
    return refuseOne('TEVO1001', '/evidence', 'A proposal cites at least one piece of evidence.');
  }
  const known = new Set(['proposalId', 'strategyId', 'rationale', 'evidence', 'patch', 'origin']);
  for (const name of Object.keys(input)) {
    if (!known.has(name)) return refuseOne('TEVO1001', '/' + name, 'A proposal carries no member named ' + name + '.');
  }
  if (!Array.isArray(input.patch) || input.patch.length === 0) {
    return refuseOne('TEVO1001', '/patch', 'A proposal is at least one operation.');
  }

  const operations: ProposalOperation[] = [];
  for (const [index, raw] of input.patch.entries()) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return refuseAt(index, 'An operation is an object.');
    const operation = raw as Record<string, unknown>;
    for (const name of Object.keys(operation)) {
      if (!['op', 'path', 'value'].includes(name)) return refuseAt(index, 'An operation carries no member named ' + name + '.');
    }
    if (!['add', 'replace', 'remove'].includes(operation.op as string)) {
      // move and copy would express a rename as one opaque step; test would
      // let a patch assert. Neither is part of the vocabulary.
      return refuseAt(index, 'Only add, replace and remove are patch operations here.');
    }
    if (typeof operation.path !== 'string' || !SEGMENT.test(operation.path)) {
      return refuseAt(index, 'A path is /files/ plus exactly one encoded segment.');
    }
    if (operation.op === 'remove') {
      if (Object.hasOwn(operation, 'value')) return refuseAt(index, 'A remove carries no value.');
    }
    else if (typeof operation.value !== 'string') {
      return refuseAt(index, 'An add or replace carries string file content.');
    }
    operations.push(operation as unknown as ProposalOperation);
  }

  return ok({
    proposalId: input.proposalId as string,
    strategyId: input.strategyId as string,
    rationale: input.rationale as string,
    evidence: input.evidence as string[],
    origin: input.origin as EvolveProposalInput['origin'],
    patch: operations,
  });
}

/** The patch's content address: the operations, and nothing about who sent them. */
export function patchIdOf(operations: readonly ProposalOperation[]): Promise<string> {
  return evolveRevision(operations as unknown as Record<string, unknown>);
}

/** The bytes a patch would write, counted the way a budget counts them. */
export function patchBytes(operations: readonly ProposalOperation[]): number {
  let total = 0;
  for (const operation of operations) {
    total += Buffer.byteLength(operation.path, 'utf8');
    if (typeof operation.value === 'string') total += Buffer.byteLength(operation.value, 'utf8');
  }
  return total;
}
