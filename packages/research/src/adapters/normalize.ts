import type { LiteratureRecord, ResearchLicence, DiscoveryDedupe } from '../contracts.gen.ts';
import { immutableResearchJson, researchRevisionOf } from '../identity.ts';
import { researchValue } from '../workflow-contract.ts';
import { validateResearchShape } from '../schema.ts';

export type ScholarlyProvider = LiteratureRecord['rawHashes'][number]['source'];
export interface ScholarlyMetadata {
  title: string;
  authors: string[];
  date: string;
  canonicalIds: LiteratureRecord['canonicalIds'];
  sourceUrl: string;
  updatedAt?: string;
  categories?: string[];
}
export const normalizeScholarlyText = (text: string): string => text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
export function normalizeDoi(value: string): string {
  const doi = value.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '').toLowerCase();
  if (!/^10\.\d{4,9}\/\S+$/u.test(doi)) throw new TypeError('Invalid DOI.');
  return doi;
}
export function normalizeArxiv(value: string): { arxiv: string; arxivVersion?: number } {
  const match = value.trim().replace(/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\//i, '')
    .replace(/\.pdf$/i, '').match(/^(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v([1-9]\d*))?$/i);
  if (!match) throw new TypeError('Invalid arXiv identifier.');
  return { arxiv: match[1].toLowerCase(), ...(match[2] ? { arxivVersion: Number(match[2]) } : {}) };
}
export function normalizeOpenalex(value: string): string {
  const id = value.trim().replace(/^https?:\/\/openalex\.org\//i, '').toUpperCase();
  if (!/^W\d+$/.test(id)) throw new TypeError('Invalid OpenAlex work identifier.');
  return id;
}
export async function normalizeLiterature(metadata: ScholarlyMetadata, source: ScholarlyProvider,
  rawHash: string, licence: ResearchLicence): Promise<LiteratureRecord> {
  const input = immutableResearchJson(metadata), canonicalIds = { ...input.canonicalIds };
  if (canonicalIds.doi) canonicalIds.doi = normalizeDoi(canonicalIds.doi);
  if (canonicalIds.arxiv) Object.assign(canonicalIds, normalizeArxiv(canonicalIds.arxiv));
  if (canonicalIds.openalex) canonicalIds.openalex = normalizeOpenalex(canonicalIds.openalex);
  const body = { canonicalIds, title: normalizeScholarlyText(input.title),
    authors: [...new Set(input.authors.map(normalizeScholarlyText).filter(Boolean))], date: input.date || 'unknown',
    rawHashes: [{ source, sha256: rawHash }], resolution: input.sourceUrl ? 'resolved' as const : 'unresolved' as const,
    sourcePath: input.sourceUrl || 'unresolved', licence: immutableResearchJson(licence),
    ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}), ...(input.categories ? { categories: [...new Set(input.categories)].sort() } : {}) };
  if (input.sourceUrl) {
    const url = new URL(input.sourceUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TypeError('Invalid source URL.');
  }
  return researchValue(validateResearchShape<LiteratureRecord>('LiteratureRecord', { id: 'lit-' + await researchRevisionOf(body), ...body }));
}
const identityKeys = ['doi', 'arxiv', 'openalex', 's2'] as const;
const metadataKey = (row: LiteratureRecord) => JSON.stringify([normalizeScholarlyText(row.title).toLowerCase(),
  row.authors.map(a => normalizeScholarlyText(a).toLowerCase()).sort(), row.date]);
const conflicts = (a: LiteratureRecord, b: LiteratureRecord) => identityKeys.some(key =>
  a.canonicalIds[key] && b.canonicalIds[key] && a.canonicalIds[key] !== b.canonicalIds[key]);
const shared = (a: LiteratureRecord, b: LiteratureRecord) => identityKeys.some(key =>
  a.canonicalIds[key] && a.canonicalIds[key] === b.canonicalIds[key]);

/** Identity first. Metadata cannot override contradictory canonical identifiers. */
export async function dedupeLiterature(input: readonly LiteratureRecord[]): Promise<{ records: LiteratureRecord[]; dedupe: DiscoveryDedupe }> {
  const ordered = immutableResearchJson(input).slice().sort((a, b) => a.id.localeCompare(b.id));
  const components: LiteratureRecord[][] = [], dedupe: DiscoveryDedupe = { identityMerges: 0, fallbackMerges: [], distinctPreserved: 0 };
  for (const row of ordered) {
    const matching = components.filter(group => group.some(other => shared(row, other)));
    if (matching.length) {
      for (const group of matching.slice(1)) { matching[0].push(...group); components.splice(components.indexOf(group), 1); }
      matching[0].push(row);
    } else components.push([row]);
  }
  // Inspect the entire identity component before merging. A later contradictory
  // identifier must not assign an ambiguous bridge to whichever row sorted first.
  const identities = components.flatMap(group => {
    if (group.some((a, i) => group.slice(i + 1).some(b => conflicts(a, b)))) return group.map(row => [row]);
    dedupe.identityMerges += group.length - 1; return [group];
  }).sort((a, b) => a[0].id.localeCompare(b[0].id));
  const groups: LiteratureRecord[][] = [];
  const hasId = (record: LiteratureRecord) => identityKeys.some(key => record.canonicalIds[key]);
  for (const identity of identities) {
    const row = identity[0];
    const candidates = groups.filter(group => group.some(other => identity.some(r => metadataKey(other) === metadataKey(r))));
    // An unidentified row matching several canonically distinct works stays unresolved.
    const futureMatches = identities.filter(group => group.some(other =>
      identity.some(r => metadataKey(other) === metadataKey(r))) && group.some(hasId));
    const fallback = candidates.length === 1 && futureMatches.length <= 1 && candidates[0].every(other => identity.every(r => !conflicts(r, other)
      && !(hasId(r) && hasId(other)))) ? candidates[0] : undefined;
    for (const group of candidates) {
      dedupe.fallbackMerges.push({ left: group[0].id, right: row.id, status: group === fallback ? 'merged' : 'refused' });
      if (group !== fallback) dedupe.distinctPreserved++;
    }
    if (fallback) fallback.push(...identity); else groups.push([...identity]);
  }
  const records: LiteratureRecord[] = [];
  for (const group of groups) {
    const preferred = group.slice().sort((a, b) => {
      const rank = (r: LiteratureRecord) => ['openalex', 'crossref', 'semanticscholar', 'arxiv'].indexOf(r.rawHashes[0].source);
      return rank(a) - rank(b) || a.id.localeCompare(b.id);
    });
    const { id: _id, ...body } = preferred[0];
    const canonicalIds = Object.assign({}, ...group.map(row => row.canonicalIds));
    const versions = group.flatMap(r => r.canonicalIds.arxivVersion ? [r.canonicalIds.arxivVersion] : []);
    if (versions.length) canonicalIds.arxivVersion = Math.max(...versions);
    const rawHashes = [...new Map(group.flatMap(r => r.rawHashes).map(h => [h.source + ':' + h.sha256, h])).values()]
      .sort((a, b) => a.source.localeCompare(b.source) || a.sha256.localeCompare(b.sha256));
    const updates = group.flatMap(r => r.updatedAt ? [r.updatedAt] : []).sort();
    const categories = [...new Set(group.flatMap(r => r.categories ?? []))].sort();
    const value = { ...body, canonicalIds, rawHashes, ...(updates.length ? { updatedAt: updates.at(-1)! } : {}),
      ...(categories.length ? { categories } : {}) };
    records.push(researchValue(validateResearchShape<LiteratureRecord>('LiteratureRecord', { id: 'lit-' + await researchRevisionOf(value), ...value })));
  }
  return immutableResearchJson({ records: records.sort((a, b) => a.id.localeCompare(b.id)), dedupe });
}
