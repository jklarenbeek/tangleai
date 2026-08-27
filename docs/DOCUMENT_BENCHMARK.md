# Document ingestion benchmark

Generated 2026-08-26 with Bun 1.4.0, `linkedom` 0.18.12, `unpdf` 1.6.2,
Playwright Core 1.62.1, and the built-in `hash-trigram-64` embedder.
Reproduce with `npm run documents:benchmark`.

The fixed corpus has five documents, 25 typed elements, and three labelled questions.
It covers static/noisy HTML, Markdown, a two-column PDF, and a table/figure PDF. Dynamic,
malformed, and oversized fixtures are exercised by the test suite rather than retrieval
scoring.

Extraction took 89.5 ms in the recorded run. None of four labelled Wikipedia
boilerplate strings survived. The synthetic PDF reading order was:

`Left heading → Left first → Left second → Right heading → Right first → Right second`

**Budget: 64 tokens per chunk, 8-token overlap** — far below the desktop's 450-token
default, and stated here because the numbers do not describe the default. At 450 tokens
every document in this corpus collapses into one or two chunks, which no chunker can be
told apart by.

| Strategy | Chunks | Recall@5 | MRR | over-budget chunks | Resolvable provenance | ms | heap delta MiB | embed calls | embedded texts | est. tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| heading-recursive | 6 | 100.0% | 1.000 | 0 | 100% | 1.7 | 0.00 | 6 | 9 | 210 |
| semantic-boundary | 15 | 100.0% | 0.833 | 0 | 100% | 1.1 | 0.00 | 11 | 43 | 378 |
| corrected-s2 | 6 | 100.0% | 1.000 | 0 | 100% | 2.1 | 0.00 | 11 | 34 | 386 |

## What this table cannot decide

Read as a comparison it is **saturated, and the tie is not a result.** Six chunks scored
at Recall@**5** means nearly every chunk is a hit by construction; a corpus this small
cannot separate three chunkers, and the identical 100% column is that ceiling, not
agreement between them. What the row does prove is that each strategy keeps every chunk
inside its budget with resolvable provenance — a regression gate, which is what it is
kept for.

The default therefore rests on cost, not on quality: recursive chunking answers in one
embedding pass, S2 spends an extra element-level pass (34 embedded texts against 9) for
a number this instrument cannot show a gain in. **Recursive heading-aware chunking stays
the default**, and S2 stays behind a strategy setting until a representative corpus —
the LoCoMo instrument (`LOCOMO_BENCHMARK.md`), over a real embedder — has a verdict. That the hash embedder
scores 100% here is not evidence that it predicts production semantic quality.

## Standalone checks

- Document HTML/PDF/storage/retrieval smoke: 84,706,504 bytes; 329 bundled modules;
  `{"ok":true,"bun":"1.4.0","standalone":true,"sources":2,"chunks":2}`.
- Compiled Bun WebView lifecycle smoke: 82,539,720 bytes; navigation, extraction,
  pre-abort, close, and `closeAll()` passed; no browser process remained.
- Full desktop with embedded UI: 87,307,464 bytes; 439 bundled modules; the running
  binary served the UI, status, and browser-capability endpoints.
- The isolated Playwright renderer ran in `ubuntu-playwright` with the pinned Chromium
  revision, rendered `example.com`, rejected `169.254.169.254` before navigation, closed,
  and left no matching browser process.
- Bun's Markdown CPU/heap profiles and module graph were also generated during the run:
  187.5 ms sampled CPU, 15.3 MiB profiled heap, and a 2.17 MiB bundled module payload;
  PDF.js contributed 1.64 MiB (75.6%) of that payload. Profiling artifacts were kept in
  the temporary build directory rather than committed.

The three sizes above other than the first are from the 2026-08-26 pre-fix run and move
by a few KB with any change to `@tangleai/documents`. The standalone entry points are
`scripts/document-compile-smoke.ts` and `scripts/webview-compile-smoke.ts`.

## Opt-in live provider smoke

With the uncommitted `.env` configuration, `npm run documents:live-smoke` fetched RFC
9110 from the RFC Editor, extracted 1,840 typed elements, produced 287 bounded chunks,
and embedded them in nine OpenRouter batches with `baai/bge-m3` at 1,024 dimensions. The
configured `qwen/qwen3.6-35b-a3b` chat model returned a non-empty answer grounded by two
document citations. An initial Wikipedia target was correctly refused by the configured
robots policy, so the reproducible default uses the RFC Editor. Secrets and generated
responses are not printed or retained after the in-memory smoke closes.
