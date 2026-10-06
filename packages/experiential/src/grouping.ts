/** Duplicate removal retains the source relationships that constrain every split. */
import { checkExperientialRecord } from './identity.ts';
import { refuseExperiential, type ExperientialResult } from './errors.ts';
import type { ExperientialExperience, ExperientialAssessment, ExperientialDataset } from './contracts.gen.ts';

export interface ExperientialGrouping {
  experiences: ExperientialExperience[];
  assessments: ExperientialAssessment[];
}

export async function experientialGroups(grouping: ExperientialGrouping, keys: ExperientialDataset['groupKeys'],
  scope: string, policyRevision: string): Promise<ExperientialResult<string[][]>> {
  const ids = new Set<string>();
  for (const e of grouping.experiences) {
    const shape = await checkExperientialRecord('experience', e);
    if (!shape.ok) return shape;
    if (e.scope !== scope || ids.has(e.id)) return refuseExperiential('TEXP1011', '/groupingExperienceIds', 'Grouping contains a foreign or repeated observation.');
    ids.add(e.id);
  }
  const links = new Map<string, Set<string>>();
  for (const a of grouping.assessments) {
    const shape = await checkExperientialRecord('assessment', a);
    if (!shape.ok) return shape;
    if (a.scope !== scope || a.policyRevision !== policyRevision || !ids.has(a.experienceId))
      return refuseExperiential('TEXP1011', '/groupingAssessmentIds', 'Grouping requires the original scoped review.');
    if (a.duplicateOf) {
      if (!ids.has(a.duplicateOf)) return refuseExperiential('TEXP1011', '/duplicateOf', 'A duplicate family has an unresolved observation.');
      const joined = links.get(a.experienceId) ?? new Set<string>(); joined.add(a.duplicateOf); links.set(a.experienceId, joined);
    }
  }
  if (keys.some(key => !ids.has(key.experienceId))) return refuseExperiential('TEXP1011', '/groupKeys', 'Every selected observation needs retained grouping ancestry.');
  const episodes = (e: ExperientialExperience) => e.sourceRefs.filter(ref => ref.kind === 'episode').map(ref => ref.sourceId);
  const connected = (a: ExperientialExperience, b: ExperientialExperience) => a.contentDigest === b.contentDigest
    || episodes(a).some(id => episodes(b).includes(id)) || links.get(a.id)?.has(b.id) || links.get(b.id)?.has(a.id)
    || keys.some(key => key.experienceId === a.id && keys.some(other => other.experienceId === b.id && key.duplicateFamilyId === other.duplicateFamilyId));
  const remaining = new Set(ids), selected = new Set(keys.map(key => key.experienceId)), groups: string[][] = [];
  while (remaining.size) {
    const group = new Set([[...remaining].sort()[0]]); let changed = true;
    while (changed) {
      changed = false;
      const members = grouping.experiences.filter(e => group.has(e.id));
      for (const e of grouping.experiences) if (!group.has(e.id) && members.some(member => connected(e, member))) { group.add(e.id); changed = true; }
    }
    for (const id of group) remaining.delete(id);
    const members = [...group].filter(id => selected.has(id)).sort(); if (members.length) groups.push(members);
  }
  groups.sort((a, b) => a[0].localeCompare(b[0], 'en'));
  return { ok: true, value: groups };
}
