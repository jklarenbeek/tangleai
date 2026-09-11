/** A separate before/after scorecard; previous purchased answers remain immutable. */
import assert from 'node:assert/strict';
import { restrictTo, type LiveReport } from './locomo-qa.ts';

export function summarizeHorizonFix(before: LiveReport, after: LiveReport, audit: { nonemptyCitedAnswers: number, programCompletions: number }) {
  const old = before.configurations.find((row) => row.kind === 'long-horizon')!;
  const row = after.configurations.find((entry) => entry.kind === 'long-horizon')!;
  assert.ok(old?.horizon && row?.horizon?.diagnostics);
  assert.deepEqual(old.horizon.ids, row.horizon.ids, 'the same registered subset must be measured');
  assert.equal(before.dataset.sha256, after.dataset.sha256);
  assert.equal(before.generated.provider, after.generated.provider);
  assert.equal(before.generated.model, after.generated.model);
  const diagnostics = row.horizon.diagnostics;
  const hashes = [...new Set(diagnostics.map((entry) => entry.policySha256))];
  assert.equal(hashes.length, 1, 'one policy per published run');
  const total = (key: 'visitedChars' | 'corpusChars' | 'calls' | 'executionRepairs' | 'reusedSubcalls' | 'synthesisAttempts') =>
    diagnostics.reduce((sum, entry) => sum + entry[key], 0);
  const scoredAfter = new Set(row.questions.results.map((entry) => entry.id));
  const sameIds = new Set(old.questions.results.filter((entry) => scoredAfter.has(entry.id)).map((entry) => entry.id));
  const allIds = new Set(row.horizon.ids);
  return {
    at: after.generated.at, model: after.generated.model, policy: row.horizon.strategy!, policySha256: hashes[0],
    baseline: {
      at: before.generated.at, planned: old.questions.planned, valid: audit.nonemptyCitedAnswers,
      programCompletions: audit.programCompletions, invalidPrograms: old.questions.invalid,
      unanswered: old.questions.unanswered, f1: old.f1.overall, recall: old.ceiling.overall, citedRecall: old.citedRecall.overall,
      calls: old.cost.turns, tokens: old.cost.tokens, unvisited: old.horizon.subcalls.unvisited,
      failedSubcalls: old.horizon.subcalls.failed,
    },
    current: {
      planned: row.questions.planned, answered: row.questions.answered,
      valid: row.questions.results.filter((entry) => entry.outcome === 'answered').length,
      invalid: row.questions.invalid, abstained: row.questions.abstained ?? 0,
      unanswered: row.questions.unanswered, f1: row.f1.overall, recall: row.ceiling.overall,
      citedRecall: row.citedRecall.overall, calls: row.cost.turns, attemptedCalls: total('calls'), tokens: row.cost.tokens,
      subcalls: row.horizon.subcalls, visitedChars: total('visitedChars'), corpusChars: total('corpusChars'),
      executionRepairs: total('executionRepairs'), reusedSubcalls: total('reusedSubcalls'), synthesisAttempts: total('synthesisAttempts'),
      turnsPerQuestion: row.horizon.turnsPerQuestion, maxSubcalls: row.horizon.maxSubcalls,
      questions: row.questions.results.map(({ id, f1, citedRecall, failed, outcome }) => ({ id, f1, citedRecall, failed, outcome })),
    },
    paired: { before: restrictTo(old, sameIds), after: restrictTo(row, sameIds) },
    comparisons: before.configurations.filter((entry) => entry.kind !== 'long-horizon').map((entry) => ({
      key: entry.key, ...restrictTo(entry, allIds),
    })),
  };
}

