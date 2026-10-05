/** Compile the domain context pack and immutable profile through their native owners. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { compileGmplPromptPack } from '@tangleai/gmpl';
import { researchArtifacts, researchValue } from '@tangleai/research';
import { tabularDomainProfile } from '../packages/research/src/domains/tabular-definition.ts';

const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => arg !== '--check')) throw Error('Usage: research-domain-artifacts.ts [--check]');
const compiled = await compileGmplPromptPack(await readFile('prompts/research/domains/tabular-context.toml', 'utf8'), {
  variables: { comparison: { schema: { type: 'string', minLength: 1, maxLength: 4096 }, render: 'text' } },
  outputSchema: { type: 'object', properties: { constraints: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, maxItems: 8 } },
    required: ['constraints'], additionalProperties: false },
});
if (!compiled.valid) throw Error(JSON.stringify(compiled.issues));
const profile = researchValue(await tabularDomainProfile([...researchArtifacts.prompts.filter(row => row.id.startsWith('research-')), compiled.value]));
await mkdir('packages/research/artifacts', { recursive: true });
for (const [path, value] of [
  ['packages/research/artifacts/tabular-context.json', compiled.value],
  ['packages/research/artifacts/tabular-statistics.profile.json', profile],
] as const) {
  const bytes = JSON.stringify(value, null, 2) + '\n';
  if (args.includes('--check')) { if (await readFile(path, 'utf8') !== bytes) throw Error('Research domain artifact drift: ' + path); }
  else await writeFile(path, bytes);
}
