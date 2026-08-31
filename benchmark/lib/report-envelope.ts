/**
 * The shared config-identity envelope every benchmark artifact carries.
 *
 * One vocabulary, three honest states: a `run` row references a
 * complete identity in the table; a `not-run` row is analysis — a
 * ceiling, a keyless screen, a scorer gate — that ran no provider stack
 * and cannot pretend to one; a `legacy-unrecorded` row keeps a historic
 * result whose effective stack was never captured, stated as an
 * absence, never backfilled with a guess. The envelope's shape and its
 * dangling-reference refusal live in `@tangleai/config`'s run-identity
 * schema; this module only builds the three shapes so four generators
 * do not each grow their own.
 */

import type { IdentityEnvelope, RowIdentityRef, RunIdentity } from '@tangleai/config';

/** Analytic rows: nothing here ran a provider stack. */
export function analyticEnvelope(rowIds: readonly string[]): IdentityEnvelope {
  return {
    identities: [],
    rows: rowIds.map((rowId): RowIdentityRef => ({ rowId, identityStatus: 'not-run' })),
  };
}

/** Historic rows whose stack was never recorded — a stated absence. */
export function legacyEnvelope(rowIds: readonly string[]): IdentityEnvelope {
  return {
    identities: [],
    rows: rowIds.map((rowId): RowIdentityRef => ({ rowId, identityStatus: 'legacy-unrecorded' })),
  };
}

/** Rows that ran: every row references an identity in the table. */
export function runEnvelope(
  identities: readonly RunIdentity[],
  rows: ReadonlyArray<{ rowId: string, identityId: string }>,
): IdentityEnvelope {
  return {
    identities: [...identities],
    rows: rows.map((row): RowIdentityRef => ({ rowId: row.rowId, identityStatus: 'run', identityId: row.identityId })),
  };
}
