import { canonicalizeJson } from '@jarenjs/json/canonical';
import { hashContent } from '@jarenjs/core/string';
import type { LessonInjection, LessonSetRecord, LessonValidationRun, LessonValidityOutput,
  ResearchLessonScope, ResearchLessonV2, ResearchProject } from '../contracts.gen.ts';
import { researchRefuse, type ResearchOutcome } from '../errors.ts';
import { immutableResearchJson, researchRevisionOf } from '../identity.ts';
import { validateResearchShape, type ResearchSchemaName } from '../schema.ts';

export const lessonScopeKey = (scope: ResearchLessonScope): string => canonicalizeJson(scope);
export const lessonInputHash = (input: unknown): string => hashContent(canonicalizeJson(input));
export const lessonValidity = (output: LessonValidityOutput): number =>
  output.claimSupport * output.registryAccuracy * output.preregistrationIntegrity;

/** Topic identity is separate from content, so renaming a topic cannot hide overlap. */
export async function lessonOriginContext(project: ResearchProject): Promise<ResearchOutcome<{
  scope: ResearchLessonScope; topicIds: string[]; topicContentHashes: string[];
}>> {
  const checked = validateResearchShape<ResearchProject>('ResearchProject', project);
  if (!checked.valid) return researchRefuse('TRSH2002', '/project', 'The origin project is invalid.', checked.issues[0]);
  const value = checked.value, context = value.lessonContext;
  if (!context) return researchRefuse('TRSH2002', '/project/lessonContext', 'This run has no immutable training-input binding.');
  return { valid: true, value: { scope: { domainProfileId: value.domainProfile, taskFamily: context.taskFamily },
    topicIds: [context.topicId], topicContentHashes: [await researchRevisionOf(context.input)] } };
}

async function seal<T>(name: ResearchSchemaName, input: unknown, address: 'content' | 'payload' | 'injection'): Promise<ResearchOutcome<T>> {
  let body: Record<string, unknown>;
  try { body = immutableResearchJson(input) as Record<string, unknown>; }
  catch (cause) { return researchRefuse('TRSH2001', '', 'Lesson records must be finite JSON.', cause); }
  if (!body || Array.isArray(body) || typeof body !== 'object' || 'id' in body || 'revision' in body)
    return researchRefuse('TRSH2001', '/id', 'The record owner supplies content identities.');
  const placeholder = '0'.repeat(64);
  const shape = validateResearchShape(name, { ...body, id: placeholder, ...(address === 'injection' ? {} : { revision: placeholder }) });
  if (!shape.valid) return researchRefuse('TRSH2001', '', 'Lesson record shape is invalid.', shape.issues[0]);
  const revision = await researchRevisionOf(body);
  const id = address === 'payload' ? await researchRevisionOf(body.payload) : revision;
  const checked = validateResearchShape<T>(name, { ...body, id, ...(address === 'injection' ? {} : { revision }) });
  return checked.valid ? checked : researchRefuse('TRSH2001', '', 'Lesson record shape is invalid.', checked.issues[0]);
}

export const sealResearchLesson = (body: Omit<ResearchLessonV2, 'id' | 'revision'>): Promise<ResearchOutcome<ResearchLessonV2>> =>
  seal('ResearchLessonV2', body, 'content');
export const sealLessonValidationRun = (body: Omit<LessonValidationRun, 'id' | 'revision'>): Promise<ResearchOutcome<LessonValidationRun>> =>
  seal('LessonValidationRun', body, 'content');
export const sealLessonSetRecord = (body: Omit<LessonSetRecord, 'id' | 'revision'>): Promise<ResearchOutcome<LessonSetRecord>> =>
  seal('LessonSetRecord', body, 'payload');
export const sealLessonInjection = (body: Omit<LessonInjection, 'id'>): Promise<ResearchOutcome<LessonInjection>> =>
  seal('LessonInjection', body, 'injection');

/** Readers reproduce identities too; physical storage is not a validation certificate. */
export async function checkLessonRecord<T extends ResearchLessonV2 | LessonValidationRun | LessonSetRecord | LessonInjection>(
  name: 'ResearchLessonV2' | 'LessonValidationRun' | 'LessonSetRecord' | 'LessonInjection', input: unknown,
): Promise<ResearchOutcome<T>> {
  const shape = validateResearchShape<T>(name, input);
  if (!shape.valid) return researchRefuse('TRSH2001', '', 'Lesson record shape is invalid.', shape.issues[0]);
  const value = shape.value, { id, ...withRevision } = value;
  const body = { ...withRevision } as Record<string, unknown>;
  delete body.revision;
  const revision = await researchRevisionOf(body);
  const expected = name === 'LessonSetRecord' ? await researchRevisionOf(body.payload) : revision;
  if (id !== expected || name !== 'LessonInjection' && ('revision' in value && value.revision !== revision))
    return researchRefuse('TRSH2001', '/id', 'Lesson identity does not reproduce from its immutable content.');
  return { valid: true, value };
}
