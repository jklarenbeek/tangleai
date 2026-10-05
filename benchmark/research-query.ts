/** Write or check the exact native-query handoff for research learning and coverage. */
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from './lib/args.ts';
import { createResearchHandoff, RESEARCH_HANDOFF_PATH, RESEARCH_HANDOFF_QUERY_PATH } from './lib/research-handoff.ts';
import { REPORT_PATH } from './lib/research.ts';

const args = parseArgs(process.argv.slice(2), { flags: ['check'] });
const [report, query] = await Promise.all([REPORT_PATH, RESEARCH_HANDOFF_QUERY_PATH].map(async path => JSON.parse(await readFile(path, 'utf8'))));
const artifact = await createResearchHandoff(report, query), text = JSON.stringify(artifact, null, 2) + '\n';
if (args.flags.has('check')) {
  if (await readFile(RESEARCH_HANDOFF_PATH, 'utf8').catch(() => null) !== text) throw Error('Research handoff drift; run npm run benchmark:research:handoff.');
} else await writeFile(RESEARCH_HANDOFF_PATH, text);
console.log(JSON.stringify({ artifactId: artifact.artifactId, reportId: artifact.reportId, rows: artifact.handoff.rows.length }));
