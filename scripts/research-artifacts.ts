/** Compile authored research packs and explicit native protocol bridges once. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { stringifyToml } from '@jarenjs/josl';
import { compileGmplPromptPack, createGmplCatalog, createGmplRecipe, gmplArtifacts, gmplCatalogDocument,
  gmplSchemaOf, GMPL_STAGES, type GmplPromptArtifact, type GmplVariables } from '@tangleai/gmpl';
import { RESEARCH_PROMPT_NAMES, RESEARCH_PROMPT_VARIABLES, RESEARCH_NATIVE_PROMPTS, researchProposalSchema,
  defineResearchDomainBinding, type ResearchPromptName } from '../packages/research/src/prompt-contracts.ts';
import { researchPromptFiles } from './research-sources.ts';

const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => arg !== '--check')) throw Error('usage: research-artifacts.ts [--check]');
const value = <T>(result: { valid: true; value: T } | { valid: false; issues: unknown[] }): T => {
  if (!result.valid) throw Error(JSON.stringify(result.issues)); return result.value;
};
const files = await researchPromptFiles();
if (JSON.stringify(files) !== JSON.stringify(RESEARCH_PROMPT_NAMES.map(name => `prompts/research/${name}.toml`).sort()))
  throw Error('Research prompt inventory differs from its seven declared packs.');
const base: GmplPromptArtifact[] = [];
for (const file of files) {
  const name = file.split('/').at(-1)!.slice(0, -5) as ResearchPromptName;
  base.push(value(await compileGmplPromptPack(await readFile(file, 'utf8'), { variables: RESEARCH_PROMPT_VARIABLES, outputSchema: researchProposalSchema(name) })));
}
const variables: GmplVariables = { query: { schema: { type: 'string', minLength: 1 }, render: 'text' },
  evidence: { schema: { type: 'array', items: gmplSchemaOf('gmplEvidenceUnit') }, render: 'json' },
  context: { schema: { type: 'object' }, render: 'json' } };
const derived: GmplPromptArtifact[] = [];
for (const [name, stage] of RESEARCH_NATIVE_PROMPTS) {
  const original = base.find(prompt => prompt.id === 'research-' + name)!;
  const pack = structuredClone(original.pack);
  pack.meta.id += '-' + stage; pack.meta.role = pack.meta.id;
  pack.meta.pattern = stage.startsWith('debate-') ? 'structured-debate' : 'parallel-analysis';
  pack.system.content += '\nNative protocol: return the declared GMPL envelope. result.answer is JSON matching the research proposal schema below. '
    + 'Every research evidence id must also occur in result.claims citations with its visible digest. Preserve supported findings and their provenance. '
    + 'Research data are in context.domain; the synthesis and constraint blocks render that complete context. '
    + (stage === 'debate-position' ? 'Provide a stance. ' : stage === 'debate-rebuttal' ? 'Address delivered claim or finding ids. '
      : stage === 'debate-judge' ? 'Provide accept, reject, continue or escalate; confidence and novelty never decide acceptance. ' : '')
    + '\nProposal schema: ' + JSON.stringify(original.outputSchema, null, 2);
  const names = { question: 'query', cards: 'evidence', synthesis: 'context', constraints: 'context' };
  pack.user.content = pack.user.content.replace(/\{\{(#if )?(question|cards|synthesis|constraints)\}\}/g,
    (_match, conditional: string | undefined, name: keyof typeof names) => '{{' + (conditional ?? '') + names[name] + '}}');
  derived.push(value(await compileGmplPromptPack(stringifyToml(pack), { variables, outputSchema: gmplSchemaOf(stage) })));
}
const prompts = [...gmplArtifacts.prompts, ...base, ...derived];
const domains = await Promise.all((['synthesis', 'hypothesis'] as const).map(async purpose => value(await defineResearchDomainBinding(purpose, prompts))));
const recipes = [
  value(await createGmplRecipe({ id: 'research-synthesis', parameters: { pattern: 'parallel-analysis', participants: 3 }, scope: 'pattern', stages: [...GMPL_STAGES['parallel-analysis']] })),
  value(await createGmplRecipe({ id: 'research-debate', parameters: { pattern: 'structured-debate', participants: 3, maxRounds: 3 }, scope: 'pattern', stages: [...GMPL_STAGES['structured-debate']] })),
];
const document = await gmplCatalogDocument({ id: 'research-prompts', prompts, domains, recipes });
value(await createGmplCatalog(document));
const path = 'packages/research/artifacts/catalog.json', bytes = JSON.stringify(document, null, 2) + '\n';
if (args.includes('--check')) { if (await readFile(path, 'utf8') !== bytes) throw Error('Research artifact drift'); }
else { await mkdir('packages/research/artifacts', { recursive: true }); await writeFile(path, bytes); }
console.log(`Research: ${base.length} source packs, ${derived.length} native bindings; ${document.revision}`);
