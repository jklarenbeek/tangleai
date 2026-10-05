import type { ResearchIssue } from './contracts.gen.ts';
import { encodeJSONPointerSegment } from '@jarenjs/json/pointer';

export const RESEARCH_ERRORS = {
  TRSH1001: 'Closed schema violation',
  TRSH1002: 'Identity or content hash mismatch',
  TRSH1003: 'Unknown reference',
  TRSH1004: 'Transition or state conflict',
  TRSH1005: 'Evidence, claim or input scope violation',
  TRSH1006: 'Budget, replicate or selection policy violation',
  TRSH1007: 'Host capability or manifest mismatch',
  TRSH1008: 'Provider, adapter or persistence failure',
  TRSH1009: 'Preregistration violation',
  TRSH1010: 'Isolation refusal',
  TRSH2001: 'Lesson, set, profile or manifest shape violation',
  TRSH2002: 'Lesson origin chain is incomplete',
  TRSH2003: 'Lesson domain or task scope mismatch',
  TRSH2004: 'Lesson validation must be synchronous and bound',
  TRSH2005: 'Lesson origin or hidden result leakage',
  TRSH2006: 'Web lesson lacks independent corroboration',
  TRSH2007: 'Lesson promotion or active-procedure edit refused',
  TRSH2008: 'Domain profile is unsupported or incomplete',
  TRSH2009: 'External research slice is unpinned or unaudited',
  TRSH2010: 'Research live operation is unavailable',
  TRSH2011: 'Lesson decay hypothesis is unregistered',
  TRSH2012: 'Research ablation pair is incomparable',
} as const;
export type ResearchCode = keyof typeof RESEARCH_ERRORS;
export type ResearchOutcome<T> = { valid: true; value: T } | { valid: false; issues: ResearchIssue[] };

export function researchIssue(code: ResearchCode, path: string, detail: string, cause?: unknown): ResearchIssue {
  const issue: ResearchIssue = { code, path, detail };
  if (cause !== undefined) {
    const value = cause !== null && typeof cause === 'object' ? cause as Record<string, unknown> : {};
    const at = value.path ?? value.docPath ?? value.instancePath;
    issue.cause = {
      code: typeof value.code === 'string' ? value.code : 'unknown',
      path: typeof at === 'string' ? at : '',
      detail: typeof value.detail === 'string' ? value.detail : typeof value.message === 'string' ? value.message : String(cause),
    };
  }
  return issue;
}
export function researchRefuse<T = never>(code: ResearchCode, path: string, detail: string, cause?: unknown): ResearchOutcome<T> {
  return { valid: false, issues: [researchIssue(code, path, detail, cause)] };
}

/** Normalize the native validator's member paths once for records and reports. */
export function researchValidationIssues(errors: readonly unknown[] | undefined): ResearchIssue[] {
  if (!errors?.length) return [researchIssue('TRSH1001', '', 'Invalid research record.')];
  return errors.map(value => {
    const error = value as { instancePath?: string; message?: string; params?: { missingProperty?: string; additionalProperty?: string } };
    const missing = error.params?.missingProperty, additional = error.params?.additionalProperty;
    let path = error.instancePath ?? '';
    if (missing !== undefined) path += '/' + encodeJSONPointerSegment(missing);
    else if (additional !== undefined && path.endsWith('/' + additional)) {
      path = path.slice(0, -('/' + additional).length) + '/' + encodeJSONPointerSegment(additional);
    }
    return researchIssue('TRSH1001', path, error.message ?? 'Invalid research record.');
  });
}
