/** Internal transaction owner shared by ingestion and explicit corpus promotion. */
import { equalsJson } from '@jarenjs/core/object';
import type { TransactionStore } from '@jarenjs/db';
import type { TangleDb } from './db.ts';
import { asRows } from './memory-store.ts';
import type { GraphDocumentBinding,LightRagStored } from '@tangleai/lightrag';
import { DocumentError, assertStoredDocumentBundle, type DocumentSource, type DocumentVersion,
  type StoredDocumentBundle } from '@tangleai/documents/contracts';

const sourceLocks = new WeakMap<TangleDb, Map<string, Promise<void>>>();
/** Documents and graph promotion share one per-database/source admission queue. */
export async function serialDocumentSource<T>(db: TangleDb, sourceId: string, operation: () => Promise<T>): Promise<T> {
  let locks = sourceLocks.get(db); if (!locks) { locks = new Map(); sourceLocks.set(db, locks); }
  while (locks.has(sourceId)) await locks.get(sourceId);
  let release = (): void => {};
  const held = new Promise<void>(resolve => { release = resolve; }); locks.set(sourceId, held);
  try { return await operation(); } finally { locks.delete(sourceId); release(); }
}

async function inspectDocumentActivation(transaction: TransactionStore, input: StoredDocumentBundle) {
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
  return { bundle, previous, active, source, groups, scopedVersions, unchanged };
}
/** Read-only replay check uses the same normalized rows as activation. */
export async function documentBundleIsActiveWithin(transaction: TransactionStore, input: StoredDocumentBundle): Promise<boolean> {
  return (await inspectDocumentActivation(transaction, input)).unchanged;
}
/** The caller owns the transaction. Every put, including a throwing probe, rolls back together. */
export async function applyDocumentBundle(transaction: TransactionStore, input: StoredDocumentBundle,
  applyProbe?: (step: string) => void | Promise<void>, graphAdmission?: Pick<GraphDocumentBinding, 'sourceId' | 'versionId'>): Promise<number> {
  const { previous, active, source, groups, scopedVersions, unchanged } = await inspectDocumentActivation(transaction, input);
  if (unchanged) return 0;
  if (graphAdmission && (graphAdmission.sourceId !== source.id || graphAdmission.versionId !== active.id))
    throw new DocumentError('invalid-record', 'Joint admission must bind this document source and version');
  const projections = asRows(await transaction.collection<LightRagStored<'projections'>>('lightrag_projections').execute<LightRagStored<'projections'>>({
    $for: { row: '$[*]' }, $where: { $and: [{ $eq: ['$row.sourceId', { $const: source.id }] }, { $eq: ['$row.status', 'active'] }] }, $return: '$row',
  }));
  if (!graphAdmission && projections.some(row => row.payload.versionId !== active.id))
    throw new DocumentError('graph-promotion-required', 'An indexed source must replace its document and graph contribution together');
  let changes = 0;
  const put = async <T extends { id: string }>(table: string, row: T) => {
    await transaction.collection(table).put(row); changes++; await applyProbe?.('put:' + table);
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
