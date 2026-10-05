/** Equal-budget deterministic domain rows retain native execution and lesson refusals. */
import { runIdentitySchema } from '@tangleai/config';
import { importBundle } from '@tangleai/trace2skill';
import { researchSchema, researchSchemaReferences, researchValue, researchRevisionOf, lessonScopeKey } from '@tangleai/research';
import { researchExampleIdentity } from '../../examples/research.ts';
import { zeroLessonSpend } from '../../apps/research-runner/src/lessons.ts';
import { runEnvelope } from './report-envelope.ts';
import { createReportValidator } from './validate.ts';
import { RESEARCH_DOMAINS_SCHEMA } from './research-domains-schema.ts';
import { RESEARCH_LESSONS_SCHEMA } from './research-lessons-schema.ts';
import { runResearchDomainLifecycle, DOMAIN_BUDGET, type DomainRuntimeInput } from './research-domain-runtime.ts';
import { computationalDomainInput, tabularDomainInputs } from './research-domain-inputs.ts';
import { researchControlPlaneParity, probeUnsupportedResearchDomain } from './research-domain-probes.ts';
import { researchLessonFixtureProcedure, measureResearchLessonMechanism, sumLessonSpend, type LessonMechanismFixture } from './research-lessons-mechanism.ts';
import { deferredArcBenchRow } from './research-arc.ts';
import type { LoadedResearchFixture } from './research-fixture.ts';
import type { DomainMeasurementRow, DomainTopicMeasurement, ResearchDomainsReport } from './research-domains.types.ts';

export const validateResearchDomainsShape = createReportValidator(RESEARCH_DOMAINS_SCHEMA,
  [RESEARCH_LESSONS_SCHEMA, runIdentitySchema, researchSchema, ...researchSchemaReferences]);

async function measureFamily<Labels>(inputs: readonly DomainRuntimeInput<Labels>[]) {
  if (!inputs.length || inputs.some(row => row.domain.profile.revision !== inputs[0].domain.profile.revision)) throw Error('Domain family profile identity drift.');
  const { domain, scope } = inputs[0], rows: DomainMeasurementRow[] = [];
  const imported = await importBundle([{ path: 'SKILL.md', bytes: new TextEncoder().encode('# Research procedure\n\n## Evidence\n\nRetain every registered observation and every negative result.\n') }],
    { scopeKey: lessonScopeKey(scope), mode: 'deepening', origin: 'human-import', status: 'staged' });
  if (!imported.valid) throw Error('Domain procedure refused: ' + JSON.stringify(imported.issues));
  const registration = { scope, topics: inputs.map(row => ({ id: row.topic.id, sha256: row.topicHash })),
    revision: await researchRevisionOf({ scope, topics: inputs.map(row => row.topicHash), budget: DOMAIN_BUDGET }) };
  const fixture: LessonMechanismFixture = { procedure: imported.value, registration,
    beneficial: { proposal: { baseHash: imported.value.bundle.id, edit: { reasoning: 'Retain the declared metric, unit and direction before admitting observations.',
      operations: [{ op: 'insert_after', path: 'SKILL.md', anchor: '## Evidence', group: 'metric-integrity',
        content: '\nCheck the registered metric name, unit and direction before admitting any result.\n' }] } } } };
  const procedure = await researchLessonFixtureProcedure(fixture);
  const comparisonIdentity = await researchRevisionOf({ profile: domain.profile.revision, budget: DOMAIN_BUDGET,
    scope, topics: registration.topics, identity: (await researchExampleIdentity()).identityId });
  let last: DomainTopicMeasurement[] = [];
  const run = async (snapshot?: typeof procedure) => {
    last = [];
    for (const input of inputs) last.push(await runResearchDomainLifecycle(input, snapshot));
    return last;
  };
  for (const mode of ['fixed-pipeline', 'lessons-off', 'lessons-on'] as const) {
    let lesson: DomainMeasurementRow['lesson'] = null, preparation: DomainMeasurementRow['spend'] = zeroLessonSpend(), activated = false;
    let eligibilityIssues: string[] = [];
    if (mode === 'lessons-on') {
      const measured = await measureResearchLessonMechanism({ topics: inputs.map(row => row.topic) }, fixture, 'none', async snapshot =>
        (await run(snapshot)).map(row => ({ topicId: row.topicId, topicHash: row.topicHash,
          output: { claimSupport: row.claimSupport, registryAccuracy: row.registryAccuracy, preregistrationIntegrity: row.preregistrationIntegrity, completion: true },
          primary: row.claimSupport * row.registryAccuracy * row.preregistrationIntegrity, completion: true,
          spend: { ...zeroLessonSpend(), ...row.lifecycle.spend } })));
      lesson = measured.native; preparation = measured.preparationSpend; activated = measured.native.activationEventId !== null;
      eligibilityIssues = measured.eligibilityIssues;
      // The deterministic registry already enforces this correction; tied outcomes confer no activation authority.
      if (activated || lesson.code !== 'TRSH2007' || lesson.cause !== 'OUTC1011') throw Error('A tied deterministic domain correction unexpectedly acquired writeback authority.');
    } else await run(mode === 'lessons-off' ? procedure : undefined);
    rows.push({ id: ('domain:' + domain.profile.id + '/' + mode) as DomainMeasurementRow['id'], profileId: domain.profile.id, profileRevision: domain.profile.revision,
      identityStatus: 'run', comparisonIdentity, budget: DOMAIN_BUDGET, topics: last,
      spend: sumLessonSpend(preparation, ...last.map(row => ({ ...zeroLessonSpend(), ...row.lifecycle.spend }))),
      lesson, activated, eligibilityIssues, limitations: [
        'Trusted deterministic fixture programs; no generated code, network or provider model executes in the lifecycle.',
        'Metric statements are independently reproduced; this row does not measure scientific prose or literature quality.',
        'The preregistered Stop edge retains negative, inconclusive and saturated results without forcing a positive writing branch.',
        'The registry floor already enforces the proposed correction. Tied lesson outcomes retain the native approval refusal.',
        'Lesson preparation uses the existing bounded scripted proposer and counts its call and token receipts.',
      ] });
  }
  return rows;
}

