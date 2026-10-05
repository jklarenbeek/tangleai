/** Count control-plane invariants and pre-spend binding refusals against actual capabilities. */
import { glob, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bindDomainProfile, researchRevisionOf, type BoundDomainProfile } from '@tangleai/research';
import { researchBytesSha256 } from './research-fixture.ts';

export async function researchControlPlaneParity(root = process.cwd(), ids = ['computational', 'tabular-statistics']) {
  const sources = [], text: string[] = [];
  for await (const path of glob('packages/research/src/{stages,control}/**/*.ts', { cwd: root })) {
    const content = await readFile(join(root, path)); sources.push({ path, sha256: researchBytesSha256(content) }); text.push(content.toString('utf8'));
  }
  sources.sort((a, b) => a.path.localeCompare(b.path));
  if (!sources.length) throw Error('The control-plane source inventory is empty.');
  const content = text.join('\n');
  const profileLiterals = ids.reduce((count, id) => count + content.split(id).length - 1, 0);
  const domainComparisons = [...content.matchAll(/\bdomain\s*(?:===|==|!==|!=)/g)].length;
  return { id: 'control-plane-parity' as const, sources, sourceHash: await researchRevisionOf(sources), profileLiterals, domainComparisons };
}
export async function probeUnsupportedResearchDomain<Labels>(bound: BoundDomainProfile<Labels>) {
  const calls = { modelCalls: 0 as const, runnerInvocations: 0 as const };
  const result = await bindDomainProfile(bound.profile, {
    prompts: Object.fromEntries(bound.prompts.map(row => [row.id, row])),
    planValidators: Object.fromEntries(bound.profile.bindingRevisions.filter(row => row.kind === 'plan-validator').map(row => [row.id,
      { revision: row.revision, validate() { throw Error('Binding must not execute plan validation.'); } }])),
    evaluators: {}, rubrics: { [bound.profile.rubricId]: { revision: bound.profile.bindingRevisions.find(row => row.kind === 'rubric')!.revision, document: bound.rubric } },
    exporters: { [bound.profile.exportTemplateId]: { revision: bound.profile.bindingRevisions.find(row => row.kind === 'exporter')!.revision,
      render() { throw Error('Binding must not execute an export.'); } } },
  });
  if (result.valid || result.issues[0].code !== 'TRSH2008' || !result.issues[0].path.includes(bound.profile.evaluatorId)
    || !result.issues[0].detail.includes('Model calls: 0; runner invocations: 0')) throw Error('The unsupported-domain refusal does not reproduce.');
  return { id: 'domain:unsupported' as const, code: 'TRSH2008' as const, missingId: bound.profile.evaluatorId, ...calls, issue: result.issues[0] };
}
