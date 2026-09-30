/** Preregistered orchestration measurements. Gold never enters role inputs. */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import {equalsJson} from '@jarenjs/core/object';
import { mulberry32, randomInt } from '@jarenjs/core/random';
import { createOfflineEmbedder } from '@tangleai/pipeline';
import { recallByEmbedding } from '@tangleai/memory';
import { gmplTextDigest, type GmplInput } from '@tangleai/gmpl';
import type { IdentityEnvelope } from '@tangleai/config';
import { assertTaskSplit } from '@tangleai/hera';
import { loadLocomo, SCORABLE_CATEGORIES, INIT_COMMAND, type LoadOutcome } from './locomo.ts';
import { conversationCorpus, transcriptUnits } from './locomo-corpus.ts';
import { questionsOf, sampleQuestions, type QaQuestion } from './locomo-qa.ts';
import { officialScore, normalizeAnswer, CATEGORY_5_REASON } from './locomo-parity.ts';
import { sourceManifest } from './source-manifest.ts';
import { createReportValidator, describeErrors } from './validate.ts';
import { runHeraBaselines,loadHeraScripts } from './hera-runner.ts';
import { analyticEnvelope } from './report-envelope.ts';
import { table } from './table.ts';
import schema from '../schemas/hera-qa.schema.json' with { type: 'json' };
import runIdentitySchema from '../../packages/config/schemas/run-identity.schema.json' with { type: 'json' };
import type { HeraQa, Row, DatasetQuestion } from './hera-qa.types.ts';
import { runHeraFrozen } from './hera-frozen.ts';
import { runHeraExperience } from './hera-learning.ts';
import {heraQuality} from './hera-quality.ts';
import {HERA_BASELINE_BUDGET,HERA_GROUP_BUDGET,heraCosts,heraBudgetPolicyId,heraPhaseCosts,heraMeasuredPairs,heraNegativeTransfer,heraSafetyCensus,heraClaim} from './hera-measurement.ts';
export {heraPairedInterval} from './hera-measurement.ts';

export const HERA_REPORT_PATH = 'benchmark/results/hera-qa.json';
export const HERA_DOCUMENT_PATH = 'docs/HERA_BENCHMARK.md';
export const HERA_ROWS = ['oracle', 'reference', 'single-turn', 'fixed-topology', 'query-specific-frozen', 'hera-no-experience', 'hera-no-rope', 'hera-full', 'hera-no-mutation'] as const;
const HERA_TIERS:HeraQa['tiers']=[{id:'scripted',status:'run',reason:'scripted tier is deterministic'},
  {id:'wire-replay',status:'not-run',reason:'no recorded HERA receipt bundle'},{id:'live',status:'not-run',reason:'no authorized live plan'}];
const FIXTURE = 'benchmark/fixtures/hera';
const validate = createReportValidator(schema, [runIdentitySchema]);
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
export interface HeraFixtureQuestion {
  id: string; query: string; type: 'single-hop' | 'multi-hop' | 'temporal' | 'unanswerable';
  category: 1 | 2 | 3 | 4; split: 'training' | 'held-out';
  gold: { answer: string, evidenceIds: string[], abstain: boolean };
}
export interface HeraFixture {
  manifest: { revision: string, fixture: string, licence: 'MIT', roles: string[],
    files: Array<{ path: string, sha256: string }>, evaluators: HeraQa['evaluators'] };
  corpus: Array<{ id: string, text: string, digest: string }>;
  questions: HeraFixtureQuestion[];
  topologies: unknown[];
}
export async function loadHeraFixture(root = process.cwd()): Promise<HeraFixture> {
  const directory = join(root, FIXTURE);
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as HeraFixture['manifest'];
  const { revision, ...payload } = manifest;
  if (await canonicalSha256(payload) !== revision || manifest.fixture !== 'hera-qa/v1') throw new Error('Stale HERA fixture registration.');
  const seen = new Set<string>();
  for (const file of manifest.files) {
    if (!/^(?:negative\/)?[a-z0-9-]+\.json$/.test(file.path) || seen.has(file.path)) throw new Error('Invalid fixture file address.');
    seen.add(file.path);
    if (digest(await readFile(join(directory, file.path), 'utf8')) !== file.sha256) throw new Error('Fixture bytes changed: ' + file.path);
  }
  for (const file of ['corpus.json', 'questions.json', 'topologies.json']) if (!seen.has(file)) throw new Error('Fixture member not registered.');
  const read = async (path: string) => JSON.parse(await readFile(join(directory, path), 'utf8'));
  const corpus = await read('corpus.json') as HeraFixture['corpus'];
  const questions = await read('questions.json') as HeraFixture['questions'];
  if (corpus.length < 12 || corpus.length > 20 || questions.length < 8 || questions.length > 12) throw new Error('Fixture cardinality changed.');
  const passageIds = new Set<string>();
  for (const passage of corpus) {
    if (passageIds.has(passage.id) || passage.digest !== await gmplTextDigest(passage.text)) throw new Error('Invalid passage identity.');
    passageIds.add(passage.id);
  }
  if (new Set(questions.map(q => q.id)).size !== questions.length) throw new Error('Duplicate fixture question.');
  for (const question of questions) {
    if (!['training', 'held-out'].includes(question.split) || question.gold.evidenceIds.some(id => !passageIds.has(id))) throw new Error('Invalid question split or evidence.');
  }
  return { manifest, corpus, questions, topologies: await read('topologies.json') };
}
/** An adapter supplies the split; a model cannot authorize its own learning. */
export function planHeraFixtureMode(mode: 'learn' | 'evaluate' | 'infer', task: Pick<HeraFixtureQuestion, 'split'>) {
  return assertTaskSplit(task, mode);
}
export const heraRoleInput = (question: HeraFixtureQuestion, fixture: HeraFixture): GmplInput => ({
  caseId: question.id, query: question.query, evidence: fixture.corpus.map(p => ({ ...p })),
});

