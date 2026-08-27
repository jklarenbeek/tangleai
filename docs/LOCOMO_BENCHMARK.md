# LoCoMo benchmark — the answer path, and the baselines that make it mean something

Source: `benchmark/locomo/data/locomo10.json` (sha256 `79fa87e90f04…`, 2,805,274 bytes, schema valid).
Keyless embedder `hash-trigram-64` (64 dims), k = 10 memories per prompt, sample seed 17753. Reproduce with `npm run benchmark:locomo:qa`; add `--live --rows …` for the model tier (needs `.env`, see `.env.example`).

Two numbers per row, always together: the **ceiling** is evidence recall at k — the fraction of a question's gold turns among the memories the prompt held, the official `recall_acc` — and the **F1** is the official token F1 of a model's answer over those same memories. A large gap means the facts were there and the model did not use them (a prompting problem); a small gap under a low ceiling is a retrieval problem. Beside them, the recall of the gold turns over the memories the model *cited*: whether it used the right ones, not merely had them.

## The rows

| row | what answers | what the prompt holds | ceiling reads |
|---|---|---|---|
| **long context** | the whole conversation in the request — the paper's headline baseline | every turn, `[id] (date) speaker: text`, in transcript order | every gold turn is present, so ≈ 1 |
| **RAG over dialog turns** (`near-raw`) | the pipeline with every policy inert — retrieval over raw turns, the paper's `dialog` corpus | the 10 nearest turns by cosine | the gold turns among them |
| **RAG over observations** | the release's own `observation` corpus (2,541 facts, each citing the turns it was written from) through the same pipeline | the 10 nearest observations | the gold turns the retrieved observations cite |
| **RAG over session summaries** | the release's own `session_summary` corpus (272 summaries, each evidencing its whole session) | the 10 nearest summaries | SESSION-level: a retrieved summary counts as holding every turn of its session, whether or not it kept the fact |
| **long-horizon agent** | `createLongHorizonAgent` over `createEnvironment` — the suite's own answer to a corpus that will not fit: it authors a compile-gated program over the transcript's digest and fans sub-calls over the pieces | the root sees a digest; each sub-call sees one piece | the gold turns some sub-call was shown |
| **Tangle** (`near`) | the pipeline with the shipped policies — the row the policy matrix and the temporal lane tune | the 10 nearest surviving memories | the gold turns among them (a merged survivor cites every turn it absorbed) |

## The corpus and the questions

10 conversations · 272 sessions (0 refused for an unparseable stamp) · 5,882 turns, 910 with an image caption appended · 5 collapsed onto an identical earlier turn · span 2022-01-21T19:31:00.000Z → 2024-01-12T13:41:00.000Z (read as UTC, a convention).
One memory per turn, one store per conversation, one `pipeline.run` per session, the pipeline's clock the conversation's last session instant; max 20 contradiction pairs judged per run. 1,986 questions; **1,540 scorable** — 282 multi-hop, 321 temporal, 96 open-domain, 841 single-hop — 4 of which cite no evidence and score a ceiling of 1 by the official rule. Category 5 (446) is excluded from every F1: adversarial questions carry no `answer` (444 of 446) and the official evaluator scores the category by keyword, which marks the factually correct answer wrong; the judge lane below reports them separately.

**The release's derived corpora**, as the RAG rows ingest them and nothing repaired: 2,541 observations in 272 session blocks (0 naming no transcript session, 0 empty), carrying 2,561 turn references — 15 observations cite a list, 0 references resolve to no turn, 0 collapse onto an identical earlier observation; 272 session summaries in 272 blocks (0 orphaned, 0 empty), each evidencing its session's turns — 5,882 in all.

**The sample.** The live tier answers a seeded, stratified draw — 16 per scorable category and 6 adversarial, 64 scorable questions in all (16 multi-hop, 16 temporal, 16 open-domain, 16 single-hop) — sized so two rows fit one request ceiling; the ids are in the report, so every run answers the same questions.