export function renderHorizonFix(summary: ReturnType<typeof summarizeHorizonFix>) {
  const { baseline: old, current: fresh } = summary;
  const f = (value: number | null) => value === null ? '—' : value.toFixed(3);
  return `# Bounded-agent repair benchmark

Measured ${summary.at} with ${summary.model}, policy \`${summary.policy}\`.
The same twelve question IDs, model, corpus, ${fresh.turnsPerQuestion}-turn bound and
${fresh.maxSubcalls}-subcall cap are retained. Prompts, chunk size and final synthesis
changed together; this measures the combined repair, not an isolated prompt effect.

| Measurement | Previous | Repaired |
|---|---:|---:|
| Nonempty cited answers | ${old.valid}/${old.planned} | ${fresh.valid}/${fresh.planned} |
| Invalid results | ${old.invalidPrograms} reducer failures, one empty completed program | ${fresh.invalid} |
| Explicit abstentions | not separately recorded | ${fresh.abstained} |
| Unanswered wire / budget | ${old.unanswered.wire} / ${old.unanswered.budget} | ${fresh.unanswered.wire} / ${fresh.unanswered.budget} |
| Answer F1 | ${f(old.f1)} | ${f(fresh.f1)} |
| Evidence recall | ${f(old.recall)} | ${f(fresh.recall)} |
| Cited evidence recall | ${f(old.citedRecall)} | ${f(fresh.citedRecall)} |
| Successful paid requests | ${old.calls} | ${fresh.calls} |
| Provider-reported tokens | ${old.tokens} | ${fresh.tokens} |
| Unvisited pieces | ${old.unvisited} | ${fresh.subcalls.unvisited} |
| Failed chunk requests | ${old.failedSubcalls} | ${fresh.subcalls.failed} |

The previous label of one valid reply counted a completed answer slot whose decoded
answer was empty. A zero-network replay of its saved responses established zero
nonempty cited answers. Its raw report and cost remain unchanged. The baseline F1
excludes its wire failure; over the same ${summary.paired.before?.n ?? 0} scored questions,
F1 is ${f(summary.paired.before?.f1.overall ?? null)} before and ${f(summary.paired.after?.f1.overall ?? null)} after.

The repaired run included ${fresh.visitedChars}/${fresh.corpusChars} source characters
in leaf requests across its questions. ${fresh.subcalls.failed} chunk request(s) failed;
visiting a piece does not guarantee a usable response. It made ${fresh.attemptedCalls} model attempts,
${fresh.synthesisAttempts} synthesis attempts, ${fresh.executionRepairs} runtime repairs and
${fresh.reusedSubcalls} local reuses of already validated leaf results. Failed provider
attempts can consume tokens the provider never reports; successful request counts
are not a census of HTTP retries.

## What changed

JarenJS still owns chunking, environments, program authoring and compilation, recursive
execution, structured output and budgets. Tangle supplies a QA policy: whole-corpus line
coverage within a per-piece bound; an execution-tested, lossless reducer example;
structured evidence whose ids are checked against the piece; and a separate short,
cited answer that permits grounded inference. Empty answers are invalid; explicit
abstentions are scored zero and shown separately. Oversized corpora refuse before
spending instead of silently dropping later pieces.

Author repairs are bounded. A runtime reducer repair must preserve the map prompt,
and identical validated leaf requests are reused only inside that question. The host
accounts for every author, extraction and synthesis attempt before dispatch. The full
checked evidence slot is read under a size bound, avoiding the runner's answer-preview
truncation. A cited answer means its reference IDs passed validation; it does not prove
the interpretation is factually correct. F1 and cited recall retain those limitations.
The repaired answers still include a wrong inference for \`conv-42#4\` and excessive
detail in several answers. No prompts were retuned against these final scores.

Upstream's separate live depth scorecard does not establish a benefit from deeper
recursion. This repair keeps depth zero and makes no model-family claim. The twelve
questions form a diagnostic subset, not a statistically strong quality comparison.

## Every repaired question

| Question | Outcome | F1 | Cited evidence recall | Failed chunks |
|---|---|---:|---:|---:|
${fresh.questions.map((row) => `| ${row.id} | ${row.outcome} | ${f(row.f1)} | ${f(row.citedRecall)} | ${row.failed ?? 0} |`).join('\n')}

## Earlier direct-answer rows on these same twelve questions

| Strategy | Questions | F1 | Evidence recall |
|---|---:|---:|---:|
${summary.comparisons.map((row) => `| ${row.key} | ${row.n ?? 0} | ${f(row.f1?.overall ?? null)} | ${f(row.ceiling?.overall ?? null)} |`).join('\n')}

These comparison answers were purchased in the earlier run; they were not rerun or
silently rescored against a different question set.

## Reproduction and artifacts

Initialize \`benchmark/locomo\` and configure the provider in \`.env\`. Use a new report
and cache path to retain previous measurements:

\`\`\`sh
node --env-file=.env benchmark/locomo-qa.ts --live --thinking default --rows long-horizon --live-json /tmp/horizon.json --cache /tmp/horizon.sqlite --md /tmp/horizon.md
\`\`\`

\`--horizon-strategy legacy\` reproduces the former request policy. The coverage policy
refuses a nonzero \`--horizon-depth\`; a depth experiment must explicitly select legacy.
Policy SHA-256: \`${summary.policySha256}\`.

Sources: [previous paid report](../benchmark/results/locomo-qa-live-jaren-0832.json),
[answer audit](../benchmark/results/horizon-answer-audit.json),
[repaired paid report](../benchmark/results/locomo-qa-live-horizon-fixed.json),
[implementation](../benchmark/lib/horizon-agent.ts),
[regression tests](../test/benchmark/horizon-agent.test.ts).
`;
}
