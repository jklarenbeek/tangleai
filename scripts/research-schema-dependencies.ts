/** Inline schema owners only in native declaration documents, never in runtime schemas. */
import { researchSchema, researchSchemaReferences } from '@tangleai/research';
import { runIdentitySchema } from '@tangleai/config';
import { masRuntimeSchema, masWorkflowSchema, masRegistrySchema } from '@tangleai/mas';
import { RESEARCH_LESSONS_SCHEMA } from '../benchmark/lib/research-lessons-schema.ts';

type Schema = Record<string, any>;
function withOwners(input: Schema, owners: ReadonlyArray<readonly [string, Schema]>): Schema {
  const output = structuredClone(input);
  const ownDefs = { ...output.$defs };
  output.$defs = {};
  const replacements: Array<[string, string]> = [];
  for (const [prefix, owner] of owners) {
    const id = owner.$id as string;
    let bytes = JSON.stringify(owner).replaceAll('"#/$defs/', '"#/$defs/' + prefix);
    if (owner.$anchor) bytes = bytes.replaceAll('"#' + owner.$anchor + '"', '"#/$defs/' + prefix + 'Root"');
    const { $id: _id, $anchor: _anchor, $defs = {}, ...root } = JSON.parse(bytes);
    output.$defs[prefix + 'Root'] = root;
    Object.assign(output.$defs, Object.fromEntries(Object.entries($defs).map(([name, schema]) => [prefix + name, schema])));
    replacements.push(['"' + id + '#/$defs/', '"#/$defs/' + prefix], ['"' + id + '"', '"#/$defs/' + prefix + 'Root"']);
  }
  Object.assign(output.$defs, ownDefs);
  let bytes = JSON.stringify(output);
  for (const [from, to] of replacements) bytes = bytes.replaceAll(from, to);
  return JSON.parse(bytes);
}
export function researchDeclarationSchema(input: Schema): Schema {
  return withOwners(input, researchSchemaReferences.map((owner, index) => [`ResearchDependency${index}_`, owner] as const));
}
export function researchReportDeclarationSchema(input: Schema): Schema {
  const owners: Array<readonly [string, Schema]> = [['', researchSchema], ['Config_', runIdentitySchema],
    ['MasRuntime_', masRuntimeSchema], ['MasWorkflow_', masWorkflowSchema], ['MasRegistry_', masRegistrySchema]];
  if (input.$id !== RESEARCH_LESSONS_SCHEMA.$id) owners.push(['Lessons_', RESEARCH_LESSONS_SCHEMA]);
  return researchDeclarationSchema(withOwners(input, owners));
}