export async function createHeraDatasetPlan(dataset: LoadOutcome) {
  const all: QaQuestion[] = [];
  const corpora = new Map<string, ReturnType<typeof conversationCorpus>>();
  if (dataset.available && dataset.valid) for (const sample of dataset.samples) {
    const corpus = conversationCorpus(sample); corpora.set(sample.sample_id, corpus);
    all.push(...questionsOf(sample, corpus));
  }
  const selected = sampleQuestions(all, { seed: 17753, perCategory: 32, adversarial: 0 });
  const training = new Set<string>();
  for (const category of SCORABLE_CATEGORIES) for (const q of selected.filter(q => q.category === category).slice(0, 16)) training.add(q.id);
  const inputs = new Map<string, GmplInput>();
  const embedder = createOfflineEmbedder();
  for (const [sampleId, corpus] of corpora) {
    const questions = selected.filter(q => q.sampleId === sampleId);
    if (!questions.length) continue;
    const units = transcriptUnits(corpus);
    const vectors = units.length ? await embedder.embed(units.map(u => u.text)) : [];
    const memories = units.map((unit, index) => ({ ...unit, embedding: Array.from(vectors[index]), embeddedBy: { model: embedder.model, dims: embedder.dims } }));
    const queries = await embedder.embed(questions.map(q => q.text));
    for (const [index, question] of questions.entries()) {
      const recalled = recallByEmbedding(memories, queries[index], { k: 10, minScore: 0, identity: { model: embedder.model, dims: embedder.dims } });
      const evidence = await Promise.all(recalled.ranked.map(async ({ unit }) => ({ id: unit.evidence, text: unit.text, digest: await gmplTextDigest(unit.text) })));
      inputs.set(question.id, { caseId: question.id, query: question.text, evidence });
    }
  }
  const questions: DatasetQuestion[] = await Promise.all(selected.map(async q => {
    const input = inputs.get(q.id)!;
    return { id: q.id, category: q.category as 1 | 2 | 3 | 4, split: training.has(q.id) ? 'training' : 'held-out',
      inputId: await canonicalSha256(input), evidenceId: await canonicalSha256(input.evidence), evidence: input.evidence.map(({ id, digest }) => ({ id, digest })) };
  }));
  const trainIds = questions.filter(q => q.split === 'training').map(q => q.id), evalIds = questions.filter(q => q.split === 'held-out').map(q => q.id);
  const score = (q: QaQuestion, cut: boolean) => {
    const answer = String(q.answer ?? '');
    const result = officialScore({ category: q.category, prediction: cut && q.category === 3 ? answer.split(';')[0].trim() : answer, answer });
    return result.scored ? result.f1 : 0;
  };
  return {
    inputs, truth: new Map(selected.map(q => [q.id, q])),
    split: { seed: 17753 as const, perCategory: 32 as const,
      training: { ids: trainIds, sampleId: await canonicalSha256(trainIds) }, heldOut: { ids: evalIds, sampleId: await canonicalSha256(evalIds) },
      missingByCategory: SCORABLE_CATEGORIES.map(category => ({ category, missing: 32 - questions.filter(q => q.category === category).length })) },
    questions, evidenceId: await canonicalSha256(questions.map(q => ({ id: q.id, evidenceId: q.evidenceId }))),
    oracleByCategory: SCORABLE_CATEGORIES.map(category => {
      const rows = selected.filter(q => q.category === category);
      return { category, questions: rows.length, f1: rows.length ? rows.reduce((n, q) => n + score(q, true), 0) / rows.length : 0 };
    }),
    category3UncutBelowCeiling: selected.filter(q => q.category === 3 && score(q, false) < score(q, true)).length,
  };
}

