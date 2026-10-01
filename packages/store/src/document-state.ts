/** Internal transaction owner shared by ingestion and explicit corpus promotion. */
import { equalsJson } from '@jarenjs/core/object';
import type { TransactionStore } from '@jarenjs/db';
import { DocumentError, assertStoredDocumentBundle, type DocumentSource, type DocumentVersion,
  type StoredDocumentBundle } from '@tangleai/documents/contracts';

/** The caller owns the transaction. Every put, including a throwing probe, rolls back together. */
export async function applyDocumentBundle(transaction: TransactionStore, input: StoredDocumentBundle,
  applyProbe?: (step: string) => void): Promise<number> {
  assertStoredDocumentBundle(input);
  // Storage JSON has no undefined fields. Normalize before comparison as well as writing.
  const bundle = JSON.parse(JSON.stringify(input)) as StoredDocumentBundle;
  const scopedSources = transaction.collection<DocumentSource>('sources');
  const scopedVersions = transaction.collection<DocumentVersion>('document_versions');
  const previous = await scopedSources.get(bundle.source.id);
  const active: DocumentVersion = { ...bundle.version, status: 'active', activatedAt: bundle.source.fetchedAt };
  delete active.error; delete active.supersededAt;
  const source = { ...bundle.source, status: 'ready' as const }; delete source.error;
  const groups = [ ['document_elements', bundle.elements], ['document_chunks', bundle.chunks],
    ['document_parents', bundle.parents ?? []] ] as const;
  let unchanged = equalsJson(previous, source) && equalsJson(await scopedVersions.get(active.id), active);
  for (const [table, records] of groups) for (const record of records) {
    const retained = await transaction.collection(table).get(record.id);
    if (retained !== undefined && !equalsJson(retained, record))
      throw new DocumentError('invalid-record', 'Retained evidence cannot change at an existing address');
    if (retained === undefined) unchanged = false;
  }
  if (unchanged) return 0;
  let changes = 0;
  const put = async <T extends { id: string }>(table: string, row: T) => {
    await transaction.collection(table).put(row); changes++; applyProbe?.('put:' + table);
  };
  const staging = { ...active, status: 'staging' as const }; delete staging.activatedAt;
  await put('document_versions', staging);
  for (const [table, records] of groups) for (const record of records) await put(table, record);
  await put('document_versions', active); await put('sources', source);
  if (previous?.activeVersionId && previous.activeVersionId !== active.id) {
    const old = await scopedVersions.get(previous.activeVersionId);
    if (old) await put('document_versions', { ...old, status: 'superseded', supersededAt: source.fetchedAt });
  }
  // Superseded elements, chunks and parents remain addressable evidence.
  return changes;
}
