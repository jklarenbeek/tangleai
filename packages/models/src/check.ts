/** Model-facing validation feedback over the shared strict check contract. */

/** Validation errors reported back per rejected write — enough to fix
 * from, few enough to stay readable in a model's context. */
export const MAX_INPUT_ERRORS = 8;

/**
 * The one rejection shape every schema-guarded boundary in this package
 * answers with: `{ error, errors, inputSchema }`, never a throw. The
 * model (or the caller) reads the errors, re-reads the schema, and
 * retries — which only works if every boundary answers the same way, so
 * this is the single implementation and both the toolbox and the ledger
 * call it rather than each shaping its own.
 *
 * Member order is part of the shape: `error`, `errors`, any `extra`
 * (the toolbox's `hint`), then `inputSchema` last, because the schema is
 * the biggest member and a reader scans the message first.
 *
 * @param what - what was being validated (`add`, `memory`, …)
 * @param outcome - a normalized {@link checkOutcome}
 * @param inputSchema - the schema to re-read
 * @param [extra] - boundary-specific members
 */
export function invalidInput(what: string, outcome: {
  errors: any[];
}, inputSchema: any, extra: Record<string, any> = {}): {
  error: string;
  errors: any[];
  inputSchema: any;
} {
  return {
    error: `invalid input for ${what}`,
    errors: outcome.errors.slice(0, MAX_INPUT_ERRORS).map((e: any) => ({
      instancePath: e.instancePath ?? '',
      keyword: e.keyword ?? '',
      message: e.message ?? 'invalid',
    })),
    ...extra,
    inputSchema,
  };
}
