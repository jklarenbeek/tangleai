# Tangle AI

Self-improving memory and retrieval for agents, built on the
[jarenjs](https://github.com/jklarenbeek/jarenjs) suite as the foundational
layer.

The codebase is **TypeScript-only with no build step**: Node 24's native
type stripping runs `.ts` directly (tests and workspace packages included),
and `tsc --noEmit` under `strict` is the type gate. That inversion of the
jarenjs house style is deliberate — this repo doubles as the standing test
of jarenjs's published types under a strict TS consumer; findings live in
[JARENASK.md](JARENASK.md).

## What runs today

```sh
npm install
npm run check      # strict typecheck + complete offline test suite
npm run skeleton   # the whole loop, end to end, offline
npm run desktop    # folder memory + versioned web/PDF document corpus
npm run documents:benchmark
# after copying .env.example to .env and adding an OpenRouter key:
npm run documents:live-smoke
```

The skeleton ingests evidenced observations and runs them through the
policy chain — novelty gate → contradiction resolution → crystallization →
outcome learning → embedding-ranked recall — then mirrors the surviving
memories into an unmodified `@jarenjs/ai` ledger, where a plain jarenjs
agent can recall them by tag:

```
ingest: 5 admitted, 1 filtered as near-verbatim repeats
contradiction: judged 2 similar pairs, resolved 1
crystallize: examined 5, merged 1
outcome: "Deploys must run the full gate before shipping" boosted to confidence 0.65
recall for: "what is the current api rate limit?"
  0.594  [fact] The API rate limit is 500 requests per minute  (evidence: gateway config v2)
answer (grounded): The API rate limit is 500 requests per minute — per gateway config v2
ledger mirror: 3 live memories admitted to a @jarenjs/ai ledger
  ledger recall near "what is the current api rate limit?": The API rate limit is 500 requests per minute (0.594, skipped 0)
```

The vectors travel with their identity (`embeddedBy: { model, dims }`),
which is what lets the mirrored ledger rank them by meaning through the
same `@jarenjs/ai` embedder seam that wrote them — and what lets every
Tangle policy refuse to compare vectors from two models.

## Packages

| package | what it is |
|---|---|
| `@tangleai/core` | coded errors, zero-dep k-means, token heuristics, and the memory-unit JSON Schema (a strict superset of the jarenjs ledger memory — evidence stays mandatory, and a vector never travels without its `embeddedBy` identity). Vector arithmetic is `@jarenjs/core/vector`'s, not ours |
| `@tangleai/memory` | the policy layer over an injected store: novelty gating, plan/apply crystallization, judge-injected contradiction resolution, ground-truth outcome learning, `recallByEmbedding` (identity-gated, skip-reporting) |
| `@tangleai/search` | zero-dependency SearxNG JSON client; `compose/searxng/` holds the docker settings |
| `@tangleai/documents` | static-first HTTP(S) fetching with URL/DNS/redirect/stream budgets, typed HTML/Markdown/PDF extraction, recursive/semantic/S2 chunkers, versioned corpus contracts, optional browser adapters, and identity-gated chunk retrieval |
| `@tangleai/store` | persistence: the same 4-method `MemoryStore` contract over SQLite plus transactional source/version/element/chunk activation and the run/event log |
| `@tangleai/pipeline` | the loop as an executable `jaren-dag` document (`@jarenjs/flow` runs it, `@jarenjs/mermaid` draws it FROM it), with `@jarenjs/ai`'s hash embedder (at a measured width) and the rule judge as injectable stand-ins |

Embeddings are not a Tangle package any more: the wire client
(`createEmbeddingClient`, the same OpenAI-compatible provider family the
chat client speaks), the deterministic reference (`createHashEmbedder`),
the probe and the `{ embed, model, dims }` seam are `@jarenjs/ai/embed`,
and the kernels are `@jarenjs/core/vector`. Tangle brings the policies
and the configuration.

## The apps

The desktop keeps browser automation optional. Ordinary HTML, text, Markdown, and PDF
documents are fetched and parsed inside the application; only client-rendered shells need
a browser process.

**The house rule, and its one recorded exemption.** Everything here is
jarenjs-suite-only — no third-party runtime dependency — except the document
lane, which takes three, deliberately (CONVENTIONS §1 asks that a new exemption
be a recorded decision rather than a default):

| Dependency | Where | Why the suite cannot supply it |
|---|---|---|
| `unpdf` 1.6.2 | `@tangleai/documents` | A PDF text/geometry extractor. Out of scope for jarenjs for the foreseeable future; `@jarenjs/core/chunk` cuts text, it does not read page boxes. |
| `linkedom` 0.18.12 | `@tangleai/documents` | An HTML5 parse tree with browser error recovery, plus a CSS selector engine. `@jarenjs/md/html` is explicitly *not* an HTML5 parser: it is an allow-list for raw HTML inside Markdown and drops what it does not recognise — correct for rendering trusted fragments, unusable for scraping hostile pages. |
| `playwright-core` 1.62.1 | `apps/scraper` only | A browser driver, and a browser is not a library. It never enters `dist/tangle`; the desktop reaches it over the adapter seam or not at all. |

The first two DO travel inside the compiled binary. They are the price of reading
PDFs and real web pages; the boundary they must not cross is the API — no
LangChain `Document`, no DOM type, and no `unpdf` type appears in
`@tangleai/documents`' contracts.

**`apps/desktop`** — a self-hosting desktop app: point it at a folder,
sync it (content-hash incremental) through the pipeline, watch the DAG
run LIVE over an SSE stream and browse every past run's per-node story,
search the curated memory (superseded chains included), ingest/search versioned web and
PDF sources on the Documents page, and chat over the two explicit retrieval lanes with
citations. Chat degrades honestly: with no model
configured (or a dead wire) you get grounded recall — the memories
themselves, cited — never an invention. The whole API is one
`@jarenjs/contract` document served over `node:http`; the UI is a
`@jarenjs/app` document rendered by `@jarenjs/view`; storage is SQLite
through `@jarenjs/db`.

```sh
npm run desktop            # dev (Node or Bun), http://127.0.0.1:4700
npm run desktop:compile    # one self-contained executable → dist/tangle
./dist/tangle --folder ~/notes
```

Document ingestion defaults to recursive heading-aware chunks. Changed sources activate
transactionally only after extraction, chunking, embedding, and persistence succeed;
unchanged content is not embedded again. Configure SearxNG discovery, experimental S2,
or a dynamic-page renderer in Settings. Results are recorded in
[docs/DOCUMENT_BENCHMARK.md](docs/DOCUMENT_BENCHMARK.md).
The opt-in live smoke uses the OpenRouter chat/embedding models configured in `.env`;
offline CI never requires those credentials.

**`apps/scraper`** — the optional isolated Playwright renderer. It is not required by the
desktop and is intended to run in the `ubuntu-playwright` distrobox or another sandboxed
container. See [apps/scraper/README.md](apps/scraper/README.md).

Cross-compile with Bun's targets, e.g.
`bun build --compile --target=bun-windows-x64 apps/desktop/src/main.ts`
(run `bun scripts/embed-assets.ts` first so the UI travels inside).

**`apps/pages`** — the GitHub Pages site (`bun apps/pages/build.ts` →
`apps/pages/dist`, deployed by `.github/workflows/pages.yml`). Its demo
is not a mock: the real pipeline document executes in your browser over
the in-memory store, and the recall you ask for afterwards is real
ranked retrieval — the superseded record provably cannot surface.

## Where things stand

- [TODO.md](TODO.md) — the campaign; next order is the LoCoMo benchmark,
  which gates all further policy work
- [docs/BOUNDARY.md](docs/BOUNDARY.md) — what belongs in `@jarenjs/ai`
  versus here, and the one test-pinned contract between them
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the loop, the two
  load-bearing ordering rules, the house style
- [docs/PAPERS.md](docs/PAPERS.md) — the research this implements, with
  per-paper status; PDFs archived in [docs/refs/](docs/refs/)
- [docs/workflow/](docs/workflow/README.md) — how this repo is changed and
  proved: conventions, campaign, health pass, release — each with a
  machine-readable stage block, and [EVOLVE.md](docs/workflow/EVOLVE.md),
  the gated design for running these workflows as evolvable DAGs
- `prompts/` — memflow's TOML prompt packs, carried as data for orders 04–07
