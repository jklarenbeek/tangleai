/**
 * The skill-evolution instrument. Keyless, clock-free, reproducible:
 * no environment file is loaded, no provider client is constructed, and
 * the network is trapped before the first byte of the fixture is read.
 *
 * `--live` reaches a frozen, credential-free plan and stops there. It reads
 * the ambient environment to say what an authorized run WOULD cost and to
 * judge an `--authorize` argument; it never makes a request, and it refuses
 * to overwrite the committed registration with a key-derived one, because a
 * committed artifact may not depend on a developer's credentials. The
 * registration itself is written by the ordinary keyless run beside the
 * report.
 *
 *   node benchmark/trace2skill.ts [--check] [--out-dir DIR] [--json PATH]
 *                                 [--md PATH] [--live-json PATH]
 *                                 [--require CAPABILITY]
 *                                 [--live [--authorize PLAN-ID]]
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from './lib/args.ts';
import {
  buildTrace2SkillReport, renderDocument, renderReport, requireCapability,
  DOCUMENT_PATH, REPORT_PATH,
} from './lib/trace2skill-report.ts';
import { loadTrace2SkillFixture, ROOT } from './lib/trace2skill-fixture.ts';
import {
  buildTrace2SkillLiveRecord, describeLivePlan, liveAuthorizationOf, renderLiveRecord, LIVE_RECORD_PATH,
} from './lib/trace2skill-live.ts';
import { readAiEnv } from './lib/ai-env.ts';

const argv = process.argv.slice(2);
for (const flag of ['check', 'live']) {
  if (argv.some((arg) => arg.startsWith(`--${flag}=`))) throw new Error(`--${flag} takes no value`);
}
const args = parseArgs(argv, {
  flags: ['check', 'live'],
  values: ['out-dir', 'json', 'md', 'live-json', 'require', 'authorize'],
});
if (args.rest.length > 0) throw new Error('unexpected skill-evolution positional arguments');
for (const value of args.values.values()) {
  if (value.startsWith('--') || value.includes('=')) throw new Error('malformed skill-evolution option');
}
if (args.values.has('authorize') && !args.flags.has('live')) {
  throw new Error('--authorize names a live plan and means nothing without --live');
}

let requests = 0;
globalThis.fetch = (async () => {
  requests++;
  throw new Error('the skill-evolution instrument must not make a network call');
}) as typeof fetch;

const report = await buildTrace2SkillReport();
requireCapability(report, args.values.get('require') ?? 'instrument');
const loaded = await loadTrace2SkillFixture({ root: ROOT });

const dir = args.values.get('out-dir');
const at = (name: string, option: string, fallback: string): string =>
  args.values.get(option) ?? (dir === undefined ? fallback : join(dir, name));
const livePath = at('trace2skill-live.json', 'live-json', LIVE_RECORD_PATH);

// The committed registration is the one an empty environment produces, so the
// bytes a clone checks are the bytes any machine renders.
const frozen = await buildTrace2SkillLiveRecord({ loaded, report });
const artifacts: Array<[string, string]> = [
  [at('trace2skill.json', 'json', REPORT_PATH), renderReport(report)],
  [at('TRACE2SKILL_BENCHMARK.md', 'md', DOCUMENT_PATH), renderDocument(report)],
  [livePath, renderLiveRecord(frozen)],
];
for (const [path, bytes] of artifacts) {
  if (args.flags.has('check')) {
    if (await readFile(path, 'utf8') !== bytes) throw new Error(`skill-evolution artifact drift: ${path}`);
  } else {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
}

if (args.flags.has('live')) {
  const env = readAiEnv(process.env);
  if (!env.live) {
    process.stdout.write(`live skipped: ${String(env.reason)}\nnothing was spent and no request was made\n`);
  } else {
    const record = await buildTrace2SkillLiveRecord({ loaded, report, env });
    const decision = liveAuthorizationOf(record.plan, args.values.get('authorize'));
    process.stdout.write(`${describeLivePlan(record).join('\n')}\n`);
    // A mismatched approval is a failure, not a notice: a script that read it
    // as accepted would be one flag away from a spend nobody approved.
    if (decision === 'refused') process.exitCode = 1;
    process.stdout.write(decision === 'refused'
      ? `--authorize names ${String(args.values.get('authorize'))}, which is not this plan\n`
      : decision === 'dry-run'
        ? 'no approval: rerun with --authorize <plan-id> once a live run is separately approved\n'
        : decision === 'skipped'
          ? 'the plan exceeds its configured ceiling; nothing was planned to run\n'
          : 'this build has no authorized live tier: the approval is recognized and there is nothing behind it\n');
    if (record.recordId !== frozen.recordId && args.values.get('live-json') === undefined && dir === undefined) {
      process.stdout.write(`the committed registration at ${LIVE_RECORD_PATH} describes an unconfigured environment and was not overwritten\n`);
    } else if (!args.flags.has('check')) {
      await writeFile(livePath, renderLiveRecord(record));
    }
    process.stdout.write('nothing was spent and no request was made\n');
  }
}

const rows = [...report.tables.deepening, ...report.tables.creation];
const count = (status: string): number => rows.filter((row) => row.status === status).length;
process.stdout.write(
  `skill evolution ${report.reportId}: oracle ${report.oracle.ceiling.toFixed(3)}, `
  + `seeded ${report.oracle.randomScore.toFixed(3)} in [${report.oracle.band.low.toFixed(3)}, ${report.oracle.band.high.toFixed(3)}], `
  + `${count('run')}/${rows.length} rows run, ${count('not-run')} not run, ${count('implementation-missing')} unbuilt, `
  + `live ${frozen.plan.planId.slice(0, 12)} not-run, ${requests} provider request(s)\n`,
);
