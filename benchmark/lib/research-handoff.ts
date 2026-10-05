/** A native query projection binds a validated report; it grants no new quality claim. */
import { compileJsonQuery } from '@jarenjs/json/query';
import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { immutableResearchJson, RESEARCH_RECORD_KINDS } from '@tangleai/research';
import { validateResearchReportShape, requireResearchShape } from './research-validation.ts';
import { RESEARCH_ROW_IDS } from './research-schema.ts';
import type { ResearchReport, ResearchHandoff } from './research.types.ts';

export const RESEARCH_HANDOFF_QUERY_PATH = 'queries/research/core-baseline.json';
export const RESEARCH_HANDOFF_PATH = 'benchmark/results/research-handoff.json';
export async function createResearchHandoff(reportInput: ResearchReport, queryInput: Record<string, unknown>): Promise<ResearchHandoff> {
  const report = immutableResearchJson(reportInput), document = immutableResearchJson(queryInput);
  if (!validateResearchReportShape(report).valid) throw Error('The research report does not validate.');
  const { reportId, ...payload } = report;
  if (reportId !== await canonicalSha256(payload) || report.decision !== 'conformant'
    || canonicalizeJson(report.recordNames) !== canonicalizeJson(RESEARCH_RECORD_KINDS)
    || report.rows.some(row => row.state !== 'measured'))
    throw Error('A research handoff requires the complete measured report and current public record names.');
  const { $comment: _comment, ...query } = document;
  const handoff = compileJsonQuery(query)(report) as ResearchHandoff['handoff'];
  const body = { benchmark: 'research-handoff' as const, query: RESEARCH_HANDOFF_QUERY_PATH,
    queryRevision: await canonicalSha256(query), reportId, handoff };
  const artifact = requireResearchShape<ResearchHandoff>('ResearchHandoff', { ...body, artifactId: await canonicalSha256(body) });
  if (artifact.handoff.reportId !== reportId || artifact.handoff.fixture.revision !== report.registration.revision
    || canonicalizeJson(artifact.handoff.fixture.topics) !== canonicalizeJson(report.registration.topics)
    || canonicalizeJson(artifact.handoff.rows.map(row => row.id)) !== canonicalizeJson(RESEARCH_ROW_IDS)
    || canonicalizeJson(artifact.handoff.recordNames) !== canonicalizeJson(report.recordNames)
    || canonicalizeJson(artifact.handoff.limitations) !== canonicalizeJson(report.limitations))
    throw Error('The handoff cannot omit or substitute the report, fixture, rows, record names or limits.');
  for (const row of artifact.handoff.rows) {
    const measured = report.rows.find(value => value.id === row.id)!;
    if (measured.state !== 'measured' || row.scope !== measured.scope
      || canonicalizeJson(row.cost) !== canonicalizeJson(measured.cost) || canonicalizeJson(row.interventions) !== canonicalizeJson(measured.interventions))
      throw Error('Every handoff row must retain the exact measured scope, cost and interventions.');
  }
  const modes = report.rows.flatMap(row => row.state === 'measured' && row.scope === 'writing' && row.id !== 'single-pass-retrieve-draft'
    ? [{ id: row.id, experimental: row.experimental, interventions: row.interventionReport }] : []);
  if (canonicalizeJson(artifact.handoff.modes) !== canonicalizeJson(modes)) throw Error('Mode disclosure must reproduce the measured interventions.');
  return artifact;
}
