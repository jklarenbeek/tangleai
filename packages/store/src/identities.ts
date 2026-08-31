/**
 * The identity repository — content-addressed, credential-free run
 * identities, stored once and referenced by id from runs and chats.
 *
 * A stored identity is immutable by construction: its id is the
 * canonical SHA-256 of its own payload, recomputed HERE before every
 * write, so a caller cannot store a mutated identity under a stale id
 * or repeat mutable settings snapshots into the log. Validation is the
 * config package's — the same schema every report envelope uses — and a
 * document that does not validate or does not hash to its claimed id is
 * refused as a value.
 */

import { identityIdOf, validateRunIdentity, type Issue, type RunIdentity } from '@tangleai/config';

import type { TangleDb } from './db.ts';
import { asRows } from './memory-store.ts';

export interface IdentityRepository {
  /** Validate, verify the content address, and store (idempotent). */
  put(identity: RunIdentity): Promise<{ ok: true, id: string } | { ok: false, issues: Issue[] }>;
  get(id: string): Promise<RunIdentity | undefined>;
  list(): Promise<RunIdentity[]>;
}

interface IdentityRow {
  id: string;
  value: RunIdentity;
}

export function createIdentityRepository(db: TangleDb): IdentityRepository {
  const collection = db.collection<IdentityRow>('config_identities');
  return {
    async put(identity) {
      const outcome = validateRunIdentity(identity);
      if (!outcome.ok) return outcome;
      const { identityId, ...body } = outcome.value;
      const recomputed = await identityIdOf(body);
      if (recomputed !== identityId) {
        return {
          ok: false,
          issues: [{ code: 'TCFG1007', path: '/identityId', detail: 'the identity does not hash to its claimed id; a mutated identity cannot be stored under a stale address' }],
        };
      }
      await collection.put({ id: identityId, value: outcome.value });
      return { ok: true, id: identityId };
    },

    async get(id) {
      const row = await collection.get(id);
      return row?.value;
    },

    async list() {
      const rows = asRows(await collection.execute<IdentityRow>({ $for: { r: '$[*]' }, $return: '$r' }));
      rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return rows.map((row) => row.value);
    },
  };
}
