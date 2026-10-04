/** Registered research measurements over retained executions and independently checked evidence. */
import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { sourceManifest } from './source-manifest.ts';
import { installedSuitePackages } from './suite-packages.ts';
import { analyticEnvelope } from './report-envelope.ts';
import { loadResearchFixture, RESEARCH_FIXTURE_PATH, MANIFEST_PATH, type LoadedResearchFixture } from './research-fixture.ts';
import { researchCeilings, researchScore, verifyResearchBundle } from './research-oracle.ts';
import { runNativeResearchFixture } from './research-workflow.ts';
import { runResearchReasoningFixture } from './research-reasoning.ts';
import { runResearchExecutionFixture, aggregateResearchExecution } from './research-execution.ts';
import { probeResearchExecutionRefusal } from './research-execution-fixture.ts';
import { requireResearchShape } from './research-validation.ts';
import { researchComparison, researchMechanicalDecision } from './research-evaluator.ts';
import { RESEARCH_ROW_IDS, RESEARCH_DIMENSIONS, RESEARCH_DISCLOSURES, RESEARCH_REASONING_DIMENSIONS } from './research-schema.ts';
import { validateResearchReportShape } from './research-validation.ts';
import { describeErrors } from './validate.ts';
import { table as markdownTable } from './table.ts';
import type { ResearchReport, ResearchBundle, ResearchFixtureTopic, ResearchTopicResult, ResearchMeasuredRow, ResearchScore,
  ResearchReasoningRow, ResearchReasoningTopic, ResearchModelUsage, ResearchExecutionTopic, ResearchExecutionRow, ResearchExecutionRefusalFixture } from './research.types.ts';

