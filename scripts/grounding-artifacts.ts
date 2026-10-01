/** Filesystem compilation only; installed runtime consumes the immutable artifact catalog. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { compileGmplPromptPack, gmplSchemaOf, gmplCatalogDocument, createGmplCatalog,
    type GmplPromptArtifact, type GmplVariables } from '@tangleai/gmpl';
import { TRIAGE_SCHEMA, CLARIFICATION_QUESTION_SCHEMA, QUERY_PLAN_SCHEMA, RESOLUTION_SCHEMA } from '../packages/grounding/src/schemas/optimizer.ts';
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--check') || args.length > 1) throw Error('usage: grounding-artifacts.ts [--check]');
const variables: GmplVariables = { query: { schema: { type: 'string', minLength: 1 }, render: 'text' },
    evidence: { schema: { type: 'array', items: gmplSchemaOf('gmplEvidenceUnit') }, render: 'json' },
    context: { schema: { type: 'object' }, render: 'json' } };
const prompts: GmplPromptArtifact[] = [];
for (const [name, outputSchema] of [['triage', TRIAGE_SCHEMA], ['question', CLARIFICATION_QUESTION_SCHEMA],
    ['resolve', RESOLUTION_SCHEMA], ['plan', QUERY_PLAN_SCHEMA]] as const) {
    const artifact = await compileGmplPromptPack(await readFile(`prompts/grounding/${name}.toml`, 'utf8'), { variables, outputSchema });
    if (!artifact.valid) throw Error(JSON.stringify(artifact.issues)); prompts.push(artifact.value);
}
const document = await gmplCatalogDocument({ id: 'grounding-optimizer', prompts, domains: [], recipes: [] });
const checked = await createGmplCatalog(document); if (!checked.valid) throw Error(JSON.stringify(checked.issues));
const path = 'packages/grounding/artifacts/catalog.json', bytes = JSON.stringify(document, null, 2) + '\n';
if (args.includes('--check')) { if (await readFile(path, 'utf8') !== bytes) throw Error('Grounding artifact drift'); }
else { await mkdir('packages/grounding/artifacts', { recursive: true }); await writeFile(path, bytes); }
console.log(`Grounding: ${prompts.length} JOSL→JTLT artifacts; ${document.revision}`);
