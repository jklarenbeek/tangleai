/**
 * The ONE place an instrument builds a validator.
 *
 * Every report here is validated before it is printed or written, and
 * every instrument wants the same three things: collect the errors
 * rather than stop at the first, do not fail on a format nobody
 * registered, and compile ONE document per instance so a schema
 * registered for `$ref` is never also the schema being compiled.
 *
 * It is also where the `$query` keyword arrives. `@jarenjs/validate`
 * compiles `$query` for the instance that owns the schema, so the
 * cross-field arithmetic a report's honesty depends on — a denominator
 * that sums, an operation census whose forks reconcile, two rows on the
 * same question set — binds at VALIDATION time rather than only in a
 * test. A second validator built by hand somewhere else would be a
 * second answer to what "valid" means, and the first thing to rot would
 * be the assertion nobody runs.
 */

import { JarenValidator } from '@jarenjs/validate';

export interface ValidationOutcome {
  valid: boolean;
  errors?: unknown[];
}

export type ReportValidator = (value: unknown) => ValidationOutcome;

/**
 * Compile `schema`, with `refs` registered so its `$ref`s resolve. The
 * compiled schema is never one of `refs`: an instance cannot both
 * register and compile the same document.
 */
export function createReportValidator(schema: object, refs: readonly object[] = []): ReportValidator {
  const validator = new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' });
  if (refs.length > 0) validator.addSchema(refs as Record<string, unknown>[]);
  const validate = validator.compile(schema as Record<string, unknown>);
  return (value: unknown) => validate(value) as ValidationOutcome;
}

/** The first `limit` errors as lines a CLI can print. */
export function describeErrors(outcome: ValidationOutcome, limit = 20): string[] {
  return (outcome.errors ?? []).slice(0, limit).map((error) => JSON.stringify(error));
}