## The scorer's gate

| prediction | overall | 1 multi-hop | 2 temporal | 3 open-domain | 4 single-hop |
|---|---:|---:|---:|---:|---:|
| _the released answer, as the scorer cuts it_ | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 |
| _the released answer, verbatim_ | 0.995 | 1.000 | 1.000 | 0.927 | 1.000 |

**Gate passed.** The released answer scores exactly 1.000 against itself in every category once category 3 is cut at its first `;` as the official evaluator cuts only the truth. Verbatim, category 3 scores 0.927: that asymmetry is the published scorer's, and it is why a category-3 answer that repeats the release word for word cannot reach 1.

## The keyless tier — every commit, no model

| row | corpus | novelty / contradiction / crystallize | runs | observations | admitted | filtered | judged | contradictions | resolutions | merged | live | total | unranked |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| near-raw | turns | 2 / 2 / 2 | 272 | 5882 | 5882 | 0 | 0 | 0 | 0 | 0 | 5877 | 5877 | 0 |
| rag-observation | observation | 2 / 2 / 2 | 272 | 2541 | 2541 | 0 | 0 | 0 | 0 | 0 | 2541 | 2541 | 0 |
| rag-summary | summary | 2 / 2 / 2 | 272 | 272 | 272 | 0 | 0 | 0 | 0 | 0 | 272 | 272 | 0 |
| near | turns | 0.97 / 0.8 / 0.9 | 272 | 5882 | 5876 | 6 | 5326 | 63 | 0 | 339 | 5485 | 5537 | 0 |

The ceiling at k = 10, over all 1,540 scorable questions and over the sample; and the model-free floor — the 10 retrieved memories quoted, unedited, as the answer — which any model has to beat to have earned its call. The long-context row has no floor (quoting a whole conversation is not an answer) and the long-horizon row has no keyless ceiling (the agent authors its own retrieval, so there is nothing to read without a model).

| row | questions | ceiling | 1 multi-hop | 2 temporal | 3 open-domain | 4 single-hop | verbatim F1 | 1 multi-hop | 2 temporal | 3 open-domain | 4 single-hop |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **long context (the whole conversation in the request)** | all | 0.996 | 0.994 | 0.997 | 0.969 | 1.000 | — | — | — | — | — |
| **long context (the whole conversation in the request)** | sample | 0.998 | 0.991 | 1.000 | 1.000 | 1.000 | — | — | — | — | — |
| **RAG over dialog turns (the pipeline, policies off)** | all | 0.174 | 0.073 | 0.208 | 0.072 | 0.207 | 0.018 | 0.054 | 0.003 | 0.011 | 0.012 |
| **RAG over dialog turns (the pipeline, policies off)** | sample | 0.199 | 0.031 | 0.250 | 0.141 | 0.375 | 0.015 | 0.032 | 0.004 | 0.014 | 0.011 |
| **RAG over the release's observations** | all | 0.353 | 0.175 | 0.441 | 0.166 | 0.401 | 0.028 | 0.058 | 0.006 | 0.019 | 0.028 |
| **RAG over the release's observations** | sample | 0.299 | 0.052 | 0.406 | 0.240 | 0.500 | 0.033 | 0.072 | 0.008 | 0.025 | 0.025 |
| **RAG over the release's session summaries** | all | 0.572 | 0.489 | 0.587 | 0.413 | 0.612 | 0.028 | 0.130 | 0.004 | 0.005 | 0.005 |
| **RAG over the release's session summaries** | sample | 0.563 | 0.511 | 0.688 | 0.365 | 0.688 | 0.027 | 0.093 | 0.004 | 0.007 | 0.004 |
| **long-horizon agent (createLongHorizonAgent over createEnvironment)** | all | — | — | — | — | — | — | — | — | — | — |
| **long-horizon agent (createLongHorizonAgent over createEnvironment)** | sample | — | — | — | — | — | — | — | — | — | — |
| **Tangle (the pipeline, shipped defaults)** | all | 0.165 | 0.072 | 0.184 | 0.076 | 0.200 | 0.018 | 0.052 | 0.003 | 0.011 | 0.013 |
| **Tangle (the pipeline, shipped defaults)** | sample | 0.224 | 0.078 | 0.219 | 0.161 | 0.438 | 0.017 | 0.035 | 0.004 | 0.015 | 0.011 |

