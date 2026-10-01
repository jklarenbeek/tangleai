import type { StoredDocumentBundle } from '@tangleai/documents/contracts';
import type { CorpusManifest } from './contracts.gen.ts';
import type { GroundingStore } from './store.ts';
/** Explicit curator command. Both state owners must share one host transaction. */
export function promoteToCorpus(store: GroundingStore, manifest: CorpusManifest, bundle: StoredDocumentBundle) {
    return store.promoteToCorpus(manifest, bundle);
}
