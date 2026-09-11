# Paid integration verification

JarenJS 0.83.2; answers by OpenRouter `z-ai/glm-5.3-flash`, adversarial
judgments by `qwen/qwen3.8-27b`, embeddings by
`baai/bge-m3`/1024. Thinking stays at the model's
default. Each benchmark run checks its own configured 200-request ceiling
before purchasing calls, with at most four concurrent calls per run.

These are fresh dated attempts; the August/September baseline reports remain
unchanged. This is a current-stack verification, not a controlled attribution
of model-quality changes to the dependency upgrade. Reused embeddings and
completion replays are recorded separately in each raw run.

## Answer comparisons

Latest run: 2026-09-11T09:18:14.907Z. 4 runs,
513 charged logical requests, 2539115 provider-reported tokens,
1 wire errors. The five direct-answer rows use the same
seeded 64-question sample plus six separately judged adversarial questions;
the bounded long-horizon agent uses its registered 12-question subset.

| Strategy | Valid / planned | Answer F1 | Evidence recall ceiling | Invalid | Wire/budget unanswered | Adversarial judged |
|---|---:|---:|---:|---:|---:|---:|
| long-context | 64/64 | 0.318 | 0.998 | 0 | 0/0 | 6/6 |
| near-raw | 64/64 | 0.121 | 0.202 | 0 | 0/0 | 6/6 |
| rag-observation | 64/64 | 0.280 | 0.573 | 0 | 0/0 | 6/6 |
| rag-summary | 64/64 | 0.149 | 0.804 | 0 | 0/0 | 6/6 |
| long-horizon | 1/12 | 0.000 | 0.311 | 10 | 1/0 | 0/0 |
| near | 64/64 | 0.115 | 0.202 | 0 | 0/0 | 6/6 |

Invalid replies remain zero scores in the F1 denominator; wire failures remain
unanswered. The valid-reply count does not rescore the attempt.
Retrieval rows use k=10. The ceiling is measured over the evidence each row actually sees, including
sub-calls for the agent. Unequal sets must not be ranked as equal coverage.
The [complete rendering](LOCOMO_REFRESH.md) includes per-category results,
common-question comparisons, citation resolution, latency, token costs and
agent stops. [Raw report](../benchmark/results/locomo-qa-live-jaren-0832.json).
The answer instrument charges logical client calls; provider-internal retry
attempts are not a separate HTTP request census. Its ceiling applies to those
logical calls, not dollar spend.

The agent's failed reductions expose a telemetry omission upstream: completed
map steps survive a failure, while aggregate sub-call counts disappear.
[The replay instrument](../benchmark/locomo-telemetry.ts) replayed
156 saved completions with 0
network requests and 1 local cache miss(es), preserving
the original failed-wire outcomes. It recovered 132
sub-calls (previous aggregate 12) and their failure
reasons. Scores, coverage, usage and program outcomes were asserted unchanged;
original purchase times and costs are retained. The
[receipt](../benchmark/results/locomo-telemetry-replay-jaren-0832.json) contains
the before/after hashes and every changed field, so the original report is
exactly recoverable. Run it against a copy of the report and its saved cache:

```sh
node --env-file=.env benchmark/locomo-telemetry.ts --live-json /tmp/locomo-refresh.json --cache /tmp/locomo-refresh.sqlite --receipt /tmp/telemetry-replay.json
```

## Grounding

Run: 2026-09-11T09:02:29.801Z. 123 purchased requests,
84864 provider-reported tokens, 0
wire errors. The registered decision is `adopt-claim-citations`.

| Stratum / treatment | Answered | Answer F1 | Supported-claim micro F1 | Invalid | Wire/budget unanswered |
|---|---:|---:|---:|---:|---:|
| fixture / no-documents | 16/16 | 0.198 | 0.000 | 0 | 0/0 |
| fixture / grounded-answer | 16/16 | 0.738 | 0.898 | 0 | 0/0 |
| locomo / no-documents | 16/16 | 0.027 | — | 0 | 0/0 |
| locomo / grounded-answer | 16/16 | 0.123 | — | 0 | 0/0 |

Claim scores apply to the authored fixture's known predicates; they do not
measure semantic grounding for arbitrary documents. The no-generation
retrieval row remains in the [complete rendering](GROUNDING_REFRESH.md),
beside citation outcomes, paired intervals and adoption clauses. The registered
baseline scores raw structured answers; the desktop additionally applies
the suite's supplied-reference/unique-claim gate and one bounded repair.
[Raw report](../benchmark/results/grounding-live-jaren-0832.json).

## Desktop smoke

2026-09-11T09:06:19.765Z: the actual desktop dispatcher ingested
[RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html), extracted 1840 elements into
319 chunks, made 10 ingest embedding requests
and returned an answer with 1 document citation(s), using
`openrouter/z-ai/glm-5.3-flash` and `baai/bge-m3/1024`. This proves the live path;
the benchmark above supplies the quality measurements.
[Raw smoke result](../benchmark/results/documents-live-jaren-0832.json).

## Durable agent smoke

2026-09-11T09:11:47.131Z: a real `openrouter/z-ai/glm-5.3-flash`
completion passed through the public MAS agent, SQLite job worker, typed review
pause, outbox reconciliation and resumed task. All three invocations completed
across 2 segments using 1 model call(s)
and 227 reported tokens. Trace and Mermaid topology checks
passed. The review response is supplied by this test; no person was contacted.
This uses the smoke's controlled clock and is not a latency measurement.
[Raw result](../benchmark/results/mas-live-jaren-0832.json).

## Reproduction

Initialize the dataset with `git submodule update --init benchmark/locomo`.
Use a new output filename and empty cache directory to retain these attempts
and buy fresh answers. Run the four answer invocations sequentially, changing
`--rows` through `near-raw,near`, `long-context,rag-summary`,
`rag-observation`, and `long-horizon`:

```sh
node --env-file=.env benchmark/locomo-qa.ts --live --thinking default --rows near-raw,near --live-json /tmp/locomo-refresh.json --cache /tmp/locomo-refresh.sqlite --md /tmp/locomo-refresh.md
node --env-file=.env benchmark/grounding.ts --live --thinking default --cache /tmp/grounding-refresh.sqlite --md /tmp/grounding-plan.md
# Review the printed plan, then execute its exact id:
node --env-file=.env benchmark/grounding.ts --live --thinking default --cache /tmp/grounding-refresh.sqlite --authorize PLAN_ID --live-json /tmp/grounding-refresh.json --md /tmp/grounding-refresh.md
bun scripts/live-openrouter-smoke.ts
node --env-file=.env scripts/mas-consumer-smoke.ts --live
```

To regenerate the published documents from the committed reports without model
calls, omit `--live` and point `--live-json`/`--md` at the corresponding
refresh files, then run `node benchmark/jaren-summary.ts`. The normal
`npm run check` validates the dated artifacts without spending credits.
