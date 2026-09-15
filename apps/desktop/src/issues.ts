/**
 * The desktop's own refusal vocabulary.
 *
 * Everything this surface refuses is rendered as the same three fields —
 * the code, the path it is about, and a detail a reader can act on — so
 * the shape and its constructor are declared once instead of once per
 * module that has to say no.
 *
 * Bounded admission is the other half. `@jarenjs/core/schedule` reports
 * a request it would not admit as a plain `Error` whose message is the
 * reason, and deciding which messages this host answers as a refusal
 * rather than re-throwing as a fault is ONE decision: the names below
 * become a counted issue, and anything else is a bug that keeps
 * travelling until something can handle it.
 */

/** A refusal as every desktop surface renders it. */
export interface DesktopIssue {
  code: string;
  path: string;
  detail: string;
}

export const issue = (code: string, path: string, detail: string): DesktopIssue => ({ code, path, detail });

/** The admission reasons this host answers as a value. */
export const ADMISSION_REFUSALS = ['queue-full', 'closed', 'cancelled', 'deadline'] as const;
export type AdmissionRefusal = typeof ADMISSION_REFUSALS[number];

export const isAdmissionRefusal = (error: unknown): boolean =>
  error instanceof Error && (ADMISSION_REFUSALS as readonly string[]).includes(error.message);
