/** All research instrument validation uses the shared validator factory and exact owners. */
import { runIdentitySchema } from '@tangleai/config';
import { masRuntimeSchema, masWorkflowSchema, masRegistrySchema } from '@tangleai/mas';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { researchSchema as records, validateResearchShape, researchValidationIssues, type ResearchSchemaName } from '@tangleai/research';
import report from '../schemas/research.schema.json' with { type: 'json' };
import { createReportValidator, type ReportValidator } from './validate.ts';
import type { ResearchIssue } from './research.types.ts';

export { records as researchRecordSchema, report as researchReportSchema };
const cache = new Map<string, ReportValidator>();
const dependencies = [records, runIdentitySchema, masRuntimeSchema, masWorkflowSchema, masRegistrySchema];
export function researchShape(name: string, value: unknown): ResearchIssue[] {
  if (Object.hasOwn(records.$defs, name)) {
    const result = validateResearchShape(name as ResearchSchemaName, value);
    return result.valid ? [] : result.issues;
  }
  const owner = report;
  if (!Object.hasOwn(owner.$defs, name)) throw new TypeError('Unknown research schema: ' + name);
  try { canonicalizeJson(value); }
  catch (cause) {
    return [{ code: 'TRSH1001', path: '', detail: cause instanceof Error ? cause.message : String(cause) }];
  }
  let validate = cache.get(name);
  if (!validate) {
    validate = createReportValidator({ $ref: owner.$id + '#/$defs/' + name }, [report, ...dependencies]);
    cache.set(name, validate);
  }
  const result = validate(value);
  return result.valid ? [] : researchValidationIssues(result.errors);
}
export const validateResearchReportShape = createReportValidator(report, dependencies);
export function requireResearchShape<T>(name: string, value: unknown): T {
  const issues = researchShape(name, value);
  if (issues.length) throw new Error(name + ' refused: ' + JSON.stringify(issues.slice(0, 5)));
  return value as T;
}
