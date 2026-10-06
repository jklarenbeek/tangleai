/** Registered row pairs preserve missing evidence, losses and refused comparisons. */
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { mean } from '@jarenjs/core/stats';
import { researchIssue, researchSchema, researchSchemaReferences, type ResearchIssue } from '@tangleai/research';
import { bootstrapInterval } from './locomo-policy.ts';
import { createReportValidator } from './validate.ts';
import { table } from './table.ts';
import { RESEARCH_ABLATION_SCHEMA } from './research-ablation-schema.ts';
import { researchAblationRows, type ResearchAblationInput } from './research-ablation-rows.ts';
import type { LoadedResearchFixture } from './research-fixture.ts';
import type { ResearchAblationReport, ResearchAblationPair, ResearchAblationRow } from './research-ablation.types.ts';

const same = (a: unknown, b: unknown) => canonicalizeJson(a) === canonicalizeJson(b);
const dimensions = ['calls', 'tokens', 'ms', 'physical'] as const;
export const validateResearchAblationShape = createReportValidator(RESEARCH_ABLATION_SCHEMA, [researchSchema, ...researchSchemaReferences]);

/** This projection pairs report rows; topic resampling remains owned by the existing bootstrap. */
function pairsOf(rows: ResearchAblationRow[]): Array<{ id: string; baseline: ResearchAblationRow; treatment: ResearchAblationRow; purpose: ResearchAblationPair['purpose'] }> {
  const registrations: Array<readonly [string, string, string, ResearchAblationPair['purpose']]> = [
    ['lessons-on-vs-off', 'lessons-off', 'lessons-on', 'superiority'],
    ...['none', 'age-linear', 'severity-weighted-age'].map(h => ['decay:' + h + '-vs-on', 'lessons-on', 'lessons-on/decay:' + h, 'superiority'] as const),
    ['debate-vs-fixed', 'fixed-single-agent', 'fixed-plus-debate', 'superiority'],
    ['self-healing-vs-fixed', 'fixed-single-agent', 'fixed-plus-branching', 'superiority'],
    ['gate-only-vs-full-auto', 'gate-only-full', 'full-auto-full', 'superiority'],
    ['domain:tabular-vs-first', 'domain:computational/fixed-pipeline', 'domain:tabular-statistics/fixed-pipeline', 'parity'],
    ...['computational', 'tabular-statistics'].map(d => ['domain:' + d + '/lessons-on-vs-off', 'domain:' + d + '/lessons-off', 'domain:' + d + '/lessons-on', 'superiority'] as const),
  ];
  const byId = new Map(rows.map(row => [row.id, row]));
  if (byId.size !== rows.length) throw Error('Duplicate ablation row.');
  return registrations.map(([id, a, b, purpose]) => {
    const baseline = byId.get(a), treatment = byId.get(b);
    if (!baseline || !treatment) throw Error('Missing registered ablation row: ' + id);
    return { id, baseline, treatment, purpose };
  });
}

export function compareResearchAblation(id: string, baseline: ResearchAblationRow, treatment: ResearchAblationRow,
  purpose: ResearchAblationPair['purpose'] = 'superiority'): ResearchAblationPair {
  const refusals: ResearchIssue[] = [];
  const differ = (field: string, a: unknown, b: unknown) => { if (!same(a, b)) refusals.push(researchIssue('TRSH2012', '/' + field, 'Different ' + field + '.')); };
  if (baseline.state !== 'measured' || treatment.state !== 'measured') refusals.push(researchIssue('TRSH2012', '/state', 'Both rows must have executed.'));
  for (const field of ['scope', 'identityStatus', 'identityId', 'comparisonIdentity', 'promptRevisions', 'budget'] as const) differ(field, baseline[field], treatment[field]);
  differ('topicIds', baseline.topics.map(t => t.id), treatment.topics.map(t => t.id));
  if ([baseline, treatment].some(row => new Set(row.topics.map(t => t.id)).size !== row.topics.length))
    refusals.push(researchIssue('TRSH2012', '/topicIds', 'Repeated topics cannot count as independent paired observations.'));
  differ('topicHashes', baseline.topics.map(t => t.hash), treatment.topics.map(t => t.hash));
  differ('seeds', baseline.topics.map(t => t.seeds), treatment.topics.map(t => t.seeds));
  if (!baseline.topics.length || !treatment.topics.length || [...baseline.topics, ...treatment.topics].some(t => t.primary === null))
    refusals.push(researchIssue('TRSH2012', '/primary', 'The registered validity product requires all three independently measured denominators.'));
  if (!baseline.comparisonIdentity || !treatment.comparisonIdentity || baseline.identityStatus === 'legacy-unrecorded'
    || treatment.identityStatus === 'legacy-unrecorded' || !baseline.promptRevisions.length || !treatment.promptRevisions.length
    || [baseline, treatment].some(row => row.identityStatus === 'run' && row.identityId === null)
    || [...baseline.topics, ...treatment.topics].some(t => !t.seeds.length))
    refusals.push(researchIssue('TRSH2012', '/provenance', 'Recorded comparison identity, prompt revisions and seeds are required.'));
  const comparable = refusals.length === 0;
  const topics = comparable ? baseline.topics.map((t, i) => ({ topicId: t.id, baseline: t.primary!, treatment: treatment.topics[i].primary!,
    delta: treatment.topics[i].primary! - t.primary! })) : [];
  const deltas = topics.map(t => t.delta), interval = comparable ? bootstrapInterval(deltas, { seed: 17753, resamples: 2000, level: .95 }) : null;
  const cost = { baseline: { ...baseline.spend }, treatment: { ...treatment.spend },
    delta: Object.fromEntries(dimensions.map(key => [key, treatment.spend[key] - baseline.spend[key]])) as ResearchAblationPair['cost']['delta'],
    registered: { ...baseline.budget }, withinBound: dimensions.every(key => baseline.budget[key] !== null
      && baseline.spend[key] <= baseline.budget[key]! && treatment.spend[key] <= baseline.budget[key]!) };
  const safetyRefusals = baseline.safetyRefusals + treatment.safetyRefusals, outcomeEligible = treatment.outcomeEligible;
  return { id, purpose, baseline: baseline.id, treatment: treatment.id, comparable, refusals, topics,
    delta: comparable ? mean(deltas)! : null, interval, losses: topics.filter(t => t.delta < 0).map(t => ({ topicId: t.topicId, delta: t.delta })),
    safetyRefusals, outcomeEligible, cost,
    eligible: purpose === 'superiority' && comparable && interval !== null && interval.low > 0 && safetyRefusals === 0 && cost.withinBound && outcomeEligible };
}