The keyless embedder is the suite's hashed-trigram reference — LEXICAL, so a ranked row's ceiling here says whether the mechanism carries a fact to the prompt, not what an embedding model would find. The live tier below ranks through a real embedding wire and reads its own ceiling.

## The live tier — a model over the same memories

Provider `openrouter` · answers by `z-ai/glm-5.3-flash` · category-5 judge `qwen/qwen3.8-27b` · thinking at the model's default (`--thinking default`: no control sent on any call — the setting for a model whose endpoint refuses to disable reasoning) · embeddings `baai/bge-m3` (1024 dims) · key from `OPENROUTER_AI_KEY` · latest run 2026-08-27T18:55:54.379Z.

Six rows do not fit one request ceiling, so the table is the merge of runs, each planned against `TANGLE_AI_MAX_CALLS` before its first request and each recorded with what it spent on the wire — and what the wire cache remembered from an earlier run instead (`replayed` calls, `cached` texts), which is counted and never spent:

| run | generated | rows | planned | ceiling | spent | replayed | tokens | embedded | wall | wire errors |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 2026-08-27T18:34:34.504Z | `long-context`, `near-raw` | 175 | 200 | 175 | 0 | 2,043,034 | 5,873 texts in 23, 70 cached | 13.4 min | 0 |
| 1 | 2026-08-27T18:49:02.846Z | `rag-summary`, `near` | 154 | 200 | 95 | 59 | 130,656 | 272 texts in 2, 5,943 cached | 3.0 min | 0 |
| 2 | 2026-08-27T18:52:25.280Z | `rag-observation` | 76 | 200 | 76 | 0 | 48,322 | 0 texts in 0, 2,611 cached | 3.1 min | 0 |
| 3 | 2026-08-27T18:55:54.379Z | `long-horizon` | 192 | 200 | 159 | 0 | 224,787 | — | 13.2 min | 1 |

A wire error is a question left unanswered, not scored; the first: `conv-47#51 sub-call: The operation was aborted due to timeout`. A re-run of a row replays every answer the cache holds and buys only the rest, so filling a rate-limited row costs the missing answers, not a run.

| row | corpus | novelty / contradiction / crystallize | runs | observations | admitted | filtered | judged | contradictions | resolutions | merged | live | total | unranked |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| near-raw | turns | 2 / 2 / 2 | 272 | 5882 | 5882 | 0 | 0 | 0 | 0 | 0 | 5877 | 5877 | 0 |
| rag-observation | observation | 2 / 2 / 2 | 272 | 2541 | 2541 | 0 | 0 | 0 | 0 | 0 | 2541 | 2541 | 0 |
| rag-summary | summary | 2 / 2 / 2 | 272 | 272 | 272 | 0 | 0 | 0 | 0 | 0 | 272 | 272 | 0 |
| near | turns | 0.97 / 0.8 / 0.9 | 272 | 5882 | 5877 | 5 | 4721 | 2 | 0 | 69 | 5806 | 5808 | 0 |

