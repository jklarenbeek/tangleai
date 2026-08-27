/**
 * Markdown output, because that is what this repo already publishes.
 *
 * `scripts/benchmark-documents.ts` prints a Markdown table to stdout and
 * `docs/DOCUMENT_BENCHMARK.md` is the reviewed copy of one such run. This
 * file is that idiom extracted, so a second instrument does not invent a
 * second format — and so the alignment rules (numbers right, labels left)
 * live once.
 */

export type Cell = string | number | null;

export interface TableSpec {
  /** Column headers, left to right. */
  head: readonly string[];
  /** One array per row, same length as `head`. */
  rows: readonly (readonly Cell[])[];
  /** Which columns are numeric and right-aligned; defaults to all but the first. */
  numeric?: readonly number[];
}

/** `null` is an absent measurement and renders as an em dash, never as 0. */
function cell(value: Cell): string {
  if (value === null) return '—';
  return String(value);
}

/** Render a Markdown table. */
export function table(spec: TableSpec): string {
  const numeric = new Set(spec.numeric ?? spec.head.map((_, i) => i).slice(1));
  const rule = spec.head.map((_, i) => (numeric.has(i) ? '---:' : '---'));
  const lines = [
    `| ${spec.head.join(' | ')} |`,
    `|${rule.map((r) => r).join('|')}|`,
    ...spec.rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ];
  return lines.join('\n');
}

/** A fraction as a percentage with one decimal, or an em dash. */
export function pct(value: number | null, digits = 1): string {
  return value === null ? '—' : `${(value * 100).toFixed(digits)}%`;
}

/** A score with three decimals, the precision every retrieval row uses. */
export function score(value: number | null): string {
  return value === null ? '—' : value.toFixed(3);
}

/** Milliseconds with one decimal. */
export function ms(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)} ms`;
}

/** Thousands separators, so a six-digit count is readable. */
export function count(value: number): string {
  return value.toLocaleString('en-US');
}
