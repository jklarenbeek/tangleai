/** All research instrument validation uses the shared validator factory and exact owners. */
import { runIdentitySchema } from '@tangleai/config';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { encodeJSONPointerSegment } from '@jarenjs/json/pointer';
import records from '../schemas/research-records.schema.json' with { type: 'json' };
import report from '../schemas/research.schema.json' with { type: 'json' };
import { createReportValidator, type ReportValidator } from './validate.ts';
import type { ResearchIssue } from './research.types.ts';

export { records as researchRecordSchema, report as researchReportSchema };
const cache = new Map<string, ReportValidator>();
export function researchShape(name: string, value: unknown): ResearchIssue[] {
  const owner = Object.hasOwn(records.$defs, name) ? records : report;
  if (!Object.hasOwn(owner.$defs, name)) throw new TypeError('Unknown research schema: ' + name);
  try { canonicalizeJson(value); }
  catch (cause) {
    return [{ code: 'TRSH1001', path: '', detail: cause instanceof Error ? cause.message : String(cause) }];
  }
  let validate = cache.get(name);
  if (!validate) {
    validate = createReportValidator({ $ref: owner.$id + '#/$defs/' + name }, [records, report, runIdentitySchema]);
    cache.set(name, validate);
  }
  const result = validate(value);
  return result.valid ? [] : (result.errors ?? []).map(error => {
    const item = error as { instancePath?: string; message?: string; params?: { missingProperty?: string; additionalProperty?: string } };
    const member = item.params?.missingProperty ?? item.params?.additionalProperty;
    const path = (item.instancePath ?? '') + (member === undefined ? '' : '/' + encodeJSONPointerSegment(member));
    return { code: 'TRSH1001', path, detail: item.message ?? 'Invalid research record.' };
  });
}
export const validateResearchReportShape = createReportValidator(report, [records, runIdentitySchema]);
export function requireResearchShape<T>(name: string, value: unknown): T {
  const issues = researchShape(name, value);
  if (issues.length) throw new Error(name + ' refused: ' + JSON.stringify(issues.slice(0, 5)));
  return value as T;
}
