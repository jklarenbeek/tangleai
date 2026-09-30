/** Preregistered orchestration measurements. Gold never enters role inputs. */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalSha256 } from '@jarenjs/json/canonical';
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
import { bootstrapInterval } from './locomo-policy.ts';
import { sourceManifest } from './source-manifest.ts';
import { createReportValidator, describeErrors } from './validate.ts';
import { runHeraBaselines } from './hera-runner.ts';
import { analyticEnvelope } from './report-envelope.ts';
import { table } from './table.ts';
import schema from '../schemas/hera-qa.schema.json' with { type: 'json' };
import runIdentitySchema from '../../packages/config/schemas/run-identity.schema.json' with { type: 'json' };
import type { HeraQa, Row, DatasetQuestion } from './hera-qa.types.ts';

export const HERA_REPORT_PATH = 'benchmark/results/hera-qa.json';
export const HERA_DOCUMENT_PATH = 'docs/HERA_BENCHMARK.md';
export const HERA_ROWS = ['oracle', 'reference', 'single-turn', 'fixed-topology', 'query-specific-frozen', 'hera-no-experience', 'hera-no-rope', 'hera-full', 'hera-no-mutation'] as const;
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
const emptyCost = (): NonNullable<Row['cost']> => ({ calls: 0, promptTokens: 0, completionTokens: 0, unknownTokenRequests: 0, estimatedTokens: 0, ms: 0, unknownMsRequests: 0, money: null, trainingCalls: 0, heldOutCalls: 0 });
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
const missingRow = (id: typeof HERA_ROWS[number]): Row => ({ id, kind: 'ablation', status: 'implementation-missing', reason: missingMechanism[id], tier: 'scripted', identity: null, quality: null, cost: null, failures: failures(), learning: null, topology: null, seeds: [17753] });
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
  for (const row of baseline.rows) rows[HERA_ROWS.indexOf(row.id)] = row;
  const envelope = analyticEnvelope(HERA_ROWS);
  envelope.identities = baseline.identities;
  envelope.rows = envelope.rows.map(row => baseline.rows.some(r => r.id === row.rowId) ? {rowId:row.rowId,identityStatus:'run' as const,identityId:baseline.identities[0].identityId} : row);
  const pairs: HeraQa['pairs'] = [];
  for (const id of HERA_ROWS.slice(2)) if (id !== 'fixed-topology') pairs.push({ treatment: id, control: 'fixed-topology', eligible: false, delta: null, interval: null });
  for (const id of HERA_ROWS.slice(2)) if (id !== 'hera-full' && id !== 'fixed-topology') pairs.push({ treatment: 'hera-full', control: id, eligible: false, delta: null, interval: null });
  const available = dataset.available && dataset.valid;
  const content = {
    instrument: 'hera-qa' as const, sourceId: options.sourceId ?? await heraSourceId(root),
    fixture: { revision: fixture.manifest.revision, licence: fixture.manifest.licence, passages: fixture.corpus.length, questions: fixture.questions.length,
      training: fixture.questions.filter(q => q.split === 'training').length, heldOut: fixture.questions.filter(q => q.split === 'held-out').length },
    dataset: { status: available ? 'available' as const : dataset.available ? 'invalid' as const : 'dataset-unavailable' as const,
      sha256: dataset.available ? dataset.sha256 : null, reason: dataset.available ? (dataset.valid ? null : dataset.errors.join('; ')) : INIT_COMMAND },
    split: plan.split, evaluators: fixture.manifest.evaluators, identity: envelope, rows, pairs, scripted: baseline.scripted,
    locomo: { questions: plan.questions, oracleByCategory: plan.oracleByCategory, evidenceId: plan.evidenceId, category3UncutBelowCeiling: plan.category3UncutBelowCeiling,
      rows: HERA_ROWS.slice(2).map(id => ({ id, status: available ? 'not-run' as const : 'dataset-unavailable' as const, eligible: false as const,
        reason: available ? 'no authorized live plan' : dataset.available && !dataset.valid ? dataset.errors.join('; ') : INIT_COMMAND })) },
    refusals: { evalSplitInLearn: fixture.questions.filter(q => !planHeraFixtureMode('learn', q).valid).length, appliedNotOffered: 0, invalidCandidates: 0 },
    totals: { rows: rows.length, run: rows.filter(r => r.status === 'run').length, notRun: 0, implementationMissing: rows.filter(r => r.status === 'implementation-missing').length, datasetUnavailable: 0, answered: rows.reduce((n,r)=>n+(r.quality?.answered??0),0), planned: rows.reduce((n,r)=>n+(r.quality?.planned??0),0), calls: rows.reduce((n,r)=>n+(r.cost?.calls??0),0), learningWrites: baseline.learningWrites },
    limitations: [
      'The single-turn and fixed-topology rows execute registered scripted responses through durable MAS. Their quality measures fixture sensitivity, not model quality or a HERA improvement. Five learning mechanisms remain unimplemented.',
      'The fixture corpus is synthetic, original MIT-licensed text. Its oracle and seeded reference are analytic controls.',
      'The fixture success rule is normalized exact equality. The LoCoMo success threshold F1 >= 0.5 is registered configuration, not a measured improvement.',
      'LoCoMo samples 32 questions in each category 1–4; the first 16 in release order within each category train, the remaining 16 are held out. No gold enters evidence selection or role inputs.',
      'Category 5 excluded: ' + CATEGORY_5_REASON,
      'Dataset text is not redistributed: reports contain only question identifiers, evidence addresses and digests. Oracle truth remains inside scoring.',
      'The deterministic injected clock does not measure request latency. Unknown timing requests remain counted; estimated tokens are separate from reported usage. The fixed six-invocation comparison shares caps with the single-turn row; generated candidates use the separate maxAgents learning cap.',
      'No live provider or wire-replay tier is executed. Stochastic live comparisons require at least three seeds and explicit new spend authorization.',
      'Costs count dispatched scripted requests, including tool continuations and normalization. Training-fold and held-out-fold calls are separate; both baseline folds execute in evaluate mode with zero learning writes. Scripted token usage is fixed fixture data; monetary cost is unmeasured.',
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
  for (const row of report.rows.filter(r => r.status === 'run' && r.tier === 'scripted')) {
    const ref = (report.identity as IdentityEnvelope).rows.find(r => r.rowId === row.id);
    if (ref?.identityStatus !== 'run') throw new Error('Executed row has no resolved CONFIG identity.');
    const identity = (report.identity as IdentityEnvelope).identities.find(i => i.identityId === ref.identityId);
    if (!identity || identity.roles.chat.provider + '/' + identity.roles.chat.model !== row.identity!.model) throw new Error('Executed row identity differs from CONFIG.');
  }
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
/** Reuses the existing paired bootstrap; never estimates a missing comparison. */
export function heraPairedInterval(deltas: readonly number[]) {
  return bootstrapInterval(deltas, { resamples: 2000, seed: 17753, level: 0.95 });
}
export const renderHeraReport = (report: HeraQa) => JSON.stringify(report, null, 2) + '\n';
export function renderHeraDocument(report: HeraQa): string {
  return ['# Experience-guided orchestration', '', 'Generated by `npm run benchmark:hera`. Keyless durable execution with scripted clients; no network calls.', '',
    `Fixture: ${report.fixture.passages} passages, ${report.fixture.questions} questions (${report.fixture.training} training, ${report.fixture.heldOut} held out). Licence: MIT.`, '',
    table({ head: ['Row', 'Status', 'Tier', 'F1', 'Answered / planned', 'Calls', 'Reason'], numeric: [3, 4, 5],
      rows: report.rows.map(r => [r.id, r.status, r.tier, r.quality?.f1.toFixed(4) ?? null, r.quality ? r.quality.answered + ' / ' + r.quality.planned : null, r.cost?.calls ?? null, r.reason ?? (r.tier === 'analytic' ? 'analytic control' : 'scripted execution')]) }), '',
    `Measured retriever concurrency: ${report.scripted.maxConcurrentRetrievers}. Replay calls: ${report.scripted.replayCalls}. Script revision: \`${report.scripted.revision}\`.`, '',
    `Dataset: ${report.dataset.status}. Training ${report.split.training.ids.length}; held out ${report.split.heldOut.ids.length}; category-3 uncut answers below their ceiling: ${report.locomo.category3UncutBelowCeiling}.`, '',
    table({ head: ['LoCoMo category', 'Questions', 'Oracle F1', 'Missing from sample'],
      rows: report.locomo.oracleByCategory.map(c => [c.category, c.questions, c.f1.toFixed(4), report.split.missingByCategory.find(m => m.category === c.category)!.missing]) }), '',
    `Held-out learning attempts refused: ${report.refusals.evalSplitInLearn}. Learning writes: ${report.totals.learningWrites}. Dataset comparisons remain ineligible.`, '',
    ...report.limitations.map(l => '- ' + l), '', `Fixture revision: \`${report.fixture.revision}\`. Source: \`${report.sourceId}\`. Report: \`${report.reportId}\`.`, ''].join('\n');
}
