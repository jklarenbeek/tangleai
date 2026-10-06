/** Resolve retained ancestry; external references remain explicitly unverified bytes. */
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { experientialIssue, type ExperientialResult } from './errors.ts';
import type { ExperientialStore, ExperientialTable, ExperientialTables } from './store-types.ts';
import type { ExperientialArtifact, ExperientialTrainingRun, ExperientialDataset, ExperientialAssessment, ExperientialExperience, ExperientialRef, ExperientialIssue } from './contracts.gen.ts';

export interface ExperientialLineage {
  artifact: ExperientialArtifact;
  artifacts: ExperientialArtifact[];
  trainingRuns: ExperientialTrainingRun[];
  datasets: ExperientialDataset[];
  assessments: ExperientialAssessment[];
  experiences: ExperientialExperience[];
  sourceRefs: ExperientialRef[];
  producingIdentityIds: string[];
  externalBytes: 'not-resolved';
}
class MissingLink extends Error {
  readonly issue: ExperientialIssue;
  constructor(path: string, detail: string, cause?: ExperientialIssue) { super(detail); this.issue = experientialIssue('TEXP1004', path, detail, cause); }
}

export async function resolveExperientialLineage(store: Pick<ExperientialStore, 'get'>, artifactId: string): Promise<ExperientialResult<ExperientialLineage>> {
  const artifacts = new Map<string, ExperientialArtifact>(), runs = new Map<string, ExperientialTrainingRun>(), datasets = new Map<string, ExperientialDataset>();
  const assessments = new Map<string, ExperientialAssessment>(), experiences = new Map<string, ExperientialExperience>();
  const sources = new Map<string, ExperientialRef>(), identities = new Set<string>(), visiting = new Set<string>();
  let scope: string | undefined;
  async function read<K extends ExperientialTable>(table: K, id: string): Promise<ExperientialTables[K]> {
    const path = '/' + table + '/' + id, result = await store.get(table, id);
    if (!result.ok) throw new MissingLink(path, 'The retained lineage reference could not be verified.', result.issues[0]);
    if (!result.value) throw new MissingLink(path, 'The lineage reference is missing.');
    if (scope !== undefined && result.value.scope !== scope) throw new MissingLink(path, 'The lineage reference crosses scope.');
    return result.value;
  }
  async function experience(id: string): Promise<ExperientialExperience> {
    const prior = experiences.get(id); if (prior) return prior;
    const row = await read('experiences', id); experiences.set(id, row); identities.add(row.producingIdentityId);
    for (const ref of [row.taskRef, row.inputRef, row.outputRef, ...row.sourceRefs]) {
      if (!ref.sourceId || !/^[a-f0-9]{64}$/.test(ref.digest)) throw new MissingLink('/experiences/' + id + '/sourceRefs', 'Every source requires its qualified reference and digest.');
      sources.set(canonicalizeJson(ref), ref);
    }
    if (row.observedOutcome) {
      const ref = { sourceId: row.observedOutcome.sourceId, digest: row.observedOutcome.digest, kind: row.observedOutcome.kind };
      sources.set(canonicalizeJson(ref), ref);
    }
    return row;
  }
  async function artifact(id: string): Promise<ExperientialArtifact> {
    if (visiting.has(id)) throw new MissingLink('/artifacts/' + id, 'Artifact ancestry contains a cycle.');
    const previous = artifacts.get(id); if (previous) return previous;
    const row = await read('artifacts', id); scope ??= row.scope; visiting.add(id); artifacts.set(id, row);
    if (row.kind === 'base') {
      if (row.trainingRunId || row.baseArtifactId || row.method) throw new MissingLink('/artifacts/' + id, 'A registered base has unexpected training ancestry.');
    } else {
      if (!row.trainingRunId || !row.baseArtifactId) throw new MissingLink('/artifacts/' + id + '/trainingRunId', 'A learned artifact has no complete training ancestry.');
      const run = await read('training_runs', row.trainingRunId); runs.set(run.id, run);
      if (run.state !== 'complete' || run.baseArtifactId !== row.baseArtifactId || run.method !== row.method)
        throw new MissingLink('/training_runs/' + run.id, 'The training result does not bind the learned artifact.');
      const dataset = await read('datasets', run.datasetId); datasets.set(dataset.id, dataset);
      const covered = new Set<string>();
      for (const assessmentId of dataset.assessmentIds) {
        const assessment = await read('assessments', assessmentId); assessments.set(assessment.id, assessment);
        if (!dataset.selectedIds.includes(assessment.experienceId) || covered.has(assessment.experienceId)) throw new MissingLink('/datasets/' + dataset.id + '/assessmentIds', 'Pinned assessments do not cover the selected experiences exactly.');
        covered.add(assessment.experienceId);
        const observed = await experience(assessment.experienceId);
        const ownSupport = new Set([observed.id, observed.contentDigest, ...observed.sourceRefs.map(ref => ref.digest),
          observed.taskRef.digest, observed.inputRef.digest, observed.outputRef.digest, ...(observed.observedOutcome ? [observed.observedOutcome.digest] : []),
          ...(dataset.selection?.trustView.sources.filter(source => source.outcome?.contentDigest === observed.contentDigest).map(source => source.digest) ?? [])]);
        for (const support of assessment.supportingIds) if (!ownSupport.has(support)) await experience(support);
      }
      if (covered.size !== dataset.selectedIds.length) throw new MissingLink('/datasets/' + dataset.id + '/assessmentIds', 'A selected experience has no pinned assessment.');
      for (const selected of dataset.selectedIds) await experience(selected);
      for (const id of dataset.groupingExperienceIds ?? []) await experience(id);
      for (const id of dataset.groupingAssessmentIds ?? []) {
        const assessment = await read('assessments', id); assessments.set(id, assessment);
        await experience(assessment.experienceId);
        if (assessment.duplicateOf) await experience(assessment.duplicateOf);
      }
      for (const source of dataset.selection?.trustView.sources ?? []) {
        const ref = { sourceId: source.sourceId, digest: source.digest, kind: source.kind };
        sources.set(canonicalizeJson(ref), ref);
      }
      await artifact(row.baseArtifactId);
    }
    visiting.delete(id); return row;
  }
  try {
    const root = await artifact(artifactId), rows = <T extends { id: string }>(map: Map<string, T>) => [...map.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return { ok: true, value: { artifact: root, artifacts: rows(artifacts), trainingRuns: rows(runs), datasets: rows(datasets),
      assessments: rows(assessments), experiences: rows(experiences), sourceRefs: [...sources.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, ref]) => ref),
      producingIdentityIds: [...identities].sort(), externalBytes: 'not-resolved' } };
  } catch (error) {
    return { ok: false, issues: [error instanceof MissingLink ? error.issue : experientialIssue('TEXP1004', '/artifacts/' + artifactId, 'The lineage could not be read from persistence.')] };
  }
}
