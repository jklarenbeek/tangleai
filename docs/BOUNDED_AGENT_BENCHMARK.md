# Bounded-agent repair benchmark

Measured 2026-09-11T10:38:01.713Z with z-ai/glm-5.3-flash, policy `covered-evidence-v1`.
The same twelve question IDs, model, corpus, 16-turn bound and
12-subcall cap are retained. Prompts, chunk size and final synthesis
changed together; this measures the combined repair, not an isolated prompt effect.

| Measurement | Previous | Repaired |
|---|---:|---:|
| Nonempty cited answers | 0/12 | 12/12 |
| Invalid results | 10 reducer failures, one empty completed program | 0 |
| Explicit abstentions | not separately recorded | 0 |
| Unanswered wire / budget | 1 / 0 | 0 / 0 |
| Answer F1 | 0.000 | 0.570 |
| Evidence recall | 0.311 | 1.000 |
| Cited evidence recall | 0.000 | 0.729 |
| Successful paid requests | 156 | 167 |
| Provider-reported tokens | 253604 | 586730 |
| Unvisited pieces | 495 | 0 |
| Failed chunk requests | 0 | 1 |

The previous label of one valid reply counted a completed answer slot whose decoded
answer was empty. A zero-network replay of its saved responses established zero
nonempty cited answers. Its raw report and cost remain unchanged. The baseline F1
excludes its wire failure; over the same 11 scored questions,
F1 is 0.000 before and 0.621 after.

The repaired run included 1279916/1279916 source characters
in leaf requests across its questions. 1 chunk request(s) failed;
visiting a piece does not guarantee a usable response. It made 168 model attempts,
12 synthesis attempts, 0 runtime repairs and
0 local reuses of already validated leaf results. Failed provider
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
The repaired answers still include a wrong inference for `conv-42#4` and excessive
detail in several answers. No prompts were retuned against these final scores.

Upstream's separate live depth scorecard does not establish a benefit from deeper
recursion. This repair keeps depth zero and makes no model-family claim. The twelve
questions form a diagnostic subset, not a statistically strong quality comparison.

## Every repaired question

| Question | Outcome | F1 | Cited evidence recall | Failed chunks |
|---|---|---:|---:|---:|
| conv-26#67 | answered | 1.000 | 1.000 | 0 |
| conv-41#50 | answered | 0.103 | 0.000 | 1 |
| conv-42#4 | answered | 0.000 | 1.000 | 0 |
| conv-42#39 | answered | 0.267 | 1.000 | 0 |
| conv-42#127 | answered | 0.667 | 1.000 | 0 |
| conv-42#159 | answered | 1.000 | 1.000 | 0 |
| conv-43#1 | answered | 0.332 | 1.000 | 0 |
| conv-43#11 | answered | 1.000 | 0.250 | 0 |
| conv-44#122 | answered | 0.667 | 1.000 | 0 |
| conv-47#51 | answered | 0.400 | 0.500 | 0 |
| conv-47#58 | answered | 1.000 | 1.000 | 0 |
| conv-50#4 | answered | 0.400 | 0.000 | 0 |

## Earlier direct-answer rows on these same twelve questions

| Strategy | Questions | F1 | Evidence recall |
|---|---:|---:|---:|
| long-context | 12 | 0.375 | 1.000 |
| near-raw | 12 | 0.288 | 0.264 |
| rag-observation | 12 | 0.280 | 0.583 |
| rag-summary | 12 | 0.126 | 0.861 |
| near | 12 | 0.286 | 0.264 |

These comparison answers were purchased in the earlier run; they were not rerun or
silently rescored against a different question set.

## Reproduction and artifacts

Initialize `benchmark/locomo` and configure the provider in `.env`. Use a new report
and cache path to retain previous measurements:

```sh
node --env-file=.env benchmark/locomo-qa.ts --live --thinking default --rows long-horizon --live-json /tmp/horizon.json --cache /tmp/horizon.sqlite --md /tmp/horizon.md
```

`--horizon-strategy legacy` reproduces the former request policy. The coverage policy
refuses a nonzero `--horizon-depth`; a depth experiment must explicitly select legacy.
Policy SHA-256: `dd83b5fdd4946ef0e3f597dc2f596075bdf94f0dd123c22fc85b7e2fe4808902`.

Sources: [previous paid report](../benchmark/results/locomo-qa-live-jaren-0832.json),
[answer audit](../benchmark/results/horizon-answer-audit.json),
[repaired paid report](../benchmark/results/locomo-qa-live-horizon-fixed.json),
[implementation](../benchmark/lib/horizon-agent.ts),
[regression tests](../test/benchmark/horizon-agent.test.ts).
