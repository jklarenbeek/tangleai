/** A detached resident read oracle over the identical prepared corpus bytes. */
import { cloneJson } from '@jarenjs/core/object';
import { LIGHTRAG_TABLES, createMemoryLightRagPersistence, createLightRagStoreAdapter,
  type LightRagStored } from '@tangleai/lightrag';
import type { DocumentCorpusStore } from '@tangleai/documents';
import type { TangleDb } from '@tangleai/store';

export async function createResidentGraphOracle(db: TangleDb, documents: DocumentCorpusStore) {
  const persistence = createMemoryLightRagPersistence();
  await persistence.transaction(async view => {
    for (const table of LIGHTRAG_TABLES) {
      for await (const row of db.collection<LightRagStored>('lightrag_' + table).query<LightRagStored>({ $for: { r: '$[*]' }, $orderby: '$r.id', $return: '$r' }))
        await view.put(table, row);
    }
  });
  const sources = await documents.listSources(), versions = await documents.listVersions();
  const elements = (await Promise.all(versions.map(v => documents.listElements(v.id)))).flat();
  const chunks = await documents.listChunks(), parents = await documents.listParents();
  const copyFound = <T>(value: T | undefined): T | undefined => value === undefined ? undefined : cloneJson(value);
  const readOnly = async (): Promise<never> => { throw new Error('The resident vector oracle grants no write authority.'); };
  const resident: DocumentCorpusStore = {
    getSource: async id => copyFound(sources.find(row => row.id === id)), listSources: async () => cloneJson(sources),
    getVersion: async id => copyFound(versions.find(row => row.id === id)),
    listVersions: async sourceId => cloneJson(versions.filter(v => sourceId === undefined || v.sourceId === sourceId)),
    listElements: async versionId => cloneJson(elements.filter(v => v.versionId === versionId)),
    listChunks: async versionId => cloneJson(chunks.filter(v => versionId === undefined || v.versionId === versionId)),
    listParents: async versionId => cloneJson(parents.filter(v => versionId === undefined || v.versionId === versionId)),
    putSource: readOnly, activate: readOnly, recordFailure: readOnly,
  };
  return { graph: createLightRagStoreAdapter(persistence), documents: resident };
}
