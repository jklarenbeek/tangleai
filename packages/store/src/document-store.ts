import {
  assertDocumentSource,
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
import { applyDocumentBundle } from './document-state.ts';

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
  const locks = new Map<string, Promise<void>>();

  async function serial<T>(sourceId: string, operation: () => Promise<T>): Promise<T> {
    while (locks.has(sourceId)) await locks.get(sourceId);
    let release = (): void => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    locks.set(sourceId, held);
    try {
      return await operation();
    } finally {
      locks.delete(sourceId);
      release();
    }
  }

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
        .sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.order - b.order);
    },
    async listParents(versionId) {
      return (await rows<DocumentParent>(db, 'document_parents', versionId === undefined ? {} : { versionId }))
        .sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.order - b.order);
    },
    async putSource(source) {
      assertDocumentSource(source);
      await sources.put(source);
    },
    async activate(bundle: StoredDocumentBundle) {
      await serial(bundle.source.id, () => db.transaction(async transaction => {
        await applyDocumentBundle(transaction, bundle);
      }, { mode: 'immediate' }));
    },
    async recordFailure(source, version) {
      await serial(source.id, async () => {
        assertDocumentSource(source);
        const current = await sources.get(source.id);
        const activeVersionId = current?.activeVersionId ?? source.activeVersionId;
        const retained = activeVersionId === undefined
          ? source
          : { ...(current ?? source), activeVersionId, status: 'ready' as const, error: source.error, fetchedAt: source.fetchedAt };
        await sources.put(retained);
        if (version !== undefined) {
          assertDocumentVersion(version);
          const known = await versions.get(version.id);
          if (known?.status !== 'active') await versions.put({ ...version, status: 'failed' });
        }
      });
    },
  };
}