| row | run | answered | F1 | 1 multi-hop | 2 temporal | 3 open-domain | 4 single-hop | ceiling | cited recall | uncited | unresolved citations | invalid | calls | tokens | p50 | p95 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **long context (the whole conversation in the request)** | 0 | 64/64 | 0.421 | 0.441 | 0.368 | 0.214 | 0.662 | 0.998 | 0.730 | 5 | 0 in 0 | 0 | 64 | 1,818,166 | 2.0 s | 54.5 s |
| **RAG over dialog turns (the pipeline, policies off)** | 0 | 64/64 | 0.148 | 0.114 | 0.275 | 0.078 | 0.125 | 0.202 | 0.194 | 37 | 1 in 1 | 0 | 64 | 39,710 | 817 ms | 3.7 s |
| **RAG over the release's observations** | 2 | 64/64 | 0.331 | 0.230 | 0.293 | 0.144 | 0.659 | 0.573 | 0.446 | 16 | 0 in 0 | 0 | 64 | 34,631 | 729 ms | 1.5 s |
| **RAG over the release's session summaries** | 1 | 64/64 | 0.182 | 0.186 | 0.255 | 0.060 | 0.228 | 0.804 | 0.431 | 25 | 0 in 0 | 0 | 64 | 105,973 | 1.1 s | 2.9 s |
| **long-horizon agent (createLongHorizonAgent over createEnvironment)** | 3 | 12/12 | 0.020 | 0.048 | 0.000 | 0.026 | 0.008 | 0.368 | 0.000 | 8 | 0 in 0 | 0 | 158 | 224,787 | 3.1 s | 31.2 s |
| **Tangle (the pipeline, shipped defaults)** | 1 | 64/64 | 0.139 | 0.114 | 0.243 | 0.074 | 0.125 | 0.202 | 0.186 | 36 | 5 in 2 | 0 | 64 (47 replayed) | 40,114 | 815 ms | 3.7 s |

`ceiling` and `cited recall` are evidence recall over the same answered questions — the memories the prompt held, and the memories the answer cited. `uncited` answers cited no listed memory; `unresolved` citations name an id the prompt never listed, a counted failure of the evidence rule. `invalid` replies failed the answer schema after one repair and were scored as raw text (for the long-horizon row: the program produced no answer slot, scored as empty). `tokens` are the provider's own `usage`; p50/p95 are the chat call's wall time as the benchmark waited for it — a rate-limited call's retries and backoff included, so under a 429-ing provider they measure the queue more than the model. The long-horizon row's calls are one authoring call (with up to two repairs) plus one sub-call per piece visited, per question.

| row | ceiling | 1 multi-hop | 2 temporal | 3 open-domain | 4 single-hop | cited recall | 1 multi-hop | 2 temporal | 3 open-domain | 4 single-hop |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **long context (the whole conversation in the request)** | 0.998 | 0.991 | 1.000 | 1.000 | 1.000 | 0.730 | 0.660 | 0.938 | 0.448 | 0.875 |
| **RAG over dialog turns (the pipeline, policies off)** | 0.202 | 0.120 | 0.438 | 0.125 | 0.125 | 0.194 | 0.120 | 0.406 | 0.125 | 0.125 |
| **RAG over the release's observations** | 0.573 | 0.405 | 0.813 | 0.323 | 0.750 | 0.446 | 0.264 | 0.625 | 0.146 | 0.750 |
| **RAG over the release's session summaries** | 0.804 | 0.777 | 1.000 | 0.625 | 0.813 | 0.431 | 0.436 | 0.625 | 0.224 | 0.438 |
| **long-horizon agent (createLongHorizonAgent over createEnvironment)** | 0.368 | 0.556 | 0.000 | 0.917 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| **Tangle (the pipeline, shipped defaults)** | 0.202 | 0.120 | 0.438 | 0.125 | 0.125 | 0.186 | 0.120 | 0.375 | 0.125 | 0.125 |

### On common ground

Rows answer unequal sets when a wire fails, so the rows that planned the whole sample are compared here over the **64 questions every one of them answered** (16 multi-hop, 16 temporal, 16 open-domain, 16 single-hop):

