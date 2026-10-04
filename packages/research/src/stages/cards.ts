import type { DocumentVersion, DocumentElement, DocumentCorpusStore } from '@tangleai/documents';
import type { ArtifactRecord } from '@tangleai/context/schemas/evidence';
import type { EvidenceCard } from '../contracts.gen.ts';
import type { ResearchOutcome } from '../errors.ts';
import { researchArtifactIdOf, researchRevisionOf, copyResearchBytes, immutableResearchJson } from '../identity.ts';
import { researchRefuse } from '../errors.ts';
import { researchValue } from '../workflow-contract.ts';
import { validateResearchShape } from '../schema.ts';

export async function extractEvidenceCards(input: { literatureId: string; version: DocumentVersion; elements: readonly DocumentElement[];
  bytes: Uint8Array; promptRevision: string; maxCards: number }): Promise<ResearchOutcome<EvidenceCard[]>> {
  const bytes = copyResearchBytes(input.bytes), version = immutableResearchJson(input.version), elements = immutableResearchJson(input.elements);
  const { literatureId, promptRevision, maxCards } = input;
  const artifactId = await researchArtifactIdOf(bytes);
  if (artifactId !== 'art-' + version.contentHash) return researchRefuse('TRSH1002', '/contentHash', 'Source bytes differ from the immutable document version.');
  if (elements.some(element => element.versionId !== version.id || element.sourceId !== version.sourceId)
    || new Set(elements.map(e => e.order)).size !== elements.length) return researchRefuse('TRSH1005', '/locator', 'Elements belong to another version or repeat an order.');
  const selected = elements.filter(e => ['paragraph', 'list-item', 'code', 'quote', 'table'].includes(e.role) && e.text.trim());
  if (!Number.isSafeInteger(maxCards) || maxCards < 0 || selected.length > maxCards)
    return researchRefuse('TRSH1006', '/maxCards', 'Evidence card limit cannot retain the selected elements.');
  const cards: EvidenceCard[] = [];
  for (const element of selected.sort((a, b) => a.order - b.order)) {
    const value = { literatureId, artifactId, excerpt: element.text, contentHash: version.contentHash,
      versionId: version.id, locator: { ...(element.page === undefined ? {} : { page: element.page }),
        headingPath: element.headingPath, elementOrder: element.order }, fields: [element.role], extractionPromptRevision: promptRevision };
    cards.push(researchValue(validateResearchShape<EvidenceCard>('EvidenceCard', { id: 'card-' + await researchRevisionOf(value), ...value })));
  }
  return { valid: true, value: cards };
}
export function toAdmittedArtifact(card: EvidenceCard): ArtifactRecord {
  const checked = researchValue(validateResearchShape<EvidenceCard>('EvidenceCard', card));
  return { id: checked.id, kind: 'evidence-card', locator: checked.versionId + '#element=' + checked.locator.elementOrder,
    digest: checked.contentHash };
}
/** Resolves immutable elements and retained full-source bytes; chunks are never consulted. */
export async function resolveEvidenceCard(card: EvidenceCard, store: Pick<DocumentCorpusStore, 'getVersion' | 'listElements'>,
  readSource: (artifactId: string) => Promise<Uint8Array>): Promise<ResearchOutcome<EvidenceCard>> {
  const checked = validateResearchShape<EvidenceCard>('EvidenceCard', card); if (!checked.valid) return checked;
  try {
    const pinned = checked.value, version = await store.getVersion(pinned.versionId);
    if (!version || version.contentHash !== pinned.contentHash) return researchRefuse('TRSH1003', '/versionId', 'Evidence version does not resolve.');
    const element = (await store.listElements(version.id)).find(e => e.order === pinned.locator.elementOrder);
    if (!element || element.versionId !== version.id || element.text !== pinned.excerpt || element.page !== pinned.locator.page
      || JSON.stringify(element.headingPath) !== JSON.stringify(pinned.locator.headingPath)) return researchRefuse('TRSH1005', '/locator', 'Excerpt differs from its version locator.');
    const bytes = await readSource(pinned.artifactId);
    if (await researchArtifactIdOf(bytes) !== pinned.artifactId || pinned.artifactId !== 'art-' + pinned.contentHash)
      return researchRefuse('TRSH1002', '/contentHash', 'Retained source bytes do not match the evidence.');
    return { valid: true, value: pinned };
  } catch (cause) { return researchRefuse('TRSH1008', '/artifactId', 'Evidence source could not be read.', cause); }
}
