/** Archival retains every record and source address; checked dependencies veto disposal. */
import { deepFreeze, equalsJson } from '@jarenjs/core/object';
import { canonicalizeJson, canonicalSha256 } from '@jarenjs/json/canonical';
import { checkExperientialRecord, sealExperientialRecord } from './identity.ts';
import { validateExperientialShape } from './schema.ts';
import { resolveExperientialLineage } from './lineage.ts';
import { EXPERIENTIAL_TABLE_KINDS, type ExperientialStore, type ExperientialTable, type ExperientialTables } from './store-types.ts';
import { experientialIssue, refuseExperiential, type ExperientialResult } from './errors.ts';
import type { ExperientialRetentionPolicy, ExperientialRetentionDecision, ExperientialExperience, ExperientialDeployment,
  ExperientialArtifact, ExperientialDataset, ExperientialAssessment, ExperientialTrainingRun, ExperientialEvent, ExperientialIssue } from './contracts.gen.ts';

export interface ExperientialRetentionLineage {
  experiences: ExperientialExperience[]; assessments: ExperientialAssessment[]; datasets: ExperientialDataset[];
  trainingRuns: ExperientialTrainingRun[]; events: ExperientialEvent[];
}
export interface ExperientialRetentionInput {
  episodeIds: string[]; deployment: ExperientialDeployment; artifacts: ExperientialArtifact[];
  lineage: ExperientialRetentionLineage; now: number; policy: ExperientialRetentionPolicy;
}
export interface ExperientialRetentionPlan {
  input: ExperientialRetentionInput;
  decisions: ExperientialRetentionDecision[];
  changes: Array<{ before: ExperientialExperience; after: ExperientialExperience }>;
}
export async function sealExperientialRetentionPolicy(input: Omit<ExperientialRetentionPolicy, 'revision'>): Promise<ExperientialResult<ExperientialRetentionPolicy>> {
  const checked = validateExperientialShape<ExperientialRetentionPolicy>('ExperientialRetentionPolicy', { ...input, revision: '0'.repeat(64) });
  if (!checked.ok) return checked;
  const { revision: _, ...body } = checked.value;
  return { ok: true, value: deepFreeze({ ...body, revision: await canonicalSha256(body) }) };
}
class RetentionRefusal extends Error {
  readonly issues: ExperientialIssue[];
  constructor(path: string, detail: string, cause?: ExperientialIssue) { super(detail); this.issues = [experientialIssue('TEXP1012', path, detail, cause)]; }
}
const need = <T>(result: ExperientialResult<T>): T => {
  if (!result.ok) throw new RetentionRefusal('/lineage', 'A retention input could not be verified.', result.issues[0]);
  return result.value;
};

