/** The non-interactive skill-evolution driver. Keyless by default; `--live` ends at a frozen plan. */
import { runTrace2SkillCli } from '../benchmark/lib/trace2skill-cli.ts';

const result = await runTrace2SkillCli(process.argv.slice(2), { write: (line: string) => process.stdout.write(`${line}\n`) });
process.exitCode = result.code;
