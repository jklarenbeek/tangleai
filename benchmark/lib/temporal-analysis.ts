/** Registered paired group bootstrap and conservative deployment qualification. */
import { mulberry32 } from '@jarenjs/core/random';
import { mean, quantile } from '@jarenjs/core/stats';
import { LME_TYPES } from './longmemeval.ts';
import { TEMPORAL_CONTROLS } from './temporal-controls.ts';
import { sha256 } from './longmemeval-source.ts';
import { canonicalizeJson } from '@jarenjs/json/canonical';
export interface TemporalPairIdentity { id: string; group: string }
export interface TemporalPairScore extends TemporalPairIdentity { control: number | null; treatment: number | null }
export function analyzeTemporalPairs(rows: readonly TemporalPairScore[], expected: readonly TemporalPairIdentity[]) {
  const identities = [...expected].sort((a, b) => a.id.localeCompare(b.id)), expectedMap = new Map(identities.map(r => [r.id, r.group]));
  if (expectedMap.size !== expected.length || new Set(rows.map(r => r.id)).size !== rows.length) throw Error('duplicate paired question');
  for (const row of rows) {
    if (!row.group || expectedMap.get(row.id) !== row.group) throw Error('unregistered question or independent group in paired comparison');
    for (const value of [row.control, row.treatment]) if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1)) throw Error('paired scores must be bounded accuracies/F1 or explicit unmeasured null');
  }
  const measured = rows.filter(r => r.control !== null && r.treatment !== null), complete = expected.length > 0 && measured.length === expected.length;
  const base = { expectedQuestions: expected.length, pairedQuestions: measured.length, groups: new Set(measured.map(r => r.group)).size,
    questionIdentity: sha256(canonicalizeJson(identities)), complete, seed: TEMPORAL_CONTROLS.bootstrap.seed, resamples: TEMPORAL_CONTROLS.bootstrap.resamples,
    confidence: .95, interval: 'two-sided-percentile' as const, quantile: 'nearest-rank' as const };
  if (!complete) return { ...base, status: 'unmeasured' as const, control: null, treatment: null, delta: null, low: null, high: null };
  const values = measured.map(r => ({ ...r, control: r.control!, treatment: r.treatment! })).sort((a, b) => a.id.localeCompare(b.id));
  const groups = [...new Set(values.map(r => r.group))].sort().map(group => {
    const members = values.filter(r => r.group === group);
    return { count: members.length, delta: members.reduce((n, r) => n + r.treatment - r.control, 0) };
  });
  const random = mulberry32(base.seed), samples: number[] = [];
  for (let draw = 0; draw < base.resamples; draw++) {
    let delta = 0, count = 0;
    for (let i = 0; i < groups.length; i++) { const selected = groups[Math.floor(random() * groups.length)]; delta += selected.delta; count += selected.count; }
    samples.push(delta / count);
  }
  return { ...base, status: 'measured' as const, control: mean(values.map(r => r.control))!, treatment: mean(values.map(r => r.treatment))!,
    delta: mean(values.map(r => r.treatment - r.control))!, low: quantile(samples, .025, { method: 'nearest-rank' })!, high: quantile(samples, .975, { method: 'nearest-rank' })! };
}
export type TemporalPairedAnalysis = ReturnType<typeof analyzeTemporalPairs>;
export interface TemporalCostArm { coldProviderUsd: number; prepareProviderUsdPerScope: number; queryProviderUsdPerQuery: number; warmP95Ms: number; observedQueries: number; hostIdentity: string; workloadIdentity: string }
export interface TemporalCostEvidence {
  control: TemporalCostArm; treatment: TemporalCostArm; totalProviderUsd: number;
  approvedCeilings: { absoluteUsd: number; zeroControl: { coldProviderUsd: number; amortizedProviderUsdPerQuery: number; warmP95Ms: number } | null };
}
export function evaluateTemporalCosts(evidence: TemporalCostEvidence | null) {
  if (!evidence) return { status: 'unmeasured' as const, passed: false, coldRatio: null, amortizedRatio: null, warmP95Ratio: null };
  const { control: c, treatment: t, approvedCeilings: caps } = evidence;
  for (const arm of [c, t]) for (const field of ['coldProviderUsd', 'prepareProviderUsdPerScope', 'queryProviderUsdPerQuery', 'warmP95Ms', 'observedQueries'] as const)
    if (!Number.isFinite(arm[field]) || arm[field] < 0) throw Error('invalid cost or timing evidence');
  if (!Number.isFinite(caps.absoluteUsd) || caps.absoluteUsd < 0 || !Number.isFinite(evidence.totalProviderUsd) || evidence.totalProviderUsd < 0) throw Error('invalid absolute provider cost ceiling');
  if (caps.zeroControl && Object.values(caps.zeroControl).some(v => !Number.isFinite(v) || v < 0)) throw Error('invalid pre-registered absolute zero-control ceiling');
  const amortized = (a: TemporalCostArm) => a.prepareProviderUsdPerScope / TEMPORAL_CONTROLS.gate.amortizationQueries + a.queryProviderUsdPerQuery;
  const ratio = (treatment: number, control: number) => control > 0 ? treatment / control : null;
  const coldRatio = ratio(t.coldProviderUsd, c.coldProviderUsd), amortizedRatio = ratio(amortized(t), amortized(c)), warmP95Ratio = ratio(t.warmP95Ms, c.warmP95Ms);
  const passes = (value: number | null, limit: number, actual: number, absolute: number | undefined) => value !== null ? value <= limit : absolute !== undefined && actual <= absolute;
  return { status: 'measured' as const, coldRatio, amortizedRatio, warmP95Ratio,
    passed: c.observedQueries > 0 && t.observedQueries > 0 && c.observedQueries === t.observedQueries && c.hostIdentity.length > 0 && c.hostIdentity === t.hostIdentity && c.workloadIdentity.length > 0 && c.workloadIdentity === t.workloadIdentity &&
      evidence.totalProviderUsd <= caps.absoluteUsd && passes(coldRatio, 3, t.coldProviderUsd, caps.zeroControl?.coldProviderUsd) &&
      passes(amortizedRatio, 2, amortized(t), caps.zeroControl?.amortizedProviderUsdPerQuery) && passes(warmP95Ratio, 2, t.warmP95Ms, caps.zeroControl?.warmP95Ms) };
}
/** This classifies evidence; it never mutates the shipped opt-in default. */
export function decideTemporalDefault(input: {
  analyses: Record<string, TemporalPairedAnalysis>; costs: TemporalCostEvidence | null; strictPlanned: number; strictPassed: number; violations: number;
  origin: 'live' | 'verified-live-replay' | 'scripted' | 'unmeasured'; profile: 'provided-history' | 'strict-as-of'; confirmation: boolean;
}) {
  const required = [...LME_TYPES.map(t => `longmemeval:${t}`), ...[1, 2, 3, 4].map(c => `locomo:${c}`)];
  const reasons: string[] = [];
  for (const key of required) {
    const analysis = input.analyses[key];
    if (!analysis?.complete || analysis.low === null || analysis.low === undefined) reasons.push(`${key}:unmeasured-or-incomplete`);
    else if (key === 'longmemeval:temporal-reasoning' ? analysis.low <= 0 : analysis.low < -.05) reasons.push(`${key}:bound-failed`);
  }
  const statisticalCandidate = reasons.length === 0;
  if (!['live', 'verified-live-replay'].includes(input.origin)) reasons.push('live-quality-unmeasured');
  if (input.profile !== 'provided-history' || !input.confirmation) reasons.push('wrong-primary-profile-or-fold');
  if (input.strictPlanned < 138 || input.strictPassed !== input.strictPlanned || input.violations !== 0) reasons.push('strict-correctness-or-coverage-failed');
  const costs = evaluateTemporalCosts(input.costs); if (!costs.passed) reasons.push(`cost:${costs.status === 'unmeasured' ? 'unmeasured' : 'failed'}`);
  return { default: reasons.length ? 'off' as const : 'eligible' as const, statisticalCandidate, costs, reasons };
}
