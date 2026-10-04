import type { DocumentIngester, DocumentCorpusStore, DocumentVersion } from '@tangleai/documents';
import type { LiteratureRecord, ScreeningDecision, SourceAcquisition, EvidenceCard } from '../contracts.gen.ts';
import { immutableResearchJson, copyResearchBytes, researchArtifactIdOf, researchRevisionOf } from '../identity.ts';
import { researchIssue } from '../errors.ts';
import { jsonArtifact, type ResearchAdapterArtifact } from '../adapters/runtime.ts';
import { extractEvidenceCards } from './cards.ts';

export interface ResearchDocumentHost {
  ingester: Pick<DocumentIngester, 'ingest'>;
  store: Pick<DocumentCorpusStore, 'getVersion' | 'listElements'>;
  /** Exact retained body for this version. The native document store retains extracted elements, not raw bodies. */
  readSourceBytes(version: DocumentVersion, signal: AbortSignal): Promise<Uint8Array>;
}
export interface ResearchAcquisitionLimits { sources: number; bytes: number; cards: number }
export async function acquireResearchSources(records: readonly LiteratureRecord[], screening: readonly ScreeningDecision[],
  host: ResearchDocumentHost, input: { signal: AbortSignal; promptRevision: string; limits: ResearchAcquisitionLimits }) {
  const rows = immutableResearchJson(records), decisions = immutableResearchJson(screening), limits = immutableResearchJson(input.limits);
  const { signal, promptRevision } = input;
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Acquisition limits must be positive integers.');
  const acquisitions: SourceAcquisition[] = [], cards: EvidenceCard[] = [], artifacts: ResearchAdapterArtifact[] = [];
  const versions: unknown[] = [];
  let sources = 0, consumed = 0;
  for (const row of rows.filter(record => decisions.some(d => d.literatureId === record.id && d.decision === 'keep'))) {
    let value: Omit<SourceAcquisition, 'id'> = { literatureId: row.id, status: 'unresolved', versionId: null, contentHash: null, artifactId: null, issues: [] };
    try {
      signal.throwIfAborted();
      if (++sources > limits.sources || consumed >= limits.bytes) throw new Error('acquisition-budget');
      const result = await host.ingester.ingest({ url: row.sourcePath, force: true, allowBrowser: false, signal });
      const version = await host.store.getVersion(result.version.id);
      if (!version || version.contentHash !== result.version.contentHash) throw new Error('unretained-version');
      const bytes = copyResearchBytes(await host.readSourceBytes(version, signal)); consumed += bytes.byteLength;
      if (consumed > limits.bytes) throw new Error('acquisition-byte-budget');
      const artifactId = await researchArtifactIdOf(bytes);
      if (artifactId !== 'art-' + version.contentHash) throw new Error('source-content-mismatch');
      const elements = await host.store.listElements(version.id);
      const extracted = await extractEvidenceCards({ literatureId: row.id, version, elements, bytes,
        promptRevision, maxCards: limits.cards - cards.length });
      if (!extracted.valid) { value.issues = extracted.issues; }
      else cards.push(...extracted.value);
      artifacts.push({ bytes, mediaType: result.source.mimeType });
      versions.push({ id: version.id, sourceId: version.sourceId, contentHash: version.contentHash,
        extractionVersion: version.extractionVersion, elements });
      value = { ...value, status: 'resolved', versionId: version.id, contentHash: version.contentHash, artifactId };
    } catch (cause) {
      value.issues.push(researchIssue('TRSH1008', '/sources/' + row.id, 'Source acquisition failed.', cause));
    }
    acquisitions.push({ ...value, id: 'acquisition-' + await researchRevisionOf(value) });
  }
  if (versions.length) artifacts.push(jsonArtifact({ kind: 'source-versions', value: versions }));
  return { acquisitions, cards, artifacts };
}