| row | questions | F1 | 1 multi-hop | 2 temporal | 3 open-domain | 4 single-hop | ceiling | cited recall | calls | tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **long context (the whole conversation in the request)** | 64 | 0.421 | 0.441 | 0.368 | 0.214 | 0.662 | 0.998 | 0.730 | 64 | 1,818,166 |
| **RAG over dialog turns (the pipeline, policies off)** | 64 | 0.148 | 0.114 | 0.275 | 0.078 | 0.125 | 0.202 | 0.194 | 64 | 39,710 |
| **RAG over the release's observations** | 64 | 0.331 | 0.230 | 0.293 | 0.144 | 0.659 | 0.573 | 0.446 | 64 | 34,631 |
| **RAG over the release's session summaries** | 64 | 0.182 | 0.186 | 0.255 | 0.060 | 0.228 | 0.804 | 0.431 | 64 | 105,973 |
| **Tangle (the pipeline, shipped defaults)** | 64 | 0.139 | 0.114 | 0.243 | 0.074 | 0.125 | 0.202 | 0.186 | 64 | 40,114 |

### The long-horizon row's ground

The agent multiplies calls per question by construction, so it answers a seeded subset — 3 per category, 12 questions (`conv-26#67`, `conv-41#50`, `conv-42#4`, `conv-42#39`, `conv-42#127`, `conv-42#159`, `conv-43#1`, `conv-43#11`, `conv-44#122`, `conv-47#51`, `conv-47#58`, `conv-50#4`) — under 16 turns and 12 sub-calls per question, depth 0, a 5.0 min deadline per call, thinking default for the authoring call and default for sub-calls. It answered 12 of 12: 12 programs compiled (0 did not, 15 authoring attempts in all), 12 ran to an answer (0 did not), 144 sub-calls made (7 failed, 526 pieces left unvisited by the cap).

Every row over those 12 questions:

| row | questions | F1 | 1 multi-hop | 2 temporal | 3 open-domain | 4 single-hop | ceiling | cited recall | calls | tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **long context (the whole conversation in the request)** | 12 | 0.459 | 0.434 | 0.577 | 0.102 | 0.724 | 1.000 | 0.896 | 12 | 354,245 |
| **RAG over dialog turns (the pipeline, policies off)** | 12 | 0.268 | 0.188 | 0.398 | 0.154 | 0.333 | 0.264 | 0.264 | 12 | 7,612 |
| **RAG over the release's observations** | 12 | 0.332 | 0.043 | 0.494 | 0.144 | 0.649 | 0.583 | 0.458 | 12 | 6,477 |
| **RAG over the release's session summaries** | 12 | 0.294 | 0.352 | 0.567 | 0.163 | 0.095 | 0.861 | 0.521 | 12 | 19,751 |
| **long-horizon agent (createLongHorizonAgent over createEnvironment)** | 12 | 0.020 | 0.048 | 0.000 | 0.026 | 0.008 | 0.368 | 0.000 | 158 | 224,787 |
| **Tangle (the pipeline, shipped defaults)** | 12 | 0.250 | 0.188 | 0.398 | 0.082 | 0.333 | 0.264 | 0.264 | 12 | 7,732 |

### Tangle against the field

Tangle's row is compared with each rival over the questions BOTH answered; a rival ahead on overall F1 is a published loss. Tangle's ceiling over its answered questions was 0.202 against an F1 of 0.139: 6.3 points of gap is the prompting side of the ledger, 20.2% the retrieval side.

| rival | common questions | Tangle F1 | rival F1 | Δ (Tangle − rival) | Tangle ahead in | behind in | verdict |
|---|---:|---:|---:|---:|---|---|---|
| **long context (the whole conversation in the request)** | 64 | 0.139 | 0.421 | -28.2 pts | — | multi-hop, temporal, open-domain, single-hop | **Tangle loses** |
| **RAG over dialog turns (the pipeline, policies off)** | 64 | 0.139 | 0.148 | -0.9 pts | single-hop | multi-hop, temporal, open-domain | **Tangle loses**, within noise |
| **RAG over the release's observations** | 64 | 0.139 | 0.331 | -19.2 pts | — | multi-hop, temporal, open-domain, single-hop | **Tangle loses** |
| **RAG over the release's session summaries** | 64 | 0.139 | 0.182 | -4.4 pts | open-domain | multi-hop, temporal, single-hop | **Tangle loses**, within noise |
| **long-horizon agent (createLongHorizonAgent over createEnvironment)** | 12 | 0.250 | 0.020 | +23.0 pts | multi-hop, temporal, open-domain, single-hop | — | Tangle ahead |

