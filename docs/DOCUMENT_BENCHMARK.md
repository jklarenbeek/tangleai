# Document ingestion benchmark

Generated 2026-08-26 with Bun 1.4.0, `linkedom` 0.18.12, `unpdf` 1.6.2,
Playwright Core 1.62.1, and the built-in `hash-trigram-64` embedder.

The fixed corpus has five documents, 25 typed elements, and three labelled questions.
It covers static/noisy HTML, Markdown, a two-column PDF, and a table/figure PDF. Dynamic,
malformed, and oversized fixtures are exercised by the test suite rather than retrieval
scoring.

Extraction took 100.8 ms in the recorded run. None of four labelled Wikipedia
boilerplate strings survived. The synthetic PDF reading order was:

`Left heading → Left first → Left second → Right heading → Right first → Right second`

| Strategy | Chunks | Recall@5 | MRR | >64-token violations | Resolvable provenance | ms | heap delta MiB | embed calls | embedded texts | est. tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| heading-recursive | 6 | 100.0% | 1.000 | 0 | 100% | 1.9 | 0.00 | 6 | 9 | 203 |
| semantic-boundary | 15 | 100.0% | 0.833 | 0 | 100% | 1.3 | 0.00 | 11 | 43 | 378 |
| corrected-s2 | 6 | 100.0% | 1.000 | 0 | 100% | 2.2 | 0.00 | 11 | 34 | 379 |

Standalone checks:

- Document HTML/PDF/storage/retrieval smoke: 85,755,080 bytes; 329 bundled modules.
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

This small offline fixture benchmark is a regression gate, not evidence that the hash
embedder predicts production semantic quality. Recursive heading-aware chunking remains
the default: corrected S2 tied it on retrieval here but required element embeddings and
did not demonstrate a quality gain.

## Opt-in live provider smoke

With the uncommitted `.env` configuration, `npm run documents:live-smoke` fetched RFC
9110 from the RFC Editor, extracted 1,840 typed elements, produced 287 bounded chunks,
and embedded them in nine OpenRouter batches with `baai/bge-m3` at 1,024 dimensions. The
configured `qwen/qwen3.6-35b-a3b` chat model returned a non-empty answer grounded by two
document citations. An initial Wikipedia target was correctly refused by the configured
robots policy, so the reproducible default uses the RFC Editor. Secrets and generated
responses are not printed or retained after the in-memory smoke closes.

Reproduce the retrieval table with `npm run documents:benchmark`. The standalone smoke
entry points are `scripts/document-compile-smoke.ts` and
`scripts/webview-compile-smoke.ts`.
