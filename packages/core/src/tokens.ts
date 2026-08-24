/**
 * Token estimation. The 4-characters-per-token heuristic from memflow
 * `src/utils/tokens.ts`, kept as a heuristic ON PURPOSE: a real
 * tokenizer is model-specific and heavy, and every place this number is
 * used (budgets, truncation) already treats it as a ceiling, not a
 * measurement. When a budget decision starts to matter more than ±25%,
 * the fix is a real count from the provider's usage field, not a better
 * guess here.
 */

export const CHARS_PER_TOKEN = 4;

/** Estimated token count, never negative. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Truncate `text` so its estimated token count fits `maxTokens`. */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (!text || maxTokens <= 0) return '';
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}
