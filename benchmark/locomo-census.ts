/* eslint-disable no-console */
/**
 * The LoCoMo census — what is actually in the dataset, before anything
 * is scored against it.
 *
 * This is the first instrument of TODO 02 and it deliberately measures
 * no model and no policy. It answers the questions every later row
 * depends on and that a paper's summary table cannot: how many QA pairs
 * per category really survive, how many carry no ground truth, how many
 * session timestamps parse, and — the one that decides whether an
 * evidence-recall metric is trustworthy — how many evidence ids resolve
 * to a turn that exists.
 *
 * It is the oracle row's precondition. jarenjs's retrieval benchmark
 * refuses to print a number until an oracle policy scores exactly 1.000,
 * because that is what catches a corpus whose gold ids do not exist.
 * LoCoMo has such ids. Counting them here, once, means every later
 * instrument can subtract a known quantity instead of discovering it as
 * a mysterious ceiling.
 *
 *   node benchmark/locomo-census.ts            # Markdown to stdout
 *   node benchmark/locomo-census.ts --require   # exit 1 if unavailable
 */

import { parseArgs } from './lib/args.ts';
import { count, score, table } from './lib/table.ts';
import { mean } from './lib/stats.ts';
import {
  DIA_ID,
  INIT_COMMAND,
  LOCOMO_DATASET,
  SESSION_DATE_PATTERN,
  dialogIdsOf,
  loadLocomo,
  orphanStamps,
  sessionOfDiaId,
  sessionsOf,
} from './lib/locomo.ts';

const args = parseArgs(process.argv.slice(2), { flags: ['require'] });
const dataset = await loadLocomo();

if (!dataset.available) {
  console.log(`# LoCoMo census\n\n**Skipped** — ${dataset.reason}.\n`);
  console.log(`The dataset is a git submodule and is not vendored here (it is CC BY-NC 4.0).`);
  console.log(`Fetch it with:\n\n    ${dataset.hint}\n`);
  process.exit(args.flags.has('require') ? 1 : 0);
}

const CATEGORY_NAMES: Record<number, string> = {
  1: 'multi-hop', 2: 'temporal', 3: 'open-domain', 4: 'single-hop', 5: 'adversarial',
};

const perSample: Array<Record<string, string | number>> = [];
const categories = new Map<number, { total: number, withAnswer: number, integerAnswer: number }>();
let turns = 0;
let sessions = 0;
let datesParsed = 0;
let datesRefused = 0;
let imageTurns = 0;
let evidenceTotal = 0;
let evidenceMalformed = 0;
let evidenceUnresolved = 0;
const unresolvedExamples: string[] = [];
let auxSessions = 0;
/** Per-question resolvable-evidence fraction, per category — the oracle ceiling. */
const oracle = new Map<number, number[]>();
let noEvidence = 0;
let stampedButAbsent = 0;
const orphanNotes: string[] = [];
let evidenceIntoOrphans = 0;

for (const sample of dataset.samples) {
  const sessionList = sessionsOf(sample);
  const ids = dialogIdsOf(sample);
  const orphans = orphanStamps(sample);
  if (orphans.length > 0) {
    stampedButAbsent += orphans.length;
    orphanNotes.push(`\`${sample.sample_id}\` — sessions ${orphans[0]}–${orphans[orphans.length - 1]} (${orphans.length}) are timestamped with no transcript`);
  }
  const orphanSet = new Set(orphans);
  let sampleTurns = 0;
  for (const session of sessionList) {
    sessions++;
    sampleTurns += session.turns.length;
    if (session.at === null) datesRefused++; else datesParsed++;
    for (const turn of session.turns) if (turn.img_url !== undefined) imageTurns++;
  }
  turns += sampleTurns;

  let sampleEvidence = 0;
  let sampleBroken = 0;
  for (const qa of sample.qa) {
    // The official evaluator's `recall_acc`: the fraction of THIS question's
    // evidence that is present. A question with no evidence scores 1, which is
    // what `evaluation.py` does with an empty list. Averaged per category, this
    // is the highest evidence recall any retrieval policy can reach — retrieve
    // literally everything and the unresolvable ids are still missing.
    const evidence = qa.evidence ?? [];
    if (evidence.length === 0) noEvidence++;
    const resolvable = evidence.length === 0
      ? 1
      : evidence.filter((id) => ids.has(id)).length / evidence.length;
    const bucketOracle = oracle.get(qa.category) ?? [];
    bucketOracle.push(resolvable);
    oracle.set(qa.category, bucketOracle);

    const bucket = categories.get(qa.category) ?? { total: 0, withAnswer: 0, integerAnswer: 0 };
    bucket.total++;
    if (qa.answer !== undefined) bucket.withAnswer++;
    if (typeof qa.answer === 'number') bucket.integerAnswer++;
    categories.set(qa.category, bucket);

    for (const id of qa.evidence ?? []) {
      evidenceTotal++;
      sampleEvidence++;
      const wellFormed = DIA_ID.test(id);
      if (!wellFormed) evidenceMalformed++;
      const namedSession = sessionOfDiaId(id);
      if (namedSession !== null && orphanSet.has(namedSession)) evidenceIntoOrphans++;
      if (!ids.has(id)) {
        evidenceUnresolved++;
        sampleBroken++;
        if (unresolvedExamples.length < 10) {
          unresolvedExamples.push(`\`${id}\` (${sample.sample_id}, ${wellFormed ? 'well formed but absent' : 'malformed'})`);
        }
      }
    }
  }

  const observations = Object.keys(sample.observation ?? {}).length;
  auxSessions += observations;
  perSample.push({
    sample: sample.sample_id,
    sessions: sessionList.length,
    turns: sampleTurns,
    qa: sample.qa.length,
    evidence: sampleEvidence,
    unresolved: sampleBroken,
    observed: observations,
  });
}