export { MANIFEST_PATH };
export const REPORT_PATH = 'benchmark/results/research.json';
export const DOCUMENT_PATH = 'docs/RESEARCH_BENCHMARK.md';
export const SOURCE_MANIFEST = [
  'package.json', 'package-lock.json', 'benchmark/research.ts', MANIFEST_PATH,
  'benchmark/scripts/research-fixtures.ts', 'scripts/research-schema.ts',
  'benchmark/lib/research.ts', 'benchmark/lib/research-schema.ts', 'benchmark/lib/research.types.ts',
  'benchmark/lib/research-fixture.ts', 'benchmark/lib/research-programs.ts', 'benchmark/lib/research-evaluator.ts',
  'benchmark/lib/research-oracle.ts', 'benchmark/lib/research-runner.ts', 'benchmark/lib/research-validation.ts',
  'benchmark/lib/research-workflow.ts', 'benchmark/lib/research-lifecycle-fixture.ts', 'examples/research.ts',
  'benchmark/lib/research-discovery.ts', 'benchmark/lib/research-discovery-fixture.ts', 'benchmark/scripts/research-transcripts.ts',
  'benchmark/lib/research-reasoning.ts', 'benchmark/lib/research-reasoning-fixture.ts', 'scripts/research-artifacts.ts', 'scripts/research-sources.ts',
  'benchmark/lib/research-execution.ts', 'benchmark/lib/research-execution-fixture.ts',
  'benchmark/lib/args.ts', 'benchmark/lib/validate.ts', 'benchmark/lib/source-manifest.ts',
  'benchmark/lib/suite-packages.ts', 'benchmark/lib/report-envelope.ts', 'benchmark/lib/table.ts',
  'packages/research/schemas/research.schema.json', 'benchmark/schemas/research.schema.json',
] as const;
export interface ResearchContext {
  loaded: LoadedResearchFixture;
  source: ResearchReport['source'];
  suite: ResearchReport['suite'];
}
export async function researchContext(root = process.cwd()): Promise<ResearchContext> {
  const loaded = await loadResearchFixture(root);
  return { loaded, source: await sourceManifest(root, [...SOURCE_MANIFEST,
    ...loaded.manifest.members.map(member => RESEARCH_FIXTURE_PATH + '/' + member.path)],
  [RESEARCH_FIXTURE_PATH, 'packages/core', 'packages/models', 'packages/documents', 'packages/search', 'packages/context', 'packages/config',
    'packages/jaren', 'packages/research', 'packages/gmpl', 'packages/mas', 'packages/store', 'packages/agents', 'packages/evolve']),
  suite: await installedSuitePackages(root, ['core', 'models', 'documents', 'search', 'context', 'config', 'research', 'gmpl', 'mas', 'store', 'agents', 'evolve']) };
}
const same = (left: unknown, right: unknown): boolean => canonicalizeJson(left) === canonicalizeJson(right);
const ratio = (values: readonly boolean[]): ResearchScore => researchScore(values.filter(Boolean).length, values.length);
export async function scoreResearchBundle(loaded: LoadedResearchFixture, topic: ResearchFixtureTopic, bundle: ResearchBundle,
  probes: ResearchReport['bundles']): Promise<ResearchTopicResult> {
  const verification = await verifyResearchBundle(loaded, bundle), hidden = loaded.hidden.get(topic.id)!;
  const expectedRuns = topic.plan.conditions.length * topic.contract.replicatePolicy.seeds.length;
  const relevant = new Set(hidden.relevantLiterature), selected = new Set(bundle.literature);
  const supported = new Set(verification.supported);
  const citationClaims = hidden.requiredClaims.filter(claim => claim.literatureId !== null);
  const registeredProbe = (id: string) => probes.some(probe => probe.id === id && probe.refusedAsRegistered);
  const comparison = researchComparison(topic, bundle.observations);
  const correctDecision = same(bundle.decision, researchMechanicalDecision(topic, bundle.observations));
  const approved = (gate: string) => verification.valid && bundle.interventions.some(action => action.gate === gate && action.actor !== 'timeout'
    && action.action === 'approve' && action.reviewedManifestHash === bundle.manifest.manifestHash
    && action.approvedManifestHash === bundle.manifest.manifestHash);
  const strictFailures = verification.issues;
  return {
    topicId: topic.id, bundleHash: await canonicalSha256(bundle), bundle: structuredClone(bundle), observations: structuredClone(bundle.observations),
    claimsExpected: hidden.requiredClaims.map(claim => claim.id), claimsSupported: verification.supported, verificationIssues: strictFailures,
    preregistrationIntegrity: ratio([same(bundle.contract, topic.contract), same(bundle.plan, topic.plan), bundle.manifest.frozenBeforeResults]),
    literatureRecall: researchScore([...selected].filter(id => relevant.has(id)).length, relevant.size),
    literaturePrecision: researchScore([...selected].filter(id => relevant.has(id)).length, selected.size),
    citationIdentity: ratio(citationClaims.map(claim => supported.has(claim.id)
      && bundle.claims.some(actual => actual.id === claim.id && actual.literatureIds.includes(claim.literatureId!)))),
    claimSupport: ratio(hidden.requiredClaims.map(claim => supported.has(claim.id))),
    registryAccuracy: researchScore(verification.rerun.passed, expectedRuns),
    rerunRate: researchScore(verification.rerun.passed, expectedRuns),
    confoundDetection: ratio([registeredProbe('confound')]),
    negativeResultHandling: ratio([correctDecision && (hidden.registeredTruth !== 'SATURATED'
      || (comparison.result === 'SATURATED' && bundle.decision.kind === 'Stop'))]),
    branchSelectionCompliance: ratio(['underpowered', 'best-of-n-undeclared'].map(id => registeredProbe(id)
      && same(bundle.contract.selectionRule, topic.contract.selectionRule))),
    gateBehaviour: ratio(['literature', 'design', 'quality'].map(approved)),
    tracesCompleteness: researchScore(bundle.runs.filter(run => run.trace.length === 2 && run.trace[0].event === 'start'
      && run.trace[0].detail === run.programId && run.trace[1].event === 'output' && run.trace[1].detail === run.rawArtifactHash).length,
    expectedRuns),
    interventions: { total: bundle.interventions.length, substantive: bundle.interventions.filter(action => action.substantive).length,
      approvals: bundle.interventions.filter(action => action.action === 'approve' && approved(action.gate)).length },
    cost: bundle.runs.reduce((cost, run) => ({ calls: cost.calls + run.spend.calls, tokens: cost.tokens + run.spend.tokens,
      ms: cost.ms + run.spend.ms, physical: cost.physical + run.spend.physical }), { calls: 0, tokens: 0, ms: 0, physical: 0 }),
    failures: { program: bundle.runs.filter(run => run.status === 'failed').length, verification: strictFailures.length,
      leakage: strictFailures.filter(issue => issue.path.startsWith('/plan/inputPaths')).length,
      confound: strictFailures.filter(issue => issue.path === '/contract/splits').length,
      budget: strictFailures.filter(issue => issue.code === 'TRSH1010').length,
      provider: bundle.runs.filter(run => run.spend.physical > 0 && run.status === 'failed').length,
      unsupported: hidden.requiredClaims.filter(claim => !supported.has(claim.id)).length },
    completion: ratio([bundle.runs.length === expectedRuns && bundle.observations.length === expectedRuns && correctDecision]),
    result: verification.valid ? comparison.result : 'failed', workflow: null, completePathControl: null,
  };
}
function aggregate(id: typeof RESEARCH_ROW_IDS[number], topics: ResearchTopicResult[]): ResearchMeasuredRow {
  const scores = Object.fromEntries([...RESEARCH_DIMENSIONS, 'completion' as const].map(name => [name,
    researchScore(topics.reduce((sum, topic) => sum + topic[name].passed, 0), topics.reduce((sum, topic) => sum + topic[name].total, 0))])) as
    Pick<ResearchMeasuredRow, typeof RESEARCH_DIMENSIONS[number] | 'completion'>;
  const sum = (pick: (topic: ResearchTopicResult) => number) => topics.reduce((sum, topic) => sum + pick(topic), 0);
  return { id, state: 'measured', scope: 'full-lifecycle', topics, ...scores,
    cost: { calls: sum(topic => topic.cost.calls), tokens: sum(topic => topic.cost.tokens),
      ms: sum(topic => topic.cost.ms), physical: sum(topic => topic.cost.physical) },
    failures: { program: sum(topic => topic.failures.program), verification: sum(topic => topic.failures.verification),
      leakage: sum(topic => topic.failures.leakage), confound: sum(topic => topic.failures.confound), budget: sum(topic => topic.failures.budget),
      provider: sum(topic => topic.failures.provider), unsupported: sum(topic => topic.failures.unsupported) },
    interventions: { total: sum(topic => topic.interventions.total), substantive: sum(topic => topic.interventions.substantive),
      approvals: sum(topic => topic.interventions.approvals) } };
}
function aggregateReasoning(id: ResearchReasoningRow['id'], topics: ResearchReasoningTopic[]): ResearchReasoningRow {
  const sum = (pick: (topic: ResearchReasoningTopic) => number) => topics.reduce((total, topic) => total + pick(topic), 0);
  const scores = Object.fromEntries(RESEARCH_REASONING_DIMENSIONS.map(name => [name,
    researchScore(sum(topic => topic[name].passed), sum(topic => topic[name].total))])) as Pick<ResearchReasoningRow, typeof RESEARCH_REASONING_DIMENSIONS[number]>;
  const usage = Object.fromEntries(Object.keys(topics[0].usage).map(key => [key, sum(topic => topic.usage[key as keyof ResearchModelUsage])])) as unknown as ResearchModelUsage;
  return { id, state: 'measured', scope: 'pre-execution', topics, ...scores, usage,
    cost: { calls: sum(t => t.cost.calls), tokens: sum(t => t.cost.tokens), ms: sum(t => t.cost.ms), physical: sum(t => t.cost.physical) },
    failures: { program: sum(t => t.failures.program), verification: sum(t => t.failures.verification), leakage: sum(t => t.failures.leakage),
      confound: sum(t => t.failures.confound), budget: sum(t => t.failures.budget), provider: sum(t => t.failures.provider), unsupported: sum(t => t.failures.unsupported) },
    interventions: { total: sum(t => t.interventions.total), substantive: sum(t => t.interventions.substantive), approvals: sum(t => t.interventions.approvals) } };
}
function oracleAtCeilings(report: Pick<ResearchReport, 'rows' | 'ceilings'>): boolean {
  const oracle = report.rows.find(row => row.id === 'artifact-oracle');
  return oracle?.state === 'measured' && oracle.scope === 'full-lifecycle' && oracle.topics.every(topic => {
    const ceiling = report.ceilings.find(ceiling => ceiling.topicId === topic.topicId)!;
    return RESEARCH_DIMENSIONS.every(dimension => topic[dimension].value === (dimension === 'literatureRecall' ? ceiling.literatureRecall.value : 1))
      && topic.completion.value === 1 && Object.values(topic.failures).every(count => count === 0);
  });
}
function disclosures(rows: ResearchReport['rows']): ResearchReport['disclosure'] {
  return rows.map((row, rowIndex) => ({ rowId: row.id, items: RESEARCH_DISCLOSURES.map((item, index) => {
    if (row.state === 'measured' && row.scope === 'execution') {
      const pointer = item === 'runnable-implementation' ? '/plan/conditions' : item === 'reconstructible-execution' ? '/manifests'
        : item === 'attempt-selection-registration' ? '/contract/selectionRule' : item === 'baseline-audit' ? '/contract/requiredBaselines'
          : item === 'independent-verification' ? '/observations' : item === 'frozen-hypotheses' ? '/plan/hypothesisHash' : null;
      return { item, satisfied: pointer !== null, evidence: pointer === null ? [] : row.topics.map((_topic, index) => '/rows/' + rowIndex + '/topics/' + index + pointer) };
    }
    if (row.state === 'measured' && row.scope === 'pre-execution') {
      const pointer = item === 'novelty-audit' ? '/novelty' : item === 'attempt-selection-registration' ? '/contract/selectionRule'
        : item === 'baseline-audit' ? '/contract/requiredBaselines' : item === 'independent-verification' ? '/probes'
          : item === 'frozen-hypotheses' ? '/hypotheses' : null;
      return { item, satisfied: pointer !== null, evidence: pointer === null ? [] : row.topics.map((_topic, index) => '/rows/' + rowIndex + '/topics/' + index + pointer) };
    }
    const satisfied = row.state === 'measured' && row.topics.every(topic => topic.bundle.disclosure[index].satisfied);
    return { item, satisfied, evidence: !satisfied || row.state !== 'measured' ? [] : row.topics.flatMap((topic, topicIndex) =>
      topic.bundle.disclosure[index].evidence.map(pointer => '/rows/' + rowIndex + '/topics/' + topicIndex + '/bundle' + pointer)) };
  }) }));
}
export const RESEARCH_LIMITATIONS = [
  'All data, literature and provider transcripts are authored synthetic MIT fixtures. Identifiers do not describe real publications.',
  'Scripted conformance is not live research quality. The oracle can read hidden labels; the no-model program inputs contain features and queries only.',
  'Oracle review disclosures are scripted whole-bundle structural probes. Native lifecycle approvals are scripted interactions over the artifact set available at each gate; none establishes actual human participation.',
  'The scientific no-model paths retain both Stop decisions, hence seven of nine possible approvals. Separate complete-path controls reach all three gates for each topic and make no scientific decision claim.',
  'The pure-program bundle retains its original null provider identity and no approvals. The enclosing native workflow binds a recomputable synthetic CONFIG identity; no provider endpoint is called.',
  'Claim support uses fixed authored propositions and numeric bindings, not a general entailment or novelty detector. Omitted required claims remain in the denominator.',
  'Confound detection and branch compliance measure the shared verifier against registered corrupted bundles, not an autonomous scientific judgement.',
  'Model requests use the in-process scripted-v1 client. Its authored 7 prompt / 3 completion token receipts test accounting, not tokenizer efficiency. External provider requests remain zero; local CPU latency and monetary cost are unmeasured.',
  'Clustering uses five fixed seed pairs. Retrieval has one deterministic pair on eight queries; its degenerate interval is not population-level statistical evidence.',
  'Every comparison retains ties and losses. A confidence interval touching zero does not establish improvement; saturated results stop without threshold changes.',
  'Completion in full-lifecycle rows records reaching the registered decision, not overall research quality. Reasoning rows stop at the real design gate and make no execution, result, writing or completion claim.',
  'The paired reasoning rows see the same eight of sixteen committed cards per topic, selected deterministically by first element per source. Seven compiled packs execute in debate; three execute in single-agent.',
  'Reasoning refusal counts are direct independent-verifier probes over four frozen bad proposals, with zero model calls. They measure validator sensitivity, not a model identifying or repairing a bad plan. Separate native integration tests exercise model-path refusals and repair accounting.',
  'Execution comparisons use a separate preregistered control with three allowed clustering attempts. Both arms run the same single-agent model stages in one native workflow; only the branch arm follows Refine twice. Those choices are scripted controls, not a learned or statistically justified selector.',
  'Execution retains all attempts and every seed, including unchanged repetitions. It claims neither additional independent evidence from repeats nor a scientific advantage from branching. The original one-attempt topic registrations and pre-execution model rows are preserved.',
  'Fixture execution maps registered ids to trusted pure functions and reports isolation.verified=false. Its image identity identifies the fixture program manifest, not a locally installed container. Wall and CPU cost are unmeasured in deterministic rows; physical experiment dispatch and separate verification reruns are counted.',
  'Program failure and cancellation probes include their own complete native model, experiment and verification costs. Container smoke timing and platform qualification are separate operational receipts and never enter the deterministic report.',
] as const;
export async function buildReport(options: { context?: ResearchContext; rows?: readonly string[] } = {}): Promise<ResearchReport> {
  const context = options.context ?? await researchContext(), { loaded } = context;
  const selected = options.rows ?? RESEARCH_ROW_IDS;
  if (selected.length === 0 || new Set(selected).size !== selected.length || selected.some(id => !RESEARCH_ROW_IDS.some(row => row === id)))
    throw new TypeError('Research rows must be a nonempty unique subset of registered ids.');
  const bundles: ResearchReport['bundles'] = [];
  for (const registered of loaded.invalid) {
    const verified = await verifyResearchBundle(loaded, registered.bundle), first = verified.issues[0];
    const observed = first ? { code: first.code, path: first.path } : null;
    bundles.push({ id: registered.id, expected: structuredClone(registered.expected), observed,
      refusedAsRegistered: !verified.valid && same(registered.expected, observed) });
  }
  for (const registered of loaded.manifest.execution.refusals) {
    const fixture = requireResearchShape<ResearchExecutionRefusalFixture>('ResearchExecutionRefusalFixture', JSON.parse(new TextDecoder().decode(loaded.files.get(registered.path)!)));
    if (fixture.id !== registered.id || !same(fixture.expected, registered.expected)) throw Error('Execution refusal registration drift.');
    bundles.push(await probeResearchExecutionRefusal(loaded, fixture));
  }
  const rows: ResearchReport['rows'] = [];
  const discovery: ResearchReport['discovery'] = [];
  const execution: ResearchReport['execution'] = { registrationHash: await canonicalSha256(JSON.parse(new TextDecoder().decode(loaded.files.get(loaded.manifest.execution.registration)!))),
    control: null, failureProbes: [] };
  const identity = analyticEnvelope(RESEARCH_ROW_IDS), sourceRevision = await canonicalSha256(context.source.files);
  for (const id of RESEARCH_ROW_IDS) {
    if (!selected.includes(id)) { rows.push({ id, state: 'not-run', reason: 'Excluded by the explicit row selection.' }); continue; }
    if (id === 'fixed-plus-branching') {
      const control: ResearchExecutionTopic[] = [], branching: ResearchExecutionTopic[] = [];
      for (const topic of loaded.topics) {
        for (const mode of ['control', 'branching'] as const) {
          const result = await runResearchExecutionFixture(loaded, topic, mode);
          (mode === 'control' ? control : branching).push(result.execution!);
          if (!identity.identities.some(row => row.identityId === result.identity.identityId)) identity.identities.push(result.identity);
          identity.rows = identity.rows.map(row => row.rowId === id ? { rowId: id, identityStatus: 'run', identityId: result.identity.identityId } : row);
        }
      }
      execution.control = aggregateResearchExecution('fixed-single-agent', control);
      rows.push(aggregateResearchExecution(id, branching));
      for (const probe of ['program-throw', 'cancelled'] as const) execution.failureProbes.push({ id: probe,
        topic: (await runResearchExecutionFixture(loaded, loaded.topics[0], probe)).execution! });
      continue;
    }
    if (id === 'fixed-single-agent' || id === 'fixed-plus-debate') {
      const topics: ResearchReasoningTopic[] = [];
      for (const topic of loaded.topics) {
        const result = await runResearchReasoningFixture(loaded, topic, id === 'fixed-single-agent' ? 'single-agent' : 'debate');
        topics.push(result.measurement);
        if (!identity.identities.some(row => row.identityId === result.identity.identityId)) identity.identities.push(result.identity);
        identity.rows = identity.rows.map(row => row.rowId === id ? { rowId: id, identityStatus: 'run', identityId: result.identity.identityId } : row);
      }
      rows.push(aggregateReasoning(id, topics)); continue;
    }
    if (id !== 'artifact-oracle' && id !== 'no-model-runner') {
      rows.push({ id, state: 'implementation-missing', reason: 'Registered research mechanism has not been implemented or measured.' }); continue;
    }
    const topics: ResearchTopicResult[] = [];
    for (const topic of loaded.topics) {
      if (id === 'artifact-oracle') topics.push(await scoreResearchBundle(loaded, topic, loaded.oracles.get(topic.id)!, bundles));
      else {
        const science = await runNativeResearchFixture(loaded, topic, sourceRevision);
        if (!science.discovery) throw Error('Scientific lifecycle omitted discovery evidence.');
        discovery.push(science.discovery);
        const control = await runNativeResearchFixture(loaded, topic, sourceRevision, 'complete-path-control');
        const scored = await scoreResearchBundle(loaded, topic, science.bundle!, bundles);
        const actions = science.measurement.interactions.map(i => i.response as { decision: string; note: string });
        topics.push({ ...scored, workflow: science.measurement, completePathControl: control.measurement,
          gateBehaviour: science.measurement.gateBehaviour, interventions: { total: actions.length,
            substantive: actions.filter(a => a.note.trim().length > 0).length, approvals: actions.filter(a => a.decision === 'approve').length } });
        if (!identity.identities.some(row => row.identityId === science.identity.identityId)) identity.identities.push(science.identity);
        identity.rows = identity.rows.map(row => row.rowId === id ? { rowId: id, identityStatus: 'run', identityId: science.identity.identityId } : row);
      }
    }
    rows.push(aggregate(id, topics));
  }
  const ceilings = loaded.topics.map(topic => researchCeilings(loaded, topic));
  const gate = { registration: true, oracle: oracleAtCeilings({ rows, ceilings }),
    bundles: bundles.every(bundle => bundle.refusedAsRegistered), networkCalls: 0 as const };
  const payload: Omit<ResearchReport, 'reportId'> = { benchmark: 'research', schemaVersion: 1, source: context.source, suite: context.suite,
    registration: { id: loaded.manifest.id, revision: loaded.manifest.revision, topics: loaded.topics.map(topic => topic.id),
      caps: loaded.manifest.caps, replicatePolicy: loaded.manifest.replicatePolicy,
      bundles: [...loaded.manifest.bundles, ...loaded.manifest.execution.refusals].map(bundle => ({ id: bundle.id, expected: structuredClone(bundle.expected) })) },
    identity, ceilings, rows, discovery, execution, bundles, disclosure: disclosures(rows), gate,
    decision: gate.registration && gate.oracle && gate.bundles ? 'conformant' : 'drift', limitations: [...RESEARCH_LIMITATIONS] };
  const report = { ...payload, reportId: await canonicalSha256(payload) };
  const validated = validateResearchReportShape(report);
  if (!validated.valid) throw new Error('Research report shape refused: ' + describeErrors(validated, 12).join('; '));
  return structuredClone(report);
}
/** Re-execute the registered inputs; a rehashed forged score or gate cannot validate. */
export async function validateResearchReport(value: unknown, context?: ResearchContext): Promise<boolean> {
  if (!validateResearchReportShape(value).valid) return false;
  const report = value as ResearchReport, current = context ?? await researchContext();
  const { reportId, ...payload } = report;
  if (reportId !== await canonicalSha256(payload) || !same(report.source.files, current.source.files) || !same(report.suite, current.suite)
    || report.source.sha256 !== await canonicalSha256({ head: report.source.head, files: report.source.files })) return false;
  const rebuilt = await buildReport({ context: { ...current, source: report.source },
    rows: report.rows.filter(row => row.state !== 'not-run').map(row => row.id) });
  return same(rebuilt, report);
}
export function renderReport(report: ResearchReport): string { return JSON.stringify(report, null, 2) + '\n'; }
const table = (head: string[], rows: Array<Array<string | number>>) => markdownTable({ head, rows });
export function renderDocument(report: ResearchReport): string {
  const measured = report.rows.filter((row): row is ResearchMeasuredRow => row.state === 'measured' && row.scope === 'full-lifecycle');
  const reasoning = report.rows.filter((row): row is ResearchReasoningRow => row.state === 'measured' && row.scope === 'pre-execution');
  const executions: ResearchExecutionRow[] = [...(report.execution.control ? [report.execution.control] : []),
    ...report.rows.filter((row): row is ResearchExecutionRow => row.state === 'measured' && row.scope === 'execution')];
  const score = (value: ResearchScore) => value.passed + '/' + value.total + ' (' + value.value.toFixed(3) + ')';
  const comparisons = measured.flatMap(row => row.topics.map(topic => {
    const comparison = researchComparison(topic.bundle, topic.observations);
    return [row.id, topic.topicId, topic.bundle.contract.replicatePolicy.seeds.join(', '), comparison.baselineMean.toFixed(6),
      comparison.candidateMean.toFixed(6), comparison.interval.estimate.toFixed(6),
      '[' + comparison.interval.lower.toFixed(6) + ', ' + comparison.interval.upper.toFixed(6) + ']',
      comparison.wins + '/' + comparison.losses + '/' + comparison.ties, topic.result, topic.bundle.decision.kind];
  }));
  return [
    '# Research benchmark', '', 'Generated by `npm run benchmark:research`. Report `' + report.reportId + '`.', '',
    'Registration `' + report.registration.id + '` / `' + report.registration.revision + '`. Source `' + report.source.sha256 + '`.', '',
    'Three topics, eight registered rows and ' + report.bundles.length + ' adversarial bundles. Decision: **' + report.decision + '**. External provider requests: **0**.', '',
    '## Analytic ceilings', '', 'Each topic has eight relevant sources; two are deliberately absent. Recovering all six available sources has recall 0.750, not 1.', '',
    table(['Topic', 'Literature recall', 'Precision', 'Citation identity', 'Registry accuracy'], report.ceilings.map(topic =>
      [topic.topicId, score(topic.literatureRecall), score(topic.literaturePrecision), score(topic.citationIdentity), score(topic.registryAccuracy)])), '',
    '## Scholarly discovery replay', '',
    'The frozen metadata reviewer requires the topic title term, a supplied 2026 publication date and a resolvable source. It never receives gold labels. All eight returned papers pass that metadata rule: six are relevant, two are irrelevant, and two other relevant papers are absent. The oracle precision ceiling is 1; measured discovery precision is 0.75.', '',
    table(['Topic', 'Recall / ceiling', 'Precision / ceiling', 'Absent relevant', 'Identity merges', 'Fallback merges / refused', 'Complete / incomplete / refused providers', 'Replay requests / misses / network', 'Cards resolved / total'], report.discovery.map(row => [
      row.topicId, score(row.literatureRecall) + ' / 0.750', score(row.literaturePrecision) + ' / 1.000', row.absentRelevant,
      row.receipt.dedupe.identityMerges, row.receipt.dedupe.fallbackMerges.filter(m => m.status === 'merged').length + ' / ' + row.receipt.dedupe.distinctPreserved,
      row.providerOutcomes.complete + ' / ' + row.providerOutcomes.incomplete + ' / ' + row.providerOutcomes.refused,
      row.replay.requests + ' / ' + row.replay.misses + ' / ' + row.replay.networkCalls,
      row.cards.resolvable + ' / ' + row.cards.total])), '',
    table(['Topic', 'HTTP ok', 'Failed', 'Admission refused', 'Unresolved', 'Cancelled', 'Rate-limited failures'], report.discovery.map(row => [
      row.topicId, row.providerOutcomes.counts.ok, row.providerOutcomes.counts.failed, row.providerOutcomes.counts.refused,
      row.providerOutcomes.counts.unresolved, row.providerOutcomes.counts.cancelled, row.providerOutcomes.counts.rateLimited])), '',
    'CREATE commits the content-addressed query plan and criteria before the first request. Three JSON adapters use native provider descriptors; arXiv uses native attempts and one bounded Atom reader. SearxNG snippets remain candidates. Full source bodies and native document-version locators support the cards; chunk rows are not required. Receipts retain raw response hashes, native observations, normalized records, screening decisions and acquisition failures.', '',
    '## Registered rows', '', table(['Row', 'State', 'Claim support', 'Completion', 'Unsupported claims', 'Approvals'], report.rows.map(row =>
      row.state === 'measured' && row.scope === 'full-lifecycle' ? [row.id, row.state, score(row.claimSupport), score(row.completion), row.failures.unsupported, row.interventions.approvals]
        : row.state === 'measured' ? [row.id, row.state + ': ' + row.scope, 'not measured', row.scope === 'execution' ? 'not evaluated' : 'not executed', 'not measured', row.interventions.approvals]
        : [row.id, row.state, '—', '—', '—', '—'])), '',
    ...measured.flatMap(row => ['### ' + row.id, '', table(['Dimension', ...row.topics.map(topic => topic.topicId), 'Pooled counts'],
      RESEARCH_DIMENSIONS.map(dimension => [dimension, ...row.topics.map(topic => score(topic[dimension])), score(row[dimension])])), '']),
    '## Synthesis, hypotheses and preregistration', '',
    'Both model rows execute inside one durable research MAS run per topic and wait at the actual design gate. They share visible cards, constraints, provider replay, scripted model identity and registered caps. Every generated hypothesis has a null, disconfirming observation, confound and baseline. The contract and plan activate in the same atomic stage commit before any experiment or observation exists.', '',
    table(['Row', 'Topic', 'Hypotheses valid', 'Evidence linked', 'Design checks', 'Hidden isolation', 'Refusals matched', 'Visible / available cards'],
      reasoning.flatMap(row => row.topics.map(topic => [row.id, topic.topicId, score(topic.hypothesisValidity), score(topic.evidenceLinkage),
        score(topic.designIntegrity), score(topic.hiddenIsolation), score(topic.refusalConformance), topic.visibleCardIds.length + ' / ' + topic.availableCards]))), '',
    table(['Row', 'Topic', 'Roles', 'Completion', 'Normalization', 'Repair', 'Physical calls', 'Tokens', 'Serialized trace bytes'],
      reasoning.flatMap(row => row.topics.map(topic => [row.id, topic.topicId, topic.usage.roles, topic.usage.completion, topic.usage.normalization,
        topic.usage.repair, topic.cost.physical, topic.cost.tokens, topic.usage.traceBytes]))), '',
    'The fixed scripted proposals tie on these validity and refusal dimensions; debate costs more model calls and tokens. This establishes fixture conformance, not a quality advantage for either architecture. Refusal counts below come from the independent verifier after the valid native run; no extra model requests are attributed to those probes.', '',
    table(['Row', 'Topic', 'Probe', 'Kind', 'Observed code', 'Pointer', 'Model calls'], reasoning.flatMap(row => row.topics.flatMap(topic => topic.probes.map(probe =>
      [row.id, topic.topicId, probe.id, probe.kind, probe.observed?.code ?? 'none', '`' + (probe.observed?.path ?? '') + '`', probe.calls])))), '',
    table(['Row', 'Topic', 'Novelty queries complete / attempted / total', 'Identifier overlaps', 'Advisory', 'Gating', 'Replay requests / network'],
      reasoning.flatMap(row => row.topics.map(topic => [row.id, topic.topicId, topic.novelty.coverage.complete + ' / ' + topic.novelty.coverage.attempted + ' / ' + topic.novelty.coverage.total,
        topic.novelty.overlapLiteratureIds.length, topic.novelty.advisory.rating, String(topic.novelty.gating), topic.noveltyReplay.requests + ' / ' + topic.noveltyReplay.networkCalls]))), '',
    'Novelty queries come from the hypotheses themselves. Their exact QueryPlan is stored before adapter dispatch. Coverage and identifier overlap are observations; the scripted model rating is advisory and never grants approval. Generated-plan execution requires a separately bound executor; approving the gate without one fails closed.', '',
    '## Manifest-bound execution', '',
    'The matched execution control starts a fresh single-agent workflow and continues through its design approval. The branch arm uses the same cards, scripted proposals, programs, parameters, seeds, resource caps and evaluator. Both preregister up to three clustering attempts before results; the control stops after one, while branching follows Refine twice then Stop. All other topics stop after one attempt. No seed, threshold or result selects those scripted choices.', '',
    table(['Row', 'Topic', 'Attempts', 'Runs / planned', 'Rerun rate', 'Registry accuracy', 'Failed / partial', 'Model calls / tokens', 'Model + experiment physical', 'Verification physical'], executions.flatMap(row => row.topics.map(topic => [
      row.id, topic.topicId, topic.branches.length, topic.runs.length + ' / ' + topic.expectedRuns, score(topic.rerunRate), score(topic.registryAccuracy),
      topic.failures.program + ' / ' + topic.partialBranches, topic.cost.calls + ' / ' + topic.cost.tokens, topic.cost.physical, topic.rerunCost.physical]))), '',
    'Reruns consume each complete frozen manifest and reproduce raw bytes and independently registered values. Repeating unchanged seeds adds cost, not independent evidence or a demonstrated improvement. Every branch, output inventory and failed run remains in the report. The original pre-execution comparison above retains its own scope and costs.', '',
    table(['Failure probe', 'Retained runs / planned', 'Observations', 'Stop reasons', 'Failed / partial', 'Model calls / tokens', 'Total physical', 'Verification physical'], report.execution.failureProbes.map(({ id, topic }) => [
      id, topic.runs.length + ' / ' + topic.expectedRuns, topic.observations.length, [...new Set(topic.runs.map(row => row.stopReason))].join(', '),
      topic.failures.program + ' / ' + topic.partialBranches, topic.cost.calls + ' / ' + topic.cost.tokens, topic.cost.physical, topic.rerunCost.physical])), '',
    table(['Isolation refusal', 'Expected', 'Observed', 'Count', 'Executor calls'], report.bundles.filter(row => ['escape-path', 'secret-read', 'network-during-measured', 'resource-cap', 'writable-evaluator'].includes(row.id))
      .map(row => [row.id, row.expected.code, row.observed?.code ?? 'none', row.refusedAsRegistered ? 1 : 0, 0])), '',
    '## Durable lifecycle controls', '',
    'Scientific paths execute the registered programs at EXECUTE and independently evaluate their retained outputs at ANALYZE. Every StageAttempt retains its input manifest, content-addressed artifact admissions and native MAS path. Approvals bind the artifact set that existed at that gate; early approvals never claim to review future outputs.', '',
    table(['Topic', 'Science state', 'Science gates', 'Complete-path control', 'Control gates', 'Duplicate responses replayed'],
      measured.flatMap(row => row.topics.filter(t => t.workflow && t.completePathControl).map(t => [t.topicId, t.workflow!.state.status,
        score(t.workflow!.gateBehaviour), t.completePathControl!.state.status, score(t.completePathControl!.gateBehaviour),
        t.workflow!.duplicateResponses + t.completePathControl!.duplicateResponses]))), '',
    'The complete-path controls are separately labelled scripted topology checks. They neither replace a scientific Stop with Proceed nor count a quality approval on a stopped science run. The three controls reach 9/9 gates; the scientific runs retain 7/9. All responses are scripted. ' + report.rows.filter(row => row.state === 'implementation-missing').length + ' registered mechanisms remain implementation-missing.', '',
    '## Retained comparisons', '', 'Favorable differences use baseline minus candidate for inertia and candidate minus baseline for recall. Paired bootstrap: 2,000 resamples, seed 17753, 95%, nearest-rank. No seed or threshold was selected after execution.', '',
    table(['Row', 'Topic', 'Seeds', 'Baseline', 'Candidate', 'Favorable difference', 'Interval', 'Win/loss/tie', 'Result', 'Decision'], comparisons), '',
    'K-means++ is seed-deterministic. Its lower mean does not clear the positive-interval rule: two seeds win and three tie, so the result is inconclusive and stops. BM25+ wins this synthetic lexical comparison. Hash widths 64 and 256 both reach recall@5 of 1: SATURATED, with no improvement claimed.', '',
    '## Adversarial bundles', '', table(['Bundle', 'Expected code', 'Expected path', 'Observed code', 'Observed path', 'Matches'], report.bundles.map(bundle =>
      [bundle.id, bundle.expected.code, '`' + bundle.expected.path + '`', bundle.observed?.code ?? 'none',
        bundle.observed ? '`' + bundle.observed.path + '`' : '—', String(bundle.refusedAsRegistered)])), '',
    '## Disclosure', '', table(['Row', ...RESEARCH_DISCLOSURES], report.disclosure.map(row => [row.rowId, ...row.items.map(item => item.satisfied ? 'yes' : 'no')])), '',
    'Evidence pointers in the JSON resolve to retained bundle artifacts. Human review, runnable implementation, reconstructible execution, novelty audit and baseline audit follow the five measured categories in [the research survey](https://arxiv.org/html/2608.05179#S14Table10). Independent verification, attempt/selection registration and frozen hypotheses are additional operational requirements. No external study rates are reproduced.', '',
    '## Reproduce', '', 'Run `npm run benchmark:research` and `npm run benchmark:research -- --check`. `--rows artifact-oracle` retains seven explicit not-run rows. `--require registration`, `--require oracle` or `--require bundles` refuses a failed gate before writing. `--out PATH` writes JSON and a sibling `PATH.md`; `--check --out PATH` checks those files without writing.', '',
    '## Limits', '', ...report.limitations.map(text => '- ' + text), '',
    'Installed identities: ' + report.suite.packages.map(pkg => '`' + pkg.name + '@' + pkg.version + '`').join(', ') + '.', '',
  ].join('\n');
}