**Tangle loses to long context (the whole conversation in the request) (by 28.2 points over 64 questions), RAG over dialog turns (the pipeline, policies off) (by 0.9 points over 64 questions), RAG over the release's observations (by 19.2 points over 64 questions), RAG over the release's session summaries (by 4.4 points over 64 questions).** It is ahead of long-horizon agent (createLongHorizonAgent over createEnvironment) (+23.0). A difference under five points over a sample this size is within noise; the sample was sized to the request ceiling, not to the question — raise `TANGLE_AI_MAX_CALLS` and `--questions` to decide it. A rival compared over the long-horizon subset alone is compared over a handful of questions, and its verdict says so by its count.

47 of Tangle's 64 answers were replays of the dialog-RAG row's: the shipped policies left the 10 memories the prompt holds identical there, so the request was byte-identical and the cache answered it with the same reply — the same score and the same usage on every one. The two rows differ only on the 17 questions where the policies changed the prompt: there Tangle scores 0.088 against 0.122, under ceilings of 0.132 and 0.132.

### The adversarial lane — judged, never scored

| row | planned | judged | correct | accuracy | official keyword rule | judge failed | unanswered | calls | tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **long context (the whole conversation in the request)** | 6 | 6 | 5 | 83.3% | 0 would score 1 | 0 | 0 | 12 | 177,856 |
| **RAG over dialog turns (the pipeline, policies off)** | 6 | 6 | 6 | 100.0% | 0 would score 1 | 0 | 0 | 12 | 7,302 |
| **RAG over the release's observations** | 6 | 6 | 3 | 50.0% | 1 would score 1 | 0 | 0 | 12 | 13,691 |
| **RAG over the release's session summaries** | 6 | 6 | 3 | 50.0% | 0 would score 1 | 0 | 0 | 12 | 14,256 |
| **long-horizon agent (createLongHorizonAgent over createEnvironment)** | 0 | 0 | 0 | — | 0 would score 1 | 0 | 0 | 0 | 0 |
| **Tangle (the pipeline, shipped defaults)** | 6 | 6 | 6 | 100.0% | 0 would score 1 | 0 | 0 | 12 | 7,302 |

A category-5 question has a false premise (it attributes to one speaker what the other said); the judge reads the evidence turns and asks whether the answer refused it. The official rule would instead score 1 only for the words "no information available" / "not mentioned" — reported beside the judgment so the two can be compared, folded into nothing. The long-horizon row plans no adversarial questions: at its cost per question the lane would spend a run on six judgments.

## What this table can and cannot decide

It decides, for one model over one sample, where Tangle's curated memory stands against the alternatives — the whole conversation, the paper's three retrieval corpora, the suite's own long-horizon agent — with the ceiling beside every F1 so the reader can tell a retrieval loss from a prompting one, and the cost of each row in the same table. It cannot decide the model: the sample is sized to a request ceiling, and a difference within a few points is noise until the sample grows. It cannot decide embedding quality either: the keyless rows rank lexically, and only the live rows rank through a real wire. The long-horizon row is compared over a subset it could afford, and says so by its count. The policy matrix turns the knobs under this table; the temporal lane gives the temporal category a structure a cosine ranker cannot express — both open in `docs/ROADMAP.md`.

---

LoCoMo is CC BY-NC 4.0 (Maharana et al., ACL 2024, arXiv:2402.17753). This repository does not redistribute it; `git submodule update --init benchmark/locomo` fetches it.