export async function heraSourceId(root = process.cwd()) {
  const packs = (await readdir(join(root, 'prompts/hera'), { recursive: true })).filter(p => p.endsWith('.toml')).map(p => 'prompts/hera/' + p).sort();
  const roots = ['benchmark/lib', 'benchmark/fixtures/hera', 'packages'];
  const scripts: string[] = [];
  if (await stat(join(root, 'packages/hera/src')).then(s => s.isDirectory(), () => false)) {
    roots.push('packages/hera/src', 'packages/hera/schemas', 'packages/hera/artifacts');
    scripts.push('scripts/hera-artifacts.ts', 'scripts/hera-sources.ts', 'scripts/hera-schema.ts');
  }
  const source = await sourceManifest(root, ['benchmark/hera-qa.ts', 'examples/hera.ts', 'benchmark/schemas/hera-qa.schema.json', 'package.json', 'package-lock.json', ...scripts, ...packs], roots);
  return canonicalSha256({ files: source.files });
}
const failures = (): NonNullable<Row['failures']> => ({ skipped: 0, failed: 0, refusedCandidates: 0, budgetStops: 0, orphans: 0, headConflicts: 0, refusedLearningWrites: 0 });
const emptyCost = (): NonNullable<Row['cost']> => heraCosts([]);
const missingMechanism: Record<typeof HERA_ROWS[number], string> = {
  oracle: 'Analytic oracle pending.', reference: 'Seeded reference pending.',
  'single-turn': 'The single-turn executor is not implemented.',
  'fixed-topology': 'The fixed MAS topology executor is not implemented.',
  'query-specific-frozen': 'Frozen query-specific orchestration is not implemented.',
  'hera-no-experience': 'Role prompt learning with a frozen experience library is not implemented.',
  'hera-no-rope': 'Experience learning without prompt evolution is not implemented.',
  'hera-full': 'Experience, prompt and topology learning together are not implemented.',
  'hera-no-mutation': 'Experience and prompt learning without topology mutation are not implemented.',
};
const missingRow = (id: typeof HERA_ROWS[number]): Row => ({ id, kind: 'ablation', status: 'implementation-missing', reason: missingMechanism[id], tier: 'scripted', identity: null, quality: null, cost: null, failures: failures(), learning: null, topology: null, seeds: [17753],measurements:[],promptSizes:[] });
export async function buildHeraReport(options: { root?: string, sourceId?: string, dataset?: LoadOutcome } = {}): Promise<HeraQa> {
  const root = options.root ?? process.cwd(), fixture = await loadHeraFixture(root);
  const dataset = options.dataset ?? await loadLocomo(root), plan = await createHeraDatasetPlan(dataset);
  const random = mulberry32(17753);
  const rows: Row[] = HERA_ROWS.map(missingRow);
  for (const [index, id] of ['oracle', 'reference'].entries()) {
    const cases = fixture.questions.map(question => {
      const prediction = id === 'oracle' ? question.gold.answer : fixture.corpus[randomInt(random, 0, fixture.corpus.length)].text;
      const measured = officialScore({ category: question.category, prediction, answer: question.gold.answer });
      return { category: question.category, f1: measured.scored ? measured.f1 : 0, success: normalizeAnswer(prediction) === normalizeAnswer(question.gold.answer) };
    });
    rows[index] = { ...missingRow(id as typeof HERA_ROWS[number]), kind: id as 'oracle' | 'reference', status: 'run', reason: null, tier: 'analytic',
      identity: { snapshotId: fixture.manifest.revision, model: 'analytic/no-provider', decoder: 'analytic/v1', corpusRevision: fixture.manifest.revision,
        evaluatorId: 'fixture-exact', toolIds: [], budget: { calls: 0, tokens: 0, ms: 0, turns: 0, nodes: 0, depth: 0, fanOut: 0, concurrency: 0 } },
      quality: { f1: cases.reduce((n, c) => n + c.f1, 0) / cases.length,
        byCategory: SCORABLE_CATEGORIES.map(category => { const held = cases.filter(c => c.category === category); return { category, f1: held.length ? held.reduce((n,c)=>n+c.f1,0)/held.length : 0, answered: held.length, planned: held.length }; }),
        successRate: cases.filter(c => c.success).length / cases.length, citationRecall: id === 'oracle' ? 1 : 0, answered: cases.length, planned: cases.length }, cost: emptyCost() };
  }
  const baseline = await runHeraBaselines(fixture, root);
  const frozen = await runHeraFrozen(fixture, root);
  baseline.rows.push(frozen.row);
  if(!baseline.identities.some(i=>i.identityId===frozen.identity.identityId))baseline.identities.push(frozen.identity);
  baseline.scripted.requests+=frozen.requests;baseline.scripted.replayCalls+=frozen.replayCalls;
  baseline.learningWrites+=frozen.learningWrites;
  for(const flags of [{experience:true,rope:false,mutation:false},{experience:false,rope:true,mutation:false},{experience:true,rope:true,mutation:false},{experience:true,rope:true,mutation:true}]){
    const learned=await runHeraExperience(fixture,root,flags);baseline.rows.push(learned.row);
    if(!baseline.identities.some(i=>i.identityId===learned.identity.identityId))baseline.identities.push(learned.identity);
    baseline.scripted.requests+=learned.requests;baseline.scripted.replayCalls+=learned.replayCalls;baseline.learningWrites+=learned.learningWrites;
  }
  for (const row of baseline.rows) rows[HERA_ROWS.indexOf(row.id)] = row;
  const envelope = analyticEnvelope(HERA_ROWS);
  envelope.identities = baseline.identities;
  envelope.rows = envelope.rows.map(row => baseline.rows.some(r => r.id === row.rowId) ? {rowId:row.rowId,identityStatus:'run' as const,identityId:baseline.identities[0].identityId} : row);
  const pairs=heraMeasuredPairs(rows),safety=heraSafetyCensus(rows),registration=await loadHeraScripts(root);
  for(const row of rows)if(row.learning)row.learning.negativeTransferByProfile=heraNegativeTransfer(row,rows.find(r=>r.id==='fixed-topology')!);
  const available = dataset.available && dataset.valid;
  const content = {
    instrument: 'hera-qa' as const, sourceId: options.sourceId ?? await heraSourceId(root),
    fixture: { revision: fixture.manifest.revision, licence: fixture.manifest.licence, passages: fixture.corpus.length, questions: fixture.questions.length,
      training: fixture.questions.filter(q => q.split === 'training').length, heldOut: fixture.questions.filter(q => q.split === 'held-out').length },
    dataset: { status: available ? 'available' as const : dataset.available ? 'invalid' as const : 'dataset-unavailable' as const,
      sha256: dataset.available ? dataset.sha256 : null, reason: dataset.available ? (dataset.valid ? null : dataset.errors.join('; ')) : INIT_COMMAND },
    split: plan.split, evaluators: fixture.manifest.evaluators, identity: envelope, rows, pairs, scripted: baseline.scripted,
    ablation:{trainingSequence:registration.sequence.training.map(t=>t.taskId),trainingSequenceId:await canonicalSha256(registration.sequence.training.map(t=>t.taskId)),heldOutIds:registration.sequence.heldOut,
      heldOutSampleId:await canonicalSha256(registration.sequence.heldOut),budgetPolicyId:await heraBudgetPolicyId(),seeds:[17753],seedReason:'scripted tier is deterministic'},
    tiers:HERA_TIERS,...safety,claim:heraClaim({rows,pairs,...safety}),
    locomo: { questions: plan.questions, oracleByCategory: plan.oracleByCategory, evidenceId: plan.evidenceId, category3UncutBelowCeiling: plan.category3UncutBelowCeiling,
      rows: HERA_ROWS.slice(2).map(id => ({ id, status: available ? 'not-run' as const : 'dataset-unavailable' as const, eligible: false as const,
        reason: available ? 'no authorized live plan' : dataset.available && !dataset.valid ? dataset.errors.join('; ') : INIT_COMMAND })) },
    refusals: { evalSplitInLearn: fixture.questions.filter(q => !planHeraFixtureMode('learn', q).valid).length, ...frozen.refusals },
    totals: { rows: rows.length, run: rows.filter(r => r.status === 'run').length, notRun: 0, implementationMissing: rows.filter(r => r.status === 'implementation-missing').length, datasetUnavailable: 0, answered: rows.reduce((n,r)=>n+(r.quality?.answered??0),0), planned: rows.reduce((n,r)=>n+(r.quality?.planned??0),0), calls: rows.reduce((n,r)=>n+(r.cost?.calls??0),0), learningWrites: baseline.learningWrites },
    limitations: [
      'All seven ablation rows execute registered scripted responses through durable MAS. Their quality measures fixture sensitivity, not model quality or a HERA improvement.',
      'The fixture corpus is synthetic, original MIT-licensed text. Its oracle and seeded reference are analytic controls.',
      'The fixture success rule is normalized exact equality. The LoCoMo success threshold F1 >= 0.5 is registered configuration, not a measured improvement.',
      'LoCoMo samples 32 questions in each category 1–4; the first 16 in release order within each category train, the remaining 16 are held out. No gold enters evidence selection or role inputs.',
      'Category 5 excluded: ' + CATEGORY_5_REASON,
      'Dataset text is not redistributed: reports contain only question identifiers, evidence addresses and digests. Oracle truth remains inside scoring.',
      'The deterministic injected clock does not measure request latency. Unknown timing requests remain counted; estimated tokens are separate from reported usage. The fixed six-invocation comparison shares caps with the single-turn row; generated candidates use the separate maxAgents learning cap.',
      'No live provider or wire-replay tier is executed. Stochastic live comparisons require at least three seeds and explicit new spend authorization.',
      'Costs count dispatched scripted requests, including tool continuations and normalization. Training-fold and held-out-fold calls are separate; both baseline folds execute in evaluate mode with zero learning writes. Scripted token usage is fixed fixture data; monetary cost is unmeasured.',
      'The frozen row includes profiling, bounded plan repairs and every candidate execution, including rejected plans and duplicate proposals. Ranking uses evaluator scores and therefore reports an evaluated group selection, not an answer selector available to unlabelled inference. Its snapshot pins an empty experience library.',
      'Every learning row uses seven registered training events over five distinct training tasks, including three consecutive q08 repetitions, then five held-out tasks against its final snapshot. Each repetition contributes to training costs and all-event quality; held-out quality counts the five unique held-out tasks. Three initial mixed groups exercise ADD, PRUNE, MERGE and KEEP. PRUNE uses an authored, source-backed host conflict policy.',
      'Prompt variants run one deterministic credited role per mixed training group. The registered axes are efficiency, thoroughness, risk-sensitivity, error-correction and heuristic-injection; group index selects the axis. Proposal and contrast calls, rejected trials and complete control/replay executions are charged. Each learning row declares the same separate refinement budget in addition to its rollout budget.',
      'The prompt script activates a q01 whole-run improvement, rejects an equal-score q02 variant, and refuses unsupported q03 provenance. Its active rule deliberately loses held-out q06, so the lower frozen score is published rather than treated as transfer. Trial rules retain actual control/replay ids; candidate rules retain their original failure evidence and proposal receipt.',
      'Experience scripts deliberately alter selected training answers to exercise learning mechanics. The all-question score includes those training interventions; compare held-out columns for the frozen-snapshot measurement. Scripted held-out answers do not prove transfer or a quality improvement. All reflection, consolidation and candidate purchases are included in cost.',
      'Topology mutation uses score-zero-consecutive-v1 with threshold 3 and normalized profile-tag buckets. The third evaluated zero-score q08 group proposes a registered query-rewriter insertion, executes it beside the original candidates with the same frozen prompts and per-execution caps, and activates a hint only after a strict measured score improvement. Retained failed invocation references identify intervention targets without asserting causal blame.',
      'Topology entropy uses dependency-edge role transitions within windows of eight observed invocations, averaging nonempty windows. Sequential role-list diagnostics use adjacent transitions. Self-loops count adjacent equal roles; cycles count unique DFS back edges in the role projection, visiting roles in first-invocation order. Diameter is the longest directed invocation path in edges. Structural aggregates use Jaren mean, include failed partial trajectories and exclude null measurements from each mean.',
      'Paired intervals resample the five identical held-out fixture questions 2000 times at seed 17753 and level 0.95. They diagnose scripted sensitivity and cannot establish model quality. Profile diagnostics use the original question type as an immutable host profile tag; they do not infer a category from the answer.',
      'All runtime rows share the registered budget-policy identity and resolved CONFIG budget. Actual allocations remain explicit: fixed runs have six-invocation caps; generated groups have separate structural caps; learning additionally receives one bounded refinement allowance. The budget census checks each observed event, including failed and rejected purchases, against its registered allocation.',
      'Evaluated operational failures receive zero score and success false before answer scoring; an empty failure placeholder cannot earn correct-abstention credit. Completed answers remain under the declared host scorer. Unlabelled inference remains unscored.',
    ],
  };
  const report = { ...content, reportId: await canonicalSha256(content) } as HeraQa;
  await validateHeraReport(report);
  return report;
}
export async function validateHeraReport(value: unknown): Promise<void> {
  const checked = validate(value);
  if (!checked.valid) throw new Error('Invalid HERA report: ' + describeErrors(checked).join('\n'));
  const report = value as HeraQa, { reportId, ...content } = report;
  if (await canonicalSha256(content) !== reportId) throw new Error('Stale HERA report identity.');
  for (const split of [report.split.training, report.split.heldOut]) if (await canonicalSha256(split.ids) !== split.sampleId) throw new Error('Stale split identity.');
  if (report.split.training.ids.some(id => report.split.heldOut.ids.includes(id))) throw new Error('Training and held-out overlap.');
  if (report.dataset.status !== 'available' && (report.split.training.ids.length || report.split.heldOut.ids.length || report.locomo.questions.length)) throw new Error('Unavailable dataset cannot contain a synthetic replacement.');
  if (report.scripted.requests !== report.totals.calls || report.scripted.replayCalls !== 0) throw new Error('Scripted request census mismatch.');
  if(!equalsJson(report.pairs,heraMeasuredPairs(report.rows)))throw new Error('Paired deltas and intervals must reproduce from identical held-out cases.');
  const census=heraSafetyCensus(report.rows);
  if(!equalsJson(census.violations,report.violations)||!equalsJson(census.budgets,report.budgets)||!equalsJson(report.claim,heraClaim({rows:report.rows,pairs:report.pairs,...census})))throw new Error('Claim, budget or violation census drift.');
  if(report.ablation.budgetPolicyId!==await heraBudgetPolicyId()||report.ablation.heldOutSampleId!==await canonicalSha256(report.ablation.heldOutIds)
    ||report.ablation.trainingSequenceId!==await canonicalSha256(report.ablation.trainingSequence)||report.ablation.heldOutIds.length!==report.fixture.heldOut
    ||new Set(report.ablation.trainingSequence).size!==report.fixture.training||report.ablation.trainingSequence.some(id=>report.ablation.heldOutIds.includes(id)))throw new Error('Ablation registration drift.');
  if(!equalsJson(report.tiers,HERA_TIERS)||!equalsJson(report.ablation.seeds,[17753])||report.ablation.seedReason!=='scripted tier is deterministic'
    ||report.rows.some(r=>r.kind==='ablation'&&r.tier!=='scripted'))throw new Error('This instrument has no authorized live or wire-replay execution receipt.');
  for(const row of report.rows){
    if(row.heldOutQuality&&(row.status!=='run'||row.heldOutQuality.planned!==report.fixture.heldOut||row.heldOutQuality.answered>row.quality!.answered))
      throw new Error('Held-out quality must belong to an executed row and the registered held-out fold.');
    if(row.learning&&!row.heldOutQuality)throw new Error('A measured learning row requires its frozen held-out result.');
    if(row.learning){const learning=row.learning,total=Object.values(learning.trials).reduce((n,v)=>n+v,0);
      if(new Set(learning.promptChurn.map(p=>p.agentId)).size!==learning.promptChurn.length||total>learning.evaluatedGroups||learning.replayCost.calls>row.cost!.trainingCalls||learning.replayCost.tokens>row.cost!.promptTokens+row.cost!.completionTokens+row.cost!.estimatedTokens)
        throw new Error('Prompt trials and replay spend must belong to the measured training rows.');
      if(!learning.flags.rope&&(total||learning.promptChurn.length||Object.values(learning.replayCost).some(Boolean)))throw new Error('A disabled prompt learner cannot claim trial work.');
      if(!row.identity!.learningBudget)throw new Error('Learning rows must declare their separate refinement allocation.');
      const mutation=learning.mutationAcceptance;
      if(mutation.proposed!==mutation.accepted+mutation.rejected||mutation.validated>mutation.proposed||mutation.accepted>mutation.validated||(!learning.flags.mutation&&Object.values(mutation).some(Boolean)))throw new Error('Mutation counts require validated, measured training evidence.');
      if(!row.topology||!row.topology.includesFailed||learning.structuralCurve.length!==learning.evaluatedGroups||learning.structuralCurve.some((point,index)=>point.step!==index||!point.topology?.includesFailed))throw new Error('Every training event requires its declared topology diagnostics.');
    }
  }
  for (const row of report.rows.filter(r => r.status === 'run' && r.tier === 'scripted')) {
    const held=row.measurements.filter(c=>c.split==='held-out'),trained=row.measurements.filter(c=>c.split==='training'),phases=heraPhaseCosts(row.measurements);
    if(!equalsJson(row.seeds,report.ablation.seeds)||!equalsJson(held.map(c=>c.taskId),report.ablation.heldOutIds)||!equalsJson(trained.map(c=>c.taskId),row.learning?report.ablation.trainingSequence:[...new Set(report.ablation.trainingSequence)])
      ||!equalsJson(row.quality,heraQuality(row.measurements))||!equalsJson(row.heldOutQuality,heraQuality(held)))throw new Error('Row quality differs from its registered measured cases.');
    if(!equalsJson(row.cost!.training,phases.training)||!equalsJson(row.cost!.heldOut,phases.heldOut))throw new Error('Phase spend differs from actual measured purchases.');
    const budget=row.id==='single-turn'||row.id==='fixed-topology'?HERA_BASELINE_BUDGET:HERA_GROUP_BUDGET;
    if(!equalsJson(row.identity!.budget,budget)||(row.learning&&!equalsJson(row.identity!.learningBudget,HERA_GROUP_BUDGET)))throw new Error('A row changes the registered allocation policy.');
    for(const c of row.measurements){const multiplier=row.learning&&c.split==='training'?2:1;
      if(!equalsJson(c.allowance,{calls:budget.calls*multiplier,tokens:budget.tokens*multiplier,ms:budget.ms*multiplier}))throw new Error('A case changes its registered budget.');
      if(c.split==='held-out'&&c.snapshotId!==row.identity!.snapshotId)throw new Error('Held-out tasks did not use the frozen final snapshot.');}
    if(row.learning&&!equalsJson(row.learning.negativeTransferByProfile,heraNegativeTransfer(row,report.rows.find(r=>r.id==='fixed-topology')!)))throw new Error('Profile transfer differs from measured held-out pairs.');
    if(!row.topology?.includesFailed||new Set(row.promptSizes.map(p=>p.agentId)).size!==8||row.promptSizes.some(p=>p.bytes===0))throw new Error('A runtime row lacks structural or prompt diagnostics.');
    const ref = (report.identity as IdentityEnvelope).rows.find(r => r.rowId === row.id);
    if (ref?.identityStatus !== 'run') throw new Error('Executed row has no resolved CONFIG identity.');
    const identity = (report.identity as IdentityEnvelope).identities.find(i => i.identityId === ref.identityId);
    if (!identity || identity.roles.chat.provider + '/' + identity.roles.chat.model !== row.identity!.model) throw new Error('Executed row identity differs from CONFIG.');
  }
  for(const row of report.rows.filter(r=>r.status==='run'&&r.tier!=='analytic'))if(report.tiers.find(t=>t.id===row.tier)?.status!=='run')throw new Error('A measured row has no executed tier.');
  const ids = report.locomo.questions.map(q => q.id);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate dataset question.');
  for (const [name, split] of [['training', report.split.training], ['held-out', report.split.heldOut]] as const) {
    const expected = report.locomo.questions.filter(q => q.split === name).map(q => q.id);
    if (await canonicalSha256(expected) !== split.sampleId) throw new Error('Dataset question split mismatch.');
  }
  for (const category of SCORABLE_CATEGORIES) {
    const questions = report.locomo.questions.filter(q => q.category === category);
    const missing = report.split.missingByCategory.find(c => c.category === category);
    const oracle = report.locomo.oracleByCategory.find(c => c.category === category);
    if (!missing || !oracle || missing.missing !== 32 - questions.length || oracle.questions !== questions.length) throw new Error('Dataset category census mismatch.');
    if (questions.some((q, index) => q.split !== (index < 16 ? 'training' : 'held-out'))) throw new Error('Dataset release-order split changed.');
  }
  if (report.locomo.evidenceId !== await canonicalSha256(report.locomo.questions.map(q => ({ id: q.id, evidenceId: q.evidenceId })))) throw new Error('Stale dataset evidence identity.');
}
export function requireHeraCapability(report: HeraQa, capability: string): void {
  const gates: Record<string, readonly string[]> = { instrument: [], baseline: ['single-turn', 'fixed-topology'], frozen: ['query-specific-frozen'], experience: ['hera-no-rope'], rope: ['hera-no-experience','hera-no-mutation'], mutation: ['hera-full'], complete: HERA_ROWS.slice(2) };
  if (!Object.hasOwn(gates, capability)) throw new Error('Unknown HERA capability: ' + capability);
  const missing = gates[capability].filter(id => report.rows.find(r => r.id === id)?.status !== 'run');
  if (missing.length) throw new Error('HERA capability not implemented: ' + missing.join(', '));
}
export const renderHeraReport = (report: HeraQa) => JSON.stringify(report, null, 2) + '\n';
export function renderHeraDocument(report: HeraQa): string {
  return ['# Experience-guided orchestration', '', 'Generated by `npm run benchmark:hera`. Keyless durable execution with scripted clients; no network calls.', '',
    `Claim: **${report.claim.decision}**. ${report.claim.reason}`, '',
    `The registration began with unmeasured runtime mechanisms. Current coverage: ${report.rows.filter(r=>r.kind==='ablation'&&r.status==='run').length} of ${report.rows.filter(r=>r.kind==='ablation').length} runtime rows executed.`, '',
    table({head:['Tier','Status','Reason'],rows:report.tiers.map(t=>[t.id,t.status,t.reason])}), '',
    `Fixture: ${report.fixture.passages} passages, ${report.fixture.questions} questions (${report.fixture.training} training, ${report.fixture.heldOut} held out). Licence: MIT.`, '',
    `Training event sequence: ${report.ablation.trainingSequence.join(', ')}. Held-out questions: ${report.ablation.heldOutIds.join(', ')}. ${report.ablation.seedReason}; seed ${report.ablation.seeds.join(', ')}.`, '',
    table({ head: ['Row', 'Status', 'Tier', 'F1', 'Answered / planned', 'Calls', 'Reason'], numeric: [3, 4, 5],
      rows: report.rows.map(r => [r.id, r.status, r.tier, r.quality?.f1.toFixed(4) ?? null, r.quality ? r.quality.answered + ' / ' + r.quality.planned : null, r.cost?.calls ?? null, r.reason ?? (r.tier === 'analytic' ? 'analytic control' : 'scripted execution')]) }), '',
    table({head:['Row','Held-out F1','Held-out answered / planned','Training calls','Held-out calls'],numeric:[1,2,3,4],rows:report.rows.filter(r=>r.heldOutQuality).map(r=>[r.id,r.heldOutQuality!.f1.toFixed(4),r.heldOutQuality!.answered+' / '+r.heldOutQuality!.planned,r.cost!.trainingCalls,r.cost!.heldOutCalls])}), '',
    table({head:['Held-out row','Success rate','Citation recall','Category 1 F1','Category 2 F1','Category 3 F1','Category 4 F1'],rows:report.rows.filter(r=>r.heldOutQuality).map(r=>[r.id,r.heldOutQuality!.successRate,r.heldOutQuality!.citationRecall,...r.heldOutQuality!.byCategory.map(c=>c.planned?c.f1:null)])}), '',
    table({head:['Treatment','Control','Held-out delta','95% paired interval','Model-quality eligible'],rows:report.pairs.map(p=>[p.treatment,p.control,p.delta,p.interval?'['+p.interval.low+', '+p.interval.high+']':null,String(p.eligible)])}), '',
    table({head:['Runtime row','Phase','Calls','Provider input / output tokens','Estimated tokens','Unknown token requests','Recorded ms','Unknown timing requests'],rows:report.rows.filter(r=>r.kind==='ablation'&&r.cost).flatMap(r=>(['training','heldOut'] as const).map(phase=>{
      const cost=r.cost![phase];return [r.id,phase,cost.calls,cost.promptTokens+' / '+cost.completionTokens,cost.estimatedTokens,cost.unknownTokenRequests,cost.ms,cost.unknownMsRequests];}))}), '',
    `Registered budgets satisfied: ${report.budgets.within}. Over-budget events: ${report.budgets.overruns.length}. Split / scope / tool violations: ${report.violations.split} / ${report.violations.scope} / ${report.violations.tool}.`, '',
    table({head:['Runtime row','Failed / skipped rollouts','Active prompt bytes','Largest role prompt bytes','Frozen snapshot'],rows:report.rows.filter(r=>r.kind==='ablation'&&r.identity).map(r=>[r.id,r.failures.failed+' / '+r.failures.skipped,r.promptSizes.reduce((n,p)=>n+p.bytes,0),Math.max(0,...r.promptSizes.map(p=>p.bytes)),r.identity!.snapshotId])}), '',
    table({head:['Learning row','Mixed / evaluated','Unmixed groups','Library size','ADD / MERGE / PRUNE / KEEP','Head conflicts','Refused learning'],rows:report.rows.filter(r=>r.learning).map(r=>[r.id,r.learning!.mixedGroups+' / '+r.learning!.evaluatedGroups,r.learning!.groupsWithoutMixedOutcome,r.learning!.librarySize,[r.learning!.libraryOperations.add,r.learning!.libraryOperations.merge,r.learning!.libraryOperations.prune,r.learning!.libraryOperations.keep].join(' / '),r.failures.headConflicts,r.failures.refusedLearningWrites])}), '',
    `Measured retriever concurrency: ${report.scripted.maxConcurrentRetrievers}. Replay calls: ${report.scripted.replayCalls}. Script revision: \`${report.scripted.revision}\`.`, '',
    `Dataset: ${report.dataset.status}. Training ${report.split.training.ids.length}; held out ${report.split.heldOut.ids.length}; category-3 uncut answers below their ceiling: ${report.locomo.category3UncutBelowCeiling}.`, '',
    table({ head: ['LoCoMo category', 'Questions', 'Oracle F1', 'Missing from sample'],
      rows: report.locomo.oracleByCategory.map(c => [c.category, c.questions, c.f1.toFixed(4), report.split.missingByCategory.find(m => m.category === c.category)!.missing]) }), '',
    table({head:['Prompt row','Role','Activated / rejected versions','Activated / rejected / malformed / unevaluated trials','Whole replay calls / tokens','Held-out F1'],rows:report.rows.filter(r=>r.learning?.flags.rope).flatMap(r=>r.learning!.promptChurn.map(p=>[r.id,p.agentId,p.activated+' / '+p.rejected,[r.learning!.trials.activated,r.learning!.trials.rejected,r.learning!.trials.malformed,r.learning!.trials.unevaluated].join(' / '),r.learning!.replayCost.calls+' / '+r.learning!.replayCost.tokens,r.heldOutQuality!.f1]))}), '',
    table({head:['Topology row','Proposed / validated / accepted / rejected','Entropy','Distinct roles','Node efficiency','Self-loops','Role cycles','DAG diameter','Failed included'],rows:report.rows.filter(r=>r.topology).map(r=>[r.id,r.learning?Object.values(r.learning.mutationAcceptance).join(' / '):'0 / 0 / 0 / 0',r.topology!.entropy,r.topology!.distinctRoles,r.topology!.nodeEfficiency,r.topology!.selfLoops,r.topology!.cycles,r.topology!.diameter,String(r.topology!.includesFailed)])}), '',
    table({head:['Learning row','Host profile tag','Held-out delta versus fixed'],rows:report.rows.filter(r=>r.learning).flatMap(r=>r.learning!.negativeTransferByProfile.map(p=>[r.id,p.profile,p.delta]))}), '',
    table({head:['Learning row','Training step','Task','Best task score','Entropy','Distinct roles','Node efficiency','Failed included'],rows:report.rows.filter(r=>r.learning).flatMap(r=>r.learning!.structuralCurve.map(point=>[r.id,point.step,point.taskId,point.bestScore,point.topology!.entropy,point.topology!.distinctRoles,point.topology!.nodeEfficiency,String(point.topology!.includesFailed)]))}), '',
    `Held-out learning attempts refused: ${report.refusals.evalSplitInLearn}. Learning writes: ${report.totals.learningWrites}. Dataset comparisons remain ineligible.`, '',
    ...report.limitations.map(l => '- ' + l), '', `Fixture revision: \`${report.fixture.revision}\`. Source: \`${report.sourceId}\`. Report: \`${report.reportId}\`.`, ''].join('\n');
}
