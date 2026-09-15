/** The only filesystem prompt build for skill evolution. Installed consumers read immutable JSON. */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TRACE2SKILL_PROMPT_CONTRACTS, TRACE2SKILL_PROMPT_ROLES,
  compileTrace2SkillPack, trace2SkillPromptCatalog,
} from '../packages/trace2skill/src/prompts.ts';
import type { Trace2SkillPromptArtifact, Trace2SkillPromptRole } from '../packages/trace2skill/src/contracts.gen.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SOURCE_DIR = 'prompts/trace2skill';
const ARTIFACT = 'packages/trace2skill/artifacts/prompts.json';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--check') || args.length > 1) throw new Error('usage: trace2skill-artifacts.ts [--check]');

const names = (await readdir(join(ROOT, SOURCE_DIR))).filter(name => name.endsWith('.toml')).sort();
const expected = [...TRACE2SKILL_PROMPT_ROLES].map(role => `${role}.toml`).sort();
if (JSON.stringify(names) !== JSON.stringify(expected))
  throw new Error(`${SOURCE_DIR} holds ${names.join(', ')}; the five addressed roles are ${expected.join(', ')}`);

const prompts: Trace2SkillPromptArtifact[] = [];
for (const role of TRACE2SKILL_PROMPT_ROLES) {
  const file = join(ROOT, SOURCE_DIR, `${role}.toml`);
  const contract = TRACE2SKILL_PROMPT_CONTRACTS[role as Trace2SkillPromptRole];
  const artifact = await compileTrace2SkillPack(await readFile(file, 'utf8'), { ...contract, role });
  if (!artifact.valid) throw new Error(`${SOURCE_DIR}/${role}.toml: ${JSON.stringify(artifact.issues)}`);
  prompts.push(artifact.value);
}

const catalog = await trace2SkillPromptCatalog(prompts);
if (!catalog.valid) throw new Error(JSON.stringify(catalog.issues));

const path = join(ROOT, ARTIFACT);
const bytes = JSON.stringify(catalog.value, null, 2) + '\n';
if (args.includes('--check')) {
  const found = await readFile(path, 'utf8').catch(() => '');
  if (found !== bytes) throw new Error('skill-evolution prompt artifact drift');
}
else await writeFile(path, bytes);
process.stdout.write(`trace2skill: ${prompts.length} JOSL→JTLT artifacts; ${catalog.value.revision}\n`);
