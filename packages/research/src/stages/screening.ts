import type { InclusionCriteria, LiteratureRecord, ScreeningDecision } from '../contracts.gen.ts';
import { immutableResearchJson, researchRevisionOf } from '../identity.ts';
import { normalizeScholarlyText } from '../adapters/normalize.ts';
import { validateResearchShape } from '../schema.ts';
import { researchValue } from '../workflow-contract.ts';
import { isDateOnlyRFC3339 } from '@jarenjs/core/dates';

export async function createInclusionCriteria(input: Omit<InclusionCriteria, 'id' | 'revision'>): Promise<InclusionCriteria> {
  const body = immutableResearchJson(input), revision = await researchRevisionOf(body);
  if ([body.dateFrom, body.dateTo].some(date => date !== null && !isDateOnlyRFC3339(date))
    || body.dateFrom && body.dateTo && body.dateFrom > body.dateTo) throw new TypeError('Invalid screening date range.');
  return researchValue(validateResearchShape<InclusionCriteria>('InclusionCriteria', { ...body, id: 'criteria-' + revision, revision }));
}
/** Metadata-only rule reviewer. Relevance labels and claim support are not inputs. */
export async function screenLiterature(projectId: string, criteria: InclusionCriteria, records: readonly LiteratureRecord[]): Promise<ScreeningDecision[]> {
  const pinned = immutableResearchJson(criteria), rows = immutableResearchJson(records), { id, revision, ...body } = pinned;
  if (revision !== await researchRevisionOf(body) || id !== 'criteria-' + revision) throw new TypeError('Screening criteria identity mismatch.');
  const decisions: ScreeningDecision[] = [];
  for (const row of rows) {
    const title = normalizeScholarlyText(row.title).toLowerCase();
    let decision: ScreeningDecision['decision'] = 'keep', reason = 'Title terms, supplied date and source metadata meet the frozen criteria; support is not asserted.';
    if (!pinned.titleTerms.every(term => title.includes(normalizeScholarlyText(term).toLowerCase()))) {
      decision = 'exclude'; reason = 'Title does not contain every required term.';
    } else if (pinned.requireSource && row.resolution !== 'resolved') {
      decision = 'unresolved'; reason = 'Required source URL is unresolved.';
    } else if ((pinned.dateFrom || pinned.dateTo) && !isDateOnlyRFC3339(row.date)) {
      decision = 'unresolved'; reason = 'Date bounds require a complete supplied publication date.';
    } else if (pinned.dateFrom && row.date < pinned.dateFrom || pinned.dateTo && row.date > pinned.dateTo) {
      decision = 'exclude'; reason = 'Supplied publication date falls outside the frozen range.';
    }
    const value = { projectId, literatureId: row.id, decision, reason, screenerRevision: revision, criteriaId: id, reviewer: pinned.reviewer };
    decisions.push(researchValue(validateResearchShape<ScreeningDecision>('ScreeningDecision', { ...value, id: 'screen-' + await researchRevisionOf(value) })));
  }
  return decisions;
}
