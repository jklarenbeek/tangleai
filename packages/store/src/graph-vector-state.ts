/** Durable identity and retained rollback authority for one complete graph corpus. */
import type { TransactionStore } from '@jarenjs/db';
import { equalsJson } from '@jarenjs/core/object';
import { immutableLightRagJson, lightragFailure, lightragMust, validateLightRagShape, type LightRagEmbeddedBy, type GraphContributionInput, type LightRagOutcome } from '@tangleai/lightrag';
import type { TangleDb } from './db.ts';
import { assertDocumentSource, assertDocumentVersion, type DocumentSource, type DocumentVersion } from '@tangleai/documents/contracts';
import type { Head } from '@tangleai/outcomes';
import { declareGraphVectors, GraphVectorRefusal } from './graph-vector-model.ts';

export const GRAPH_VECTOR_STATE_KEY = 'lightrag:vector:identity';
export interface GraphVectorSource {
  source: DocumentSource;
  version: DocumentVersion;
  head: Head;
}
export interface GraphVectorRollback {
  id: string;
  identity: LightRagEmbeddedBy;
  sources: GraphVectorSource[];
  profiles: GraphContributionInput['profileUpdates'];
}
export interface GraphVectorState {
  revision: number;
  active: LightRagEmbeddedBy;
  retained: GraphVectorRollback[];
}
export async function readGraphVectorState(scope: Pick<TransactionStore, 'collection'>): Promise<GraphVectorState | null> {
  const stored = await scope.collection<{ key: string; value: GraphVectorState }>('settings').get(GRAPH_VECTOR_STATE_KEY);
  if (!stored) return null;
  return validateGraphVectorState(stored.value);
}
export function validateGraphVectorState(value: GraphVectorState): GraphVectorState {
  try {
    const closed = (row: object, keys: string[]) => {
      if (!row || typeof row !== 'object' || Array.isArray(row) || !equalsJson(Object.keys(row).sort(), [...keys].sort()))
        throw new TypeError('A retained graph record has unknown or missing fields.');
    };
    closed(value, ['revision', 'active', 'retained']);
    if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.retained) || value.retained.length > 32)
      throw new TypeError('The retained graph identity state is invalid.');
    for (const row of value.retained) {
      closed(row, ['id', 'identity', 'sources', 'profiles']);
      if (!/^[a-f0-9]{64}$/.test(row.id) || !Array.isArray(row.sources) || !row.sources.length || row.sources.length > 128 || !Array.isArray(row.profiles))
        throw new TypeError('A retained rollback has an invalid id or incomplete corpus.');
      for (const profile of row.profiles) lightragMust(validateLightRagShape('graphCanonicalProfile', profile));
      if (new Set(row.profiles.map(profile => profile.kind + ':' + profile.id)).size !== row.profiles.length)
        throw new TypeError('A retained rollback repeats a canonical profile.');
      for (const source of row.sources) {
        closed(source, ['source', 'version', 'head']); assertDocumentSource(source.source); assertDocumentVersion(source.version);
        lightragMust(validateLightRagShape('lightRagHead', source.head));
        if (!equalsJson(source.version.embeddedBy, row.identity) || source.source.id !== source.version.sourceId
          || source.source.activeVersionId !== source.version.id || source.source.status !== 'ready' || source.version.status !== 'active')
          throw new TypeError('A retained rollback differs from its complete document identity.');
      }
      if (new Set(row.sources.map(source => source.source.id)).size !== row.sources.length) throw new TypeError('A retained rollback repeats a source.');
    }
    if (new Set(value.retained.map(row => row.id)).size !== value.retained.length) throw new TypeError('A retained rollback id repeats.');
    declareGraphVectors(value.active, value.retained.map(row => row.identity));
    return immutableLightRagJson(value);
  } catch (cause) { throw new GraphVectorRefusal('TVEC1003', 'The retained graph identity state is invalid.', { cause }); }
}
export async function assertGraphVectorWriteIdentity(scope: Pick<TransactionStore, 'collection'>, identity: LightRagEmbeddedBy): Promise<void> {
  const state = await readGraphVectorState(scope);
  if (state && !equalsJson(state.active, identity))
    throw new GraphVectorRefusal('TVEC1001', 'An identity change must promote the complete staged document and graph corpus.');
}
/** Revocation retains an audit record and all evidence; it never deletes vectors. */
export async function disposeGraphVectorRollback(db: TangleDb, input: { id: string; expectedRevision: number; reason: string }):
  Promise<LightRagOutcome<{ revision: number; writes: number; replayed: boolean }>> {
  try {
    input = { ...input };
    if (!input.reason.trim() || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1)
      throw new GraphVectorRefusal('TVEC1003', 'Rollback disposal requires an exact identity revision and a reason.');
    const value = await db.transaction(async scope => {
      const key = 'lightrag:vector:disposal:' + input.id;
      const previous = await scope.collection<{ key: string; value: { input: typeof input; revision: number } }>('settings').get(key);
      if (previous) {
        if (!equalsJson(previous.value.input, input)) throw new GraphVectorRefusal('TVEC1003', 'A rollback disposal cannot change its retained authority.');
        return { revision: previous.value.revision, writes: 0, replayed: true };
      }
      const state = await readGraphVectorState(scope), rollback = state?.retained.find(row => row.id === input.id);
      if (!state || !rollback || state.revision !== input.expectedRevision)
        throw new GraphVectorRefusal('TVEC1003', 'Rollback disposal requires its current retained identity fence.');
      const next = { ...state, revision: state.revision + 1, retained: state.retained.filter(row => row.id !== input.id) };
      await scope.collection('settings').put({ key: GRAPH_VECTOR_STATE_KEY, value: next });
      await scope.collection('settings').put({ key, value: { input, revision: next.revision, rollback } });
      return { revision: next.revision, writes: 2, replayed: false };
    }, { mode: 'immediate' });
    return { valid: true, value };
  } catch (cause) { return lightragFailure(cause); }
}
