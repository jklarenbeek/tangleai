/** Domain identity covers only closed, credential-free capability data. */
import { equalsJson } from '@jarenjs/core/object';
import type { ResearchDomainProfile, ResearchDomainBindingReference } from '../contracts.gen.ts';
import { immutableResearchJson, researchRevisionOf } from '../identity.ts';
import { researchRefuse, type ResearchOutcome } from '../errors.ts';
import { validateResearchShape } from '../schema.ts';

export function domainBindingReferences(profile: ResearchDomainProfile): Array<Pick<ResearchDomainBindingReference, 'id' | 'kind'>> {
  return [...profile.promptPackIds.map(id => ({ id, kind: 'prompt' as const })),
    ...profile.planValidatorIds.map(id => ({ id, kind: 'plan-validator' as const })),
    { id: profile.evaluatorId, kind: 'evaluator' }, { id: profile.rubricId, kind: 'rubric' },
    { id: profile.exportTemplateId, kind: 'exporter' }];
}

export async function validateDomainProfile(input: unknown): Promise<ResearchOutcome<ResearchDomainProfile>> {
  const checked = validateResearchShape<ResearchDomainProfile>('ResearchDomainProfile', input);
  if (!checked.valid) return { valid: false, issues: checked.issues.map(issue => ({ ...issue, code: 'TRSH2001' })) };
  const profile = checked.value, { revision, ...body } = profile;
  if (revision !== await researchRevisionOf(body)) return researchRefuse('TRSH2001', '/revision', 'The complete domain profile revision does not reproduce.');
  const key = (row: { id: string; kind: string }) => row.kind + ':' + row.id;
  if (!equalsJson(domainBindingReferences(profile).map(key).sort(), profile.bindingRevisions.map(key).sort())
    || new Set(profile.units.map(row => row.metricId)).size !== profile.units.length)
    return researchRefuse('TRSH2001', '/bindingRevisions', 'Every capability needs exactly one revision and every metric exactly one unit and direction.');
  return checked;
}

export async function sealDomainProfile(input: Omit<ResearchDomainProfile, 'revision'>): Promise<ResearchOutcome<ResearchDomainProfile>> {
  try {
    const body = immutableResearchJson(input);
    return validateDomainProfile({ ...body, revision: await researchRevisionOf(body) });
  } catch (cause) { return researchRefuse('TRSH2001', '/profile', 'Domain profiles contain only finite immutable JSON.', cause); }
}
