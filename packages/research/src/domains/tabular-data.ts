/** Strict CSV admission and independent paired-sample statistics use native owners. */
import { parseCsv } from '@jarenjs/josl';
import { mean, variance, stddev, pairedBootstrap } from '@jarenjs/core/stats';
import { equalsJson } from '@jarenjs/core/object';
import type { TabularSample, TabularStatisticsSummary } from '../contracts.gen.ts';
import { immutableResearchJson } from '../identity.ts';
import { researchRefuse, type ResearchOutcome } from '../errors.ts';
import { validateResearchShape } from '../schema.ts';

export function parseTabularSamples(csv: string): ResearchOutcome<TabularSample[]> {
  if (typeof csv !== 'string' || new TextEncoder().encode(csv).byteLength > 262144)
    return researchRefuse('TRSH1006', '/csv', 'CSV input must fit the 256 KiB profile bound.');
  try {
    const records = parseCsv(csv, { headers: false, typed: true, repair: false, trim: false });
    if (!equalsJson(records[0], ['id', 'pairId', 'group', 'value', 'unit']) || records.length < 5 || records.length > 2049)
      return researchRefuse('TRSH1001', '/csv', 'CSV needs its exact header and between two and 1024 complete pairs.');
    const rows: TabularSample[] = [];
    for (const [i, row] of records.slice(1).entries()) {
      if (!Array.isArray(row) || row.length !== 5) return researchRefuse('TRSH1001', '/csv/' + i, 'Every source row needs exactly five cells.');
      const checked = validateResearchShape<TabularSample>('TabularSample', { id: row[0], pairId: row[1], group: row[2], value: row[3], unit: row[4] });
      if (!checked.valid) return checked;
      if (checked.value.unit !== 'points') return researchRefuse('TRSH1006', '/csv/' + i + '/unit', 'The registered unit is points.');
      rows.push(checked.value);
    }
    const groups = new Map<string, Set<string>>();
    for (const row of rows) {
      const pair = groups.get(row.pairId) ?? new Set<string>();
      if (pair.has(row.group)) return researchRefuse('TRSH1002', '/csv/pairs', 'A source pair repeats the same group.');
      pair.add(row.group); groups.set(row.pairId, pair);
    }
    if (new Set(rows.map(row => row.id)).size !== rows.length || [...groups.values()].some(pair => pair.size !== 2))
      return researchRefuse('TRSH1002', '/csv/pairs', 'Every source id is unique and every pair has exactly A and B.');
    return { valid: true, value: immutableResearchJson(rows) };
  } catch (cause) { return researchRefuse('TRSH1001', '/csv', 'Strict CSV parsing refused the input.', cause); }
}

export function tabularStatistics(rows: readonly TabularSample[], seed: number): ResearchOutcome<TabularStatisticsSummary> {
  if (!Array.isArray(rows) || rows.length < 4 || rows.length > 2048)
    return researchRefuse('TRSH1006', '/rows', 'Statistics require between four and 2048 source rows.');
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 4294967295)
    return researchRefuse('TRSH1001', '/seed', 'The bootstrap seed must be a uint32.');
  const pairs = new Map<string, { A?: number; B?: number }>();
  const ids = new Set<string>();
  for (const raw of rows) {
    const checked = validateResearchShape<TabularSample>('TabularSample', raw); if (!checked.valid) return checked;
    const row = checked.value, pair = pairs.get(row.pairId) ?? {};
    if (ids.has(row.id) || pair[row.group] !== undefined || row.unit !== 'points')
      return researchRefuse('TRSH1006', '/rows', 'Statistics require unique rows, paired groups and points.');
    ids.add(row.id); pair[row.group] = row.value; pairs.set(row.pairId, pair);
  }
  if (pairs.size < 2 || pairs.size > 1024 || [...pairs.values()].some(row => row.A === undefined || row.B === undefined))
    return researchRefuse('TRSH1006', '/rows', 'Statistics require between two and 1024 complete source pairs.');
  const ordered = [...pairs].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, row]) => row);
  const a = ordered.map(row => row.A!), b = ordered.map(row => row.B!);
  const interval = pairedBootstrap(a.map((value, i) => [b[i], value] as const),
    { resamples: 2000, seed, level: 0.95, quantile: 'nearest-rank' });
  return validateResearchShape<TabularStatisticsSummary>('TabularStatisticsSummary', { pairs: pairs.size,
    meanA: mean(a), meanB: mean(b), meanDifference: mean(a)! - mean(b)!,
    sampleVarianceA: variance(a), sampleVarianceB: variance(b), sampleStddevA: stddev(a), sampleStddevB: stddev(b),
    interval: { lower: interval.lower, upper: interval.upper, level: interval.level, method: interval.method,
      quantile: interval.quantile, resamples: interval.resamples, seed: interval.seed } });
}