const qaTotal = [...categories.values()].reduce((sum, bucket) => sum + bucket.total, 0);
const scorable = [...categories.entries()]
  .filter(([category]) => category !== 5)
  .reduce((sum, [, bucket]) => sum + bucket.total, 0);

console.log('# LoCoMo census');
console.log(`\nSource: \`${LOCOMO_DATASET}\` — the \`snap-research/locomo\` submodule, ${count(dataset.bytes)} bytes.`);
console.log(`Schema: \`benchmark/schemas/locomo10.schema.json\` — **${dataset.valid ? 'valid' : 'INVALID'}**.`);
if (!dataset.valid) {
  console.log('\nThe upstream file no longer matches the committed contract. First twenty:\n');
  for (const error of dataset.errors) console.log(`- ${error}`);
}

console.log(`\n## The corpus\n`);
console.log(`${dataset.samples.length} conversations · ${count(sessions)} sessions · ${count(turns)} turns · ${count(imageTurns)} turns carrying an image.`);
console.log(`Session timestamps under \`${SESSION_DATE_PATTERN}\`: **${datesParsed} parsed, ${datesRefused} refused.**`);
console.log(`Auxiliary session-level corpora (the paper's RAG databases): ${count(auxSessions)} observation blocks against ${count(sessions)} sessions.`);
if (stampedButAbsent > 0) {
  console.log(`\n**${stampedButAbsent} sessions are timestamped but have no transcript** in the release:\n`);
  for (const note of orphanNotes) console.log(`- ${note}`);
  console.log(`\nSessions here are built from the TRANSCRIPTS, never from the stamps, so those ${stampedButAbsent} do not enter the corpus as empty sessions. ${evidenceIntoOrphans === 0
    ? 'No QA evidence points into them, so nothing is made unanswerable by their absence — but a harness that timelines the stamps instead would report a conversation running months longer than its own transcript.'
    : `${evidenceIntoOrphans} evidence ids point into them, which is an unanswerable floor no retrieval policy can cross.`}`);
}

console.log(`\n## Questions\n`);
console.log(table({
  head: ['category', 'name', 'questions', 'with an `answer`', 'integer answers'],
  numeric: [2, 3, 4],
  rows: [...categories.entries()].sort(([a], [b]) => a - b).map(([category, bucket]) => [
    category, CATEGORY_NAMES[category] ?? '?', bucket.total, bucket.withAnswer, bucket.integerAnswer,
  ]),
}));
const adversarial = categories.get(5);
console.log(`\n${count(qaTotal)} questions in total; **${count(scorable)} are scorable for parity** (categories 1–4).`);
if (adversarial !== undefined) {
  console.log(`Category 5 is excluded from parity scoring: ${adversarial.total - adversarial.withAnswer} of its ${adversarial.total} questions carry no \`answer\` key at all, and the official evaluator scores the category by looking for the words "no information available" in the output — which marks the factually correct answer wrong. See TODO 02.`);
}

console.log(`\n## Evidence — the ceiling on any recall metric\n`);
console.log(`${count(evidenceTotal)} evidence ids. **${evidenceMalformed} are malformed** and **${evidenceUnresolved} do not resolve** to a turn in their own sample.`);
console.log(`\nDialog ids are unique WITHIN a sample and repeat across samples — every conversation restarts at \`D1:1\` — so resolution is always scoped by \`sample_id\`. A global lookup would silently resolve one conversation's evidence against another's turns and report a ceiling it had not earned.`);
if (unresolvedExamples.length > 0) {
  console.log(`\nThe ones that do not resolve:\n`);
  for (const example of unresolvedExamples) console.log(`- ${example}`);
  console.log(`\nNothing here is repaired. An evidence-recall metric is capped at ${((evidenceTotal - evidenceUnresolved) / evidenceTotal * 100).toFixed(2)}% by construction, and an oracle row that scores 1.000 anyway is a broken oracle.`);
}

console.log(`\n## The oracle ceiling — what a perfect retriever scores\n`);
console.log(`The official evaluator computes \`recall_acc\` per question: the fraction of that question's evidence present in the retrieved context, with an evidence-free question scoring 1 (${noEvidence} of them). Averaged per category, that is the ceiling — retrieve every turn in the corpus and the unresolvable ids are still absent.\n`);
const oracleRows = [...oracle.entries()].sort(([a], [b]) => a - b);
const scorableSamples = oracleRows.filter(([category]) => category !== 5).flatMap(([, values]) => values);
console.log(table({
  head: ['category', 'name', 'questions', 'oracle evidence recall'],
  numeric: [2, 3],
  rows: oracleRows.map(([category, values]) => [
    category, CATEGORY_NAMES[category] ?? '?', values.length, score(mean(values)),
  ]),
}));
console.log(`\n**Categories 1–4 together: ${score(mean(scorableSamples))}.** This is the number an oracle row must reproduce. A run whose oracle scores 1.000 is resolving evidence it should not be able to resolve — almost always a global dia_id lookup reading another conversation's turns.`);

console.log(`\n## Per conversation\n`);
console.log(table({
  head: ['sample_id', 'sessions', 'turns', 'QA', 'evidence ids', 'unresolved', 'observation blocks'],
  rows: perSample.map((row) => [row.sample, row.sessions, row.turns, row.qa, row.evidence, row.unresolved, row.observed]),
}));

console.log(`\n---\n`);
console.log(`LoCoMo is CC BY-NC 4.0 (Maharana et al., ACL 2024, arXiv:2402.17753). This repository does not redistribute it; \`${INIT_COMMAND}\` fetches it.`);