export async function planExperientialRetention(raw: ExperientialRetentionInput): Promise<ExperientialResult<ExperientialRetentionPlan>> {
  let input: ExperientialRetentionInput;
  try { input = JSON.parse(canonicalizeJson(raw)); }
  catch { return refuseExperiential('TEXP1001', '', 'Retention requires finite JSON inputs.'); }
  try {
    if (!input || !equalsJson(Object.keys(input).sort(), ['artifacts', 'deployment', 'episodeIds', 'lineage', 'now', 'policy'])
      || !input.lineage || !equalsJson(Object.keys(input.lineage).sort(), ['assessments', 'datasets', 'events', 'experiences', 'trainingRuns'])
      || !Array.isArray(input.episodeIds) || !input.episodeIds.length || input.episodeIds.length > 4096
      || input.episodeIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 256)
      || new Set(input.episodeIds).size !== input.episodeIds.length)
      return refuseExperiential('TEXP1001', '', 'Retention requires a closed, bounded source census and unique episode identifiers.');
    const checkedPolicy = validateExperientialShape<ExperientialRetentionPolicy>('ExperientialRetentionPolicy', input.policy);
    if (!checkedPolicy.ok) return checkedPolicy;
    const policy = checkedPolicy.value, { revision, ...body } = policy;
    if (await canonicalSha256(body) !== revision) return refuseExperiential('TEXP1002', '/policy/revision', 'Retention policy bytes differ from their revision.');
    if (policy.decision === 'delete') throw new RetentionRefusal('/policy/decision', 'delete-disabled: experiential records and sources are never deleted.');
    if (!Number.isSafeInteger(input.now) || input.now < 0 || !Number.isFinite(new Date(input.now).getTime()))
      throw new RetentionRefusal('/now', 'Retention requires a valid injected millisecond clock.');
    const deployment = need(await checkExperientialRecord('deployment', input.deployment)), scope = deployment.scope;
    const rows = new Map<string, ExperientialTables[ExperientialTable]>();
    const groups: Array<[ExperientialTable, ExperientialTables[ExperientialTable][]]> = [
      ['artifacts', input.artifacts], ['experiences', input.lineage.experiences], ['assessments', input.lineage.assessments],
      ['datasets', input.lineage.datasets], ['training_runs', input.lineage.trainingRuns], ['events', input.lineage.events],
    ];
    for (const [table, values] of groups) {
      if (!Array.isArray(values) || values.length > 4096) throw new RetentionRefusal('/lineage/' + table, 'A complete bounded retained census is required.');
      for (const raw of values) {
        const row = need(await checkExperientialRecord(EXPERIENTIAL_TABLE_KINDS[table], raw));
        if (row.scope !== scope || rows.has(table + '/' + row.id)) throw new RetentionRefusal('/lineage/' + table, 'The retained census contains foreign or repeated records.');
        if (Date.parse(row.recordedAt) > input.now) throw new RetentionRefusal('/now', 'The retention clock precedes retained evidence.');
        rows.set(table + '/' + row.id, row);
      }
      values.sort((a, b) => a.id.localeCompare(b.id, 'en'));
    }
    input.episodeIds.sort();
    for (const id of [deployment.baseArtifactId, deployment.activeArtifactId, deployment.canaryArtifactId])
      if (id && !rows.has('artifacts/' + id)) throw new RetentionRefusal('/deployment/' + id, 'The deployment artifact is absent from the retained census.');
    for (const [id, state] of [[deployment.activeArtifactId, 'active'], [deployment.canaryArtifactId, 'canary']] as const)
      if (id && (rows.get('artifacts/' + id) as ExperientialArtifact).state !== state)
        throw new RetentionRefusal('/deployment/' + id, 'The deployment differs from its retained serving artifact state.');
    const reader: Pick<ExperientialStore, 'get'> = {
      async get<K extends ExperientialTable>(table: K, id: string) {
        return { ok: true, value: (rows.get(table + '/' + id) as ExperientialTables[K] | undefined) ?? null, writes: 0, replayed: true };
      },
    };
    const dependencies = [];
    for (const artifact of [...input.artifacts].sort((a, b) => a.id.localeCompare(b.id, 'en'))) {
      const lineage = need(await resolveExperientialLineage(reader, artifact.id));
      const activations = input.lineage.events.filter(event => event.recordId === artifact.id && ['artifact-activated', 'artifact-rolled-back'].includes(event.kind));
      const activatedAt = activations.length ? Math.max(...activations.map(event => Date.parse(event.recordedAt))) : null;
      const until = activatedAt === null ? null : activatedAt + policy.rollbackWindowMs;
      if (until !== null && (!Number.isSafeInteger(until) || !Number.isFinite(new Date(until).getTime())))
        throw new RetentionRefusal('/policy/rollbackWindowMs', 'The rollback window exceeds timestamp capacity.');
      dependencies.push({ artifact, lineage, until });
    }
    const decisions: ExperientialRetentionDecision[] = [], changes = new Map<string, ExperientialRetentionPlan['changes'][number]>();
    for (const episodeId of [...input.episodeIds].sort()) {
      const experiences = input.lineage.experiences.filter(experience => experience.id === episodeId
        || [experience.taskRef, experience.inputRef, experience.outputRef, ...experience.sourceRefs].some(ref => ref.sourceId === episodeId)
        || input.lineage.datasets.some(dataset => dataset.groupKeys.some(group => group.experienceId === experience.id && group.sourceEpisodeId === episodeId)));
      if (!experiences.length) throw new RetentionRefusal('/episodeIds/' + episodeId, 'The requested episode has no retained experience or source reference.');
      const ids = new Set(experiences.map(experience => experience.id));
      const cited = dependencies.filter(dependency => dependency.lineage.experiences.some(experience => ids.has(experience.id)));
      const active = cited.find(dependency => ['staged', 'evaluating', 'approved', 'canary', 'active'].includes(dependency.artifact.state));
      const rollback = cited.find(dependency => dependency.until !== null && input.now < dependency.until);
      const aliases = new Set([episodeId, ...ids,
        ...experiences.flatMap(experience => [experience.taskRef, experience.inputRef, experience.outputRef, ...experience.sourceRefs].map(ref => ref.sourceId)),
        ...input.lineage.datasets.flatMap(dataset => dataset.groupKeys.filter(group => ids.has(group.experienceId)).map(group => group.sourceEpisodeId))]);
      const held = policy.holds.find(id => aliases.has(id));
      const sole = input.lineage.assessments.find(assessment => ids.has(assessment.experienceId) && assessment.generalizable
        && assessment.inclusion === 'include' && assessment.contradiction === 'none' && assessment.supportingIds.length === 1);
      if (policy.decision === 'archive') {
        if (active) throw new RetentionRefusal('/artifacts/' + active.artifact.id, 'active-lineage: ' + episodeId + ' is required by ' + active.artifact.state + ' artifact ' + active.artifact.id + '.');
        if (rollback) throw new RetentionRefusal('/artifacts/' + rollback.artifact.id, 'rollback-window: ' + episodeId + ' is required until ' + new Date(rollback.until!).toISOString() + '.');
        if (held) throw new RetentionRefusal('/holds/' + held, 'hold: the requested episode has a retained legal or user hold.');
        if (sole) throw new RetentionRefusal('/assessments/' + sole.id, 'sole-provenance: the checked rule has only this supporting episode.');
        for (const experience of experiences) if (experience.state !== 'archived')
          changes.set(experience.id, { before: experience, after: { ...experience, state: 'archived' } });
      }
      const dependency = active ?? rollback ?? cited[0];
      const until = cited.reduce<number | null>((prior, value) => value.until === null ? prior : Math.max(prior ?? 0, value.until), null);
      decisions.push(need(await sealExperientialRecord('retentionDecision', { document: 'experiential-retention-decision', schemaVersion: 1,
        scope, recordedAt: new Date(input.now).toISOString(), episodeIds: [episodeId], dependentArtifactId: dependency?.artifact.id ?? null,
        rollbackUntil: until === null ? null : new Date(until).toISOString(), decision: policy.decision, reason: policy.reason,
        principal: policy.principal, evidence: policy.evidence })));
    }
    return { ok: true, value: deepFreeze({ input, decisions, changes: [...changes.values()].sort((a, b) => a.before.id.localeCompare(b.before.id, 'en')) }) };
  } catch (error) {
    return { ok: false, issues: error instanceof RetentionRefusal ? error.issues : [experientialIssue('TEXP1012', '/lineage', 'The complete retention dependency graph could not be verified.')] };
  }
}