export async function buildResearchAblation(input: ResearchAblationInput, loaded: LoadedResearchFixture): Promise<ResearchAblationReport> {
  const rows = await researchAblationRows(input, loaded);
  const pairs = pairsOf(rows).map(p => compareResearchAblation(p.id, p.baseline, p.treatment, p.purpose));
  const report: ResearchAblationReport = { registration: { id: 'research-ablation-v1', primary: 'claimSupport*registryAccuracy*preregistrationIntegrity',
    seed: 17753, resamples: 2000, level: .95, direction: 'treatment-minus-baseline' }, rows, pairs,
    gate: { writebackEligible: pairs.some(p => p.id === 'lessons-on-vs-off' && p.eligible),
      fullAutoEligible: pairs.some(p => p.id === 'gate-only-vs-full-auto' && p.eligible) }, limitations: [
      'Rows preserve their measured scope. Missing validity denominators are unknown, never inferred from success or completion.',
      'Different topics, seeds, budgets, identities, prompt revisions or scopes yield counted TRSH2012 refusals and no interval.',
      'Cross-domain control-plane parity is a source measurement; it cannot supply a paired scientific score for different topic sets.',
      'Missing cost bounds cannot pass an activation gate. A tied interval cannot select a lesson or decay default.',
      'Every external slice is explicitly not-run until licensed, pinned inputs execute. There is no external superiority pair.',
    ] };
  const checked = validateResearchAblationShape(report);
  if (!checked.valid) throw Error('Research ablation refused: ' + JSON.stringify(checked.errors?.slice(0, 8)));
  return report;
}

export async function validateResearchAblation(value: unknown, input: ResearchAblationInput, loaded: LoadedResearchFixture): Promise<boolean> {
  return validateResearchAblationShape(value).valid && same(value, await buildResearchAblation(input, loaded));
}
export function renderResearchAblation(report: ResearchAblationReport): string[] {
  const show = (value: unknown) => value === null ? 'unknown' : String(value);
  return ['## Registered ablation matrix', '',
    'Primary: claim support × registry accuracy × preregistration integrity. Bootstrap seed 17753, 2,000 resamples, 95% interval. Completion is not the primary.', '',
    table({ head: ['Row', 'State', 'Scope', 'Identity', 'Calls / tokens / physical / ms', 'Refusals'], rows: report.rows.map(row => [
      row.id, row.state, row.scope, row.identityStatus + ':' + show(row.identityId),
      [row.spend.calls, row.spend.tokens, row.spend.physical, row.spend.ms].join(' / '), row.refusals.join('; ') || 'none']) }), '',
    table({ head: ['Row', 'Registered calls / tokens / physical / ms', 'Comparison identity', 'Prompt revisions', 'Per-topic validity / completion'], rows: report.rows.map(row => [
      row.id, [row.budget.calls, row.budget.tokens, row.budget.physical, row.budget.ms].map(show).join(' / '),
      show(row.comparisonIdentity), row.promptRevisions.join('; ') || 'unrecorded',
      row.topics.map(topic => topic.id + ': ' + show(topic.primary) + ' / ' + show(topic.completion)).join('; ') || 'unmeasured']) }), '',
    table({ head: ['Pair', 'Purpose', 'Comparable', 'Delta', '95% interval', 'Losses', 'Cost bounded', 'Outcome eligible', 'Refusals'], rows: report.pairs.map(pair => [
      pair.id, pair.purpose, String(pair.comparable), show(pair.delta), pair.interval ? '[' + pair.interval.low + ', ' + pair.interval.high + ']' : 'unknown',
      pair.losses.map(loss => loss.topicId + ':' + loss.delta).join('; ') || 'none', String(pair.cost.withinBound), String(pair.outcomeEligible),
      pair.refusals.map(issue => issue.code + ':' + issue.path).join('; ') || 'none']) }), '',
    'Writeback eligible: **' + report.gate.writebackEligible + '**. Full auto eligible: **' + report.gate.fullAutoEligible + '**.', '',
    ...report.limitations.map(line => '- ' + line), ''];
}
