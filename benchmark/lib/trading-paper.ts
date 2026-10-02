/** An absent licence decision is a complete registered state, never a synthetic historical replay. */
import { readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import schema from '../schemas/trading.schema.json' with { type: 'json' };
import { createReportValidator } from './validate.ts';
import { TRADING_FIXTURE_PATH } from './trading.ts';
import type { PaperProfileRegistration, PaperProfileReport } from './trading.types.ts';

const validate = createReportValidator({ $defs: schema.$defs, $ref: '#/$defs/paperProfileRegistration' });
export async function loadTradingPaperProfile(root = TRADING_FIXTURE_PATH): Promise<PaperProfileRegistration> {
  const path = join(root, 'paper-profile.json'), stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Paper profile registration must be a regular file');
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!validate(value).valid) throw Error('Paper profile differs from the frozen corpus/licence decision');
  return value as PaperProfileRegistration;
}
export async function measureTradingPaperProfile(): Promise<PaperProfileReport> {
  const registration = await loadTradingPaperProfile();
  return { registration, sha256: await canonicalSha256(registration), rows: ['buy-and-hold', 'macd', 'kdj-rsi', 'zero-mean-reversion', 'sma', 'tradingagents-scripted', 'tradingagents-live'].map(id => ({
    id, parityTier: 'unmeasured', status: 'not-run', reason: registration.reason, metrics: null,
    costs: { commission: 0, slippage: 0, total: 0 }, modelCalls: 0, sessions: 0, eligible: false,
  })) };
}
