# Document ingestion benchmark

Generated 2026-10-01T03:44:22.386Z with Bun 1.4.2; embedder hash-trigram-512/512.

Fixed corpus: 5 documents, 25 typed elements, 3 labelled questions.

Extraction: 1759.5 ms; known Wikipedia boilerplate hits: 0/4; multi-column order: Left heading → Left first → Left second → Right heading → Right first → Right second.

Budget: 64 tokens per chunk, 8-token overlap.

| Strategy | Chunks | Recall@5 | MRR | over-budget chunks | Resolvable provenance | ms | heap delta MiB | embed calls | embedded texts | est. tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| heading-recursive | 6 | 100.0% | 1.000 | 0 | 100% | 67.4 | 7.60 | 6 | 9 | 210 |
| semantic-boundary | 22 | 66.7% | 0.444 | 0 | 100% | 63.7 | 0.00 | 11 | 50 | 377 |
| corrected-s2 | 6 | 100.0% | 1.000 | 0 | 100% | 42.0 | 0.00 | 11 | 34 | 386 |

This fixture benchmark is a regression gate, not evidence that the tiny offline hash embedder predicts production semantic quality. Keep recursive chunking as the default until a representative corpus shows a repeatable S2 retrieval gain worth its extra element-embedding work.

Reproduce with `npm run documents:benchmark`. These keyless measurements use
JarenJS 0.91.4 and the current 512-dimensional offline embedder. The earlier
2026-09-11 table used 64 dimensions and is not a matched performance comparison.
Wall time and heap are single observations taken alongside local checks.

## What this table can decide

All three strategies stay within their chunk budgets and retain resolvable
provenance. Recursive and S2 recall all three labelled answers; semantic-boundary
recalls two and has lower reciprocal rank. This five-document corpus is too small
to establish production semantic quality. In particular, selecting five of six
chunks leaves little room to distinguish recursive from S2 retrieval.

Recursive heading-aware chunking remains the default. S2 uses an extra
element-embedding pass (34 texts against 9 here) without a measured recall gain.
The separate [governed retrieval instrument](PRIHA_BENCHMARK.md) measures opt-in
parent/child granularities, semantic and lexical lanes, and fusion over its own
registered fixture. Neither keyless result establishes live model quality.

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