export async function buildResearchDomainsReport(loaded: LoadedResearchFixture, root = process.cwd()): Promise<ResearchDomainsReport> {
  const computational = await Promise.all(loaded.topics.map(topic => computationalDomainInput(loaded, topic))), tabular = await tabularDomainInputs(root);
  const rows = [...await measureFamily(computational), ...await measureFamily(tabular)];
  const identity = await researchExampleIdentity(), parity = await researchControlPlaneParity(root);
  if (parity.profileLiterals || parity.domainComparisons) throw Error('Domain-specific control-plane code is forbidden: ' + JSON.stringify(parity));
  const report = { profiles: [computational[0].domain.profile, tabular[0].domain.profile],
    identity: runEnvelope([identity], rows.map(row => ({ rowId: row.id, identityId: identity.identityId }))), rows,
    unsupported: await probeUnsupportedResearchDomain(tabular[0].domain), parity,
    external: await deferredArcBenchRow(root),
    gate: { binding: true, controlPlane: true, registry: rows.every(row => row.topics.every(topic => topic.registryAccuracy === 1)),
      comparable: rows.every(row => Object.entries(DOMAIN_BUDGET).every(([key, limit]) => row.spend[key as keyof typeof DOMAIN_BUDGET] <= limit)) },
    limitations: ['Three authored CSV datasets, four preregistered group-difference topics, and three original computational topics; no external generalization claim.',
      'Sample variance uses n-1. Population intervals use 2000 paired bootstrap resamples of the 24 input pairs, 95%, nearest-rank quantiles and seed 17753.',
      'Seeds 1, 2 and 3 reorder the same complete CSV. They demonstrate replay, not three independent populations.',
      'The threshold-failure topic shares the positive dataset and is not an independent study. Lesson outcomes are tied, experimental writeback remains off.',
      'ARC-Bench is deferred: no manifest, submodule, licence audit or executed external slice is claimed.'] };
  const validated = validateResearchDomainsShape(report);
  if (!validated.valid) throw Error('Domain report refused: ' + JSON.stringify(validated.errors?.slice(0, 8)));
  return structuredClone(report) as ResearchDomainsReport;
}
export function renderResearchDomains(report: ResearchDomainsReport): string[] {
  return ['## Domain profiles', '',
    '| Row | Topics | Positive / negative / inconclusive / saturated | Calls / tokens / physical | Activation |',
    '| --- | ---: | --- | --- | --- |',
    ...report.rows.map(row => `| ${row.id} | ${row.topics.length} | ${['improvement', 'no-improvement', 'inconclusive', 'SATURATED']
      .map(result => row.topics.filter(topic => topic.result === result).length).join(' / ')} | ${row.spend.calls} / ${row.spend.tokens} / ${row.spend.physical} | ${row.activated ? 'on' : 'off'}${row.lesson?.code ? '; ' + row.lesson.code + ' → ' + row.lesson.cause : ''} |`), '',
    `Unsupported profile: **${report.unsupported.code}**, ${report.unsupported.modelCalls} model calls, ${report.unsupported.runnerInvocations} runner invocations.`, '',
    `Control-plane parity: **${report.parity.profileLiterals}** profile literals and **${report.parity.domainComparisons}** domain comparisons across ${report.parity.sources.length} source files; SHA-256 \`${report.parity.sourceHash}\`.`, '',
    `${report.external.id}: **${report.external.state}: ${report.external.reason}**.`, '',
    ...report.limitations.map(line => '- ' + line), '',
    '| Tabular topic | Mean A − B (points) | Paired 95% interval | Result |', '| --- | ---: | --- | --- |',
    ...report.rows.find(row => row.id === 'domain:tabular-statistics/fixed-pipeline')!.topics.map(row =>
      `| ${row.topicId} | ${row.tabular!.meanDifference.toFixed(6)} | [${row.tabular!.interval.lower.toFixed(6)}, ${row.tabular!.interval.upper.toFixed(6)}] | ${row.result} |`), '',
  ];
}
