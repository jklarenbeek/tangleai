import {
  assertDocumentSource,
  DocumentError,
  assertDocumentVersion,
  type DocumentChunk,
  type DocumentCorpusStore,
  type DocumentElement,
  type DocumentParent,
  type DocumentSource,
  type DocumentVersion,
  type StoredDocumentBundle,
} from '@tangleai/documents/contracts';

import type { TransactionStore } from '@jarenjs/db';
import type { TangleDb } from './db.ts';
import { asRows } from './memory-store.ts';
import { applyDocumentBundle, serialDocumentSource } from './document-state.ts';
export { applyDocumentBundle as activateDocumentWithin } from './document-state.ts';

async function rows<T>(db: Pick<TransactionStore, 'collection'>, collection: string, fields: Record<string, unknown> = {}): Promise<T[]> {
  return asRows(await db.collection<T>(collection).execute<T>({
    $for: { row: '$[*]' },
    $where: Object.keys(fields).length === 0 ? true : { $and: Object.entries(fields).map(([field, value]) => ({ $eq: [`$row.${field}`, { $const: value }] })) },
    $return: '$row',
  }));
}

export function createDocumentStore(db: TangleDb): DocumentCorpusStore {
  const sources = db.collection<DocumentSource>('sources');
  const versions = db.collection<DocumentVersion>('document_versions');
  const elements = db.collection<DocumentElement>('document_elements');
  const chunks = db.collection<DocumentChunk>('document_chunks');

  return {
    getSource: (id) => sources.get(id),
    async listSources() {
      const result = await rows<DocumentSource>(db, 'sources');
      result.sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
      return result;
    },
    getVersion: (id) => versions.get(id),
    async listVersions(sourceId) {
      const result = await rows<DocumentVersion>(db, 'document_versions', sourceId === undefined ? {} : { sourceId });
      return result
        .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
    },
    async listElements(versionId) {
      return (await rows<DocumentElement>(db, 'document_elements', { versionId }))
        .sort((a, b) => a.order - b.order);
    },
    async listChunks(versionId) {
      return (await rows<DocumentChunk>(db, 'document_chunks', versionId === undefined ? {} : { versionId }))
        .sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.versionId.localeCompare(b.versionId) || a.order - b.order || a.id.localeCompare(b.id));
    },
    async listParents(versionId) {
      return (await rows<DocumentParent>(db, 'document_parents', versionId === undefined ? {} : { versionId }))
        .sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.versionId.localeCompare(b.versionId) || a.order - b.order || a.id.localeCompare(b.id));
    },
    async putSource(source) {
      assertDocumentSource(source);
      await serialDocumentSource(db, source.id, () => db.transaction(async scope => {
        const collection = scope.collection<DocumentSource>('sources'), previous = await collection.get(source.id);
        if (previous && previous.activeVersionId !== source.activeVersionId)
          throw new DocumentError('stale-source', 'Source metadata refresh cannot replace a concurrently changed active document');
        await collection.put(source);
      }, { mode: 'immediate' }));
    },
    async activate(bundle: StoredDocumentBundle) {
      await serialDocumentSource(db, bundle.source.id, () => db.transaction(async transaction => {
        await applyDocumentBundle(transaction, bundle);
      }, { mode: 'immediate' }));
    },
    async recordFailure(source, version) {
      await serialDocumentSource(db, source.id, () => db.transaction(async scope => {
        assertDocumentSource(source);
        const scopedSources = scope.collection<DocumentSource>('sources'), scopedVersions = scope.collection<DocumentVersion>('document_versions');
        const current = await scopedSources.get(source.id);
        const activeVersionId = current === undefined ? source.activeVersionId : current.activeVersionId;
        const { activeVersionId: _stalePointer, ...failedSource } = source;
        const retained = activeVersionId === undefined
          ? failedSource
          : { ...(current ?? source), activeVersionId, status: 'ready' as const, error: source.error, fetchedAt: source.fetchedAt };
        await scopedSources.put(retained);
        if (version !== undefined) {
          assertDocumentVersion(version);
          const known = await scopedVersions.get(version.id);
          if (known?.status !== 'active') await scopedVersions.put({ ...version, status: 'failed' });
        }
      }, { mode: 'immediate' }));
    },
  };
}
