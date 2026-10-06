/** Read validation never executes an experiment or substitutes freshly computed scores. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { validateResearchReportShape } from '../../../benchmark/lib/research-validation.ts';
import { researchSource } from '../../../benchmark/lib/research-source.ts';
import type { ResearchReport } from '../../../benchmark/lib/research.types.ts';
import { ASSETS } from './assets.gen.ts';

export interface ResearchReportInput { bytes: string; sourceFiles: ResearchReport['source']['files']; expectedReportId: string }
export type ResearchReportReader = () => Promise<ResearchReportInput>;
export type ResearchReportRead = { ok: true; report: ResearchReport } | {
  ok: false; failures: 1; issues: Array<{ code: string; path: string; detail: string }>;
};

export async function readResearchReport(read: ResearchReportReader): Promise<ResearchReportRead> {
  try {
    const { bytes, sourceFiles, expectedReportId } = await read(), value: unknown = JSON.parse(bytes);
    if (!validateResearchReportShape(value).valid) throw new Error('The committed report failed its schema and arithmetic checks.');
    const report = value as ResearchReport, { reportId, ...payload } = report;
    if (reportId !== await canonicalSha256(payload)) throw new Error('The report bytes differ from their content identity.');
    if (reportId !== expectedReportId) throw new Error('The report differs from the host\'s committed or independently qualified artifact.');
    if (report.source.sha256 !== await canonicalSha256({ head: report.source.head, files: report.source.files }))
      throw new Error('The source receipt has an invalid identity.');
    if (canonicalizeJson(report.source.files) !== canonicalizeJson(sourceFiles)) throw new Error('The committed report has stale source inputs.');
    return { ok: true, report };
  } catch (cause) {
    return { ok: false, failures: 1, issues: [{ code: 'research-report-invalid', path: '/benchmark/results/research.json',
      detail: cause instanceof Error ? cause.message : 'The committed report could not be read.' }] };
  }
}

/** The compiler binds embedded bytes to its current source inventory before building. */
export const desktopResearchReport: ResearchReportReader = async () => {
  if (ASSETS['research-report.json'] !== undefined) return { bytes: ASSETS['research-report.json'], ...JSON.parse(ASSETS['research-source.json']!) };
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const [bytes, source, committed] = await Promise.all([readFile(new URL('../../../benchmark/results/research.json', import.meta.url), 'utf8'), researchSource(root),
    promisify(execFile)('git', ['show', 'HEAD:benchmark/results/research.json'], { cwd: root, maxBuffer: 64 * 1024 * 1024 })]);
  return { bytes, sourceFiles: source.files, expectedReportId: JSON.parse(committed.stdout).reportId };
};
