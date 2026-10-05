/** Native outcome record inspection retains its original refusal as the cause. */
import { scopeIdOf, validateRecord, type OutcomeRecord, type OutcomeService } from '@tangleai/outcomes';
import type { ResearchLessonScope } from '../contracts.gen.ts';
import { lessonFail } from './compile.ts';
import { researchLessonArtifactKey, researchLessonOutcomeScope } from './outcome.ts';

export async function lessonOutcomeBinding(service: OutcomeService, scope: ResearchLessonScope) {
  const scopeId = await scopeIdOf(researchLessonOutcomeScope(scope));
  if (service.scopeId !== scopeId) lessonFail('TRSH2003', '/outcomes/scope', 'The outcome service belongs to another lesson scope.');
  return { scopeId, artifactKey: researchLessonArtifactKey(scope) };
}
export async function lessonOutcomeRecord<K extends OutcomeRecord['kind']>(service: OutcomeService,
  binding: { scopeId: string; artifactKey: string }, id: string, kind: K): Promise<Extract<OutcomeRecord, { kind: K }>> {
  const found = await service.inspect({ ...binding, input: { id } });
  if (!found.ok) lessonFail('TRSH2007', '/outcomes/' + kind, 'The native outcome record could not be checked.', found.issues[0]);
  let record: OutcomeRecord;
  try { record = await validateRecord(found.value); }
  catch (cause) { return lessonFail('TRSH2007', '/outcomes/' + kind, 'The native outcome record identity is invalid.', cause); }
  if (record.kind !== kind || record.id !== id || record.scopeId !== binding.scopeId || record.artifactKey !== binding.artifactKey)
    lessonFail('TRSH2007', '/outcomes/' + kind, 'The native outcome record has a different kind, address or scope.');
  return record as Extract<OutcomeRecord, { kind: K }>;
}
