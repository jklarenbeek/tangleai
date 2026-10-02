import type { TradingIssue } from './contracts.gen.ts';

export type TradingOutcome<T> = { valid: true; value: T } | { valid: false; issues: TradingIssue[] };
export function tradingIssue(code: TradingIssue['code'], path: string, detail: string, cause?: unknown): TradingIssue {
  const issue: TradingIssue = { code, path, detail };
  if (cause !== undefined) {
    const value = cause as { code?: string; path?: string; docPath?: string; detail?: string; message?: string } | null;
    issue.cause = { code: value?.code ?? 'unknown', path: value?.path ?? value?.docPath ?? '', detail: value?.detail ?? value?.message ?? String(cause) };
  }
  return issue;
}
export function tradingRefuse<T = never>(code: TradingIssue['code'], path: string, detail: string, cause?: unknown): TradingOutcome<T> {
  return { valid: false, issues: [tradingIssue(code, path, detail, cause)] };
}
