# LoCoMo benchmark — the answer path

Source: `benchmark/locomo/data/locomo10.json` (sha256 `79fa87e90f04…`, 2,805,274 bytes, schema valid).
Keyless embedder `hash-trigram-64` (64 dims), k = 10 memories per prompt, sample seed 17753. Reproduce with `npm run benchmark:locomo:qa`; add `--live` for the model tier (needs `.env`, see `.env.example`).

Two numbers per configuration, always together: the **ceiling** is evidence recall at k — the fraction of a question's gold turns among the memories the prompt held, the official `recall_acc` — and the **F1** is the official token F1 of a model's answer over those same memories. A large gap means the facts were there and the model did not use them (a prompting problem); a small gap under a low ceiling is a retrieval problem. Beside them, the recall of the gold turns over the memories the model *cited*: whether it used the right ones, not merely had them.

## The corpus and the questions

10 conversations · 272 sessions (0 refused for an unparseable stamp) · 5,882 turns, 910 with an image caption appended · 5 collapsed onto an identical earlier turn · span 2022-01-21T19:31:00.000Z → 2024-01-12T13:41:00.000Z (read as UTC, a convention).
One memory per turn, one store per conversation, one `pipeline.run` per session, the pipeline's clock the conversation's last session instant; max 20 contradiction pairs judged per run. 1,986 questions; **1,540 scorable** — 282 multi-hop, 321 temporal, 96 open-domain, 841 single-hop — 4 of which cite no evidence and score a ceiling of 1 by the official rule. Category 5 (446) is excluded from every F1: adversarial questions carry no `answer` (444 of 446) and the official evaluator scores the category by keyword, which marks the factually correct answer wrong; the judge lane below reports them separately.

**The sample.** The live tier answers a seeded, stratified draw — 16 per scorable category and 6 adversarial, 64 scorable questions in all (16 multi-hop, 16 temporal, 16 open-domain, 16 single-hop) — sized so two configurations fit the request ceiling; the ids are in the report, so a second run answers the same questions.

## The scorer's gate

| prediction | overall | 1 multi-hop | 2 temporal | 3 open-domain | 4 single-hop |
|---|---:|---:|---:|---:|---:|
| _the released answer, as the scorer cuts it_ | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 |
| _the released answer, verbatim_ | 0.995 | 1.000 | 1.000 | 0.927 | 1.000 |

**Gate passed.** The released answer scores exactly 1.000 against itself in every category once category 3 is cut at its first `;` as the official evaluator cuts only the truth. Verbatim, category 3 scores 0.927: that asymmetry is the published scorer's, and it is why a category-3 answer that repeats the release word for word cannot reach 1.

## The keyless tier — every commit, no model

| row | novelty / contradiction / crystallize | runs | observations | admitted | filtered | judged | contradictions | resolutions | merged | live | total | unranked |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| near-raw | 2 / 2 / 2 | 272 | 5882 | 5882 | 0 | 0 | 0 | 0 | 0 | 5877 | 5877 | 0 |
| near | 0.97 / 0.8 / 0.9 | 272 | 5882 | 5876 | 6 | 5326 | 63 | 0 | 339 | 5485 | 5537 | 0 |

The ceiling at k = 10, over all 1,540 scorable questions and over the sample; and the model-free floor — the 10 retrieved memories quoted, unedited, as the answer — which any model has to beat to have earned its call.

| row | questions | ceiling | 1 multi-hop | 2 temporal | 3 open-domain | 4 single-hop | verbatim F1 | 1 multi-hop | 2 temporal | 3 open-domain | 4 single-hop |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **near (policies off)** | all | 0.174 | 0.073 | 0.208 | 0.072 | 0.207 | 0.018 | 0.054 | 0.003 | 0.011 | 0.012 |
| **near (policies off)** | sample | 0.199 | 0.031 | 0.250 | 0.141 | 0.375 | 0.015 | 0.032 | 0.004 | 0.014 | 0.011 |
| **near (pipeline defaults)** | all | 0.165 | 0.072 | 0.184 | 0.076 | 0.200 | 0.018 | 0.052 | 0.003 | 0.011 | 0.013 |
| **near (pipeline defaults)** | sample | 0.224 | 0.078 | 0.219 | 0.161 | 0.438 | 0.017 | 0.035 | 0.004 | 0.015 | 0.011 |

The keyless embedder is the suite's hashed-trigram reference — LEXICAL, so a `near` ceiling here says whether the mechanism carries a fact to the prompt, not what an embedding model would find. The live tier below ranks through a real embedding wire and reads its own ceiling.

## The live tier — a model over the same memories

Generated 2026-08-27T13:34:07.779Z · provider `openrouter` · answers by `qwen/qwen3.8-flash` · category-5 judge `qwen/qwen3.8-27b` · thinking OFF (`reasoning.effort: none` — the measured setting for short-answer extraction; a thinking model spends thousands of completion tokens and tens of seconds on a short phrase otherwise) · embeddings `baai/bge-m3` (1024 dims) · key from `OPENROUTER_AI_KEY`.
Plan: 24 embedding requests + 128 answers + 24 adversarial answers and judgments = 176 against a ceiling of 200; spent 175 requests, 78,645 provider-reported tokens, 57.6 min of wall time; 5943 texts embedded in 24 requests. Wire errors: 30 — each a question left unanswered, not scored; the first: `conv-26#66: AI0002: HTTP 429 from https://openrouter.ai/api/v1/chat/completions: {"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"qwe…`.

| row | novelty / contradiction / crystallize | runs | observations | admitted | filtered | judged | contradictions | resolutions | merged | live | total | unranked |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| near-raw | 2 / 2 / 2 | 272 | 5882 | 5882 | 0 | 0 | 0 | 0 | 0 | 5877 | 5877 | 0 |
| near | 0.97 / 0.8 / 0.9 | 272 | 5882 | 5877 | 5 | 4721 | 2 | 0 | 69 | 5806 | 5808 | 0 |

| row | answered | F1 | 1 multi-hop | 2 temporal | 3 open-domain | 4 single-hop | ceiling | cited recall | uncited | unresolved citations | invalid | calls | tokens | p50 | p95 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **near (policies off)** | 41/64 | 0.095 | 0.053 | 0.216 | 0.062 | 0.077 | 0.152 | 0.116 | 34 | 1 in 1 | 0 | 41 | 27,810 | 20.0 s | 1.2 min |
| **near (pipeline defaults)** | 58/64 | 0.161 | 0.053 | 0.326 | 0.155 | 0.133 | 0.223 | 0.205 | 38 | 0 in 0 | 0 | 58 | 39,709 | 14.6 s | 1.3 min |

`ceiling` and `cited recall` are evidence recall over the same answered questions — the memories the prompt held, and the memories the answer cited. `uncited` answers cited no listed memory; `unresolved` citations name an id the prompt never listed, a counted failure of the evidence rule. `invalid` replies failed the answer schema after one repair and were scored as raw text. `tokens` are the provider's own `usage`; p50/p95 are the chat call's wall time as the benchmark waited for it — a rate-limited call's retries and backoff included, so under a 429-ing provider they measure the queue more than the model.

| row | ceiling | 1 multi-hop | 2 temporal | 3 open-domain | 4 single-hop | cited recall | 1 multi-hop | 2 temporal | 3 open-domain | 4 single-hop |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **near (policies off)** | 0.152 | 0.083 | 0.375 | 0.136 | 0.077 | 0.116 | 0.083 | 0.250 | 0.091 | 0.077 |
| **near (pipeline defaults)** | 0.223 | 0.128 | 0.538 | 0.133 | 0.133 | 0.205 | 0.128 | 0.500 | 0.100 | 0.133 |

### Which configuration won, and what it cost

**near (pipeline defaults)** wins on overall F1, 0.161 against 0.095 (+6.7 points), at 58 calls and 39,709 tokens (37,793 prompt, 1,916 completion), p50 14.6 s, p95 1.3 min; the runner-up spent 41 calls and 27,810 tokens. Its ceiling was 0.223: the gap of 6.1 points between what the prompt held and what the answer scored is the prompting side of the ledger; 22.3% is the retrieval side. **Read the win with its confound:** the rows answered 58 and 41 of the same 64 questions (the rest were wire failures, unanswered and unscored), so the two F1s are over overlapping but unequal sets and the ceilings differ partly for that reason. The winner is ahead in 4 of 4 categories (multi-hop, temporal, open-domain, single-hop); a decision that survives needs a run without wire failures — a provider that does not rate-limit, or `TANGLE_AI_MAX_CONCURRENCY=1`.

### The adversarial lane — judged, never scored

| row | planned | judged | correct | accuracy | official keyword rule | judge failed | unanswered | calls | tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **near (policies off)** | 6 | 5 | 5 | 100.0% | 0 would score 1 | 0 | 1 | 10 | 5,057 |
| **near (pipeline defaults)** | 6 | 6 | 5 | 83.3% | 0 would score 1 | 0 | 0 | 12 | 6,069 |

A category-5 question has a false premise (it attributes to one speaker what the other said); the judge reads the evidence turns and asks whether the answer refused it. The official rule would instead score 1 only for the words "no information available" / "not mentioned" — reported beside the judgment so the two can be compared, folded into nothing.

## What this table can and cannot decide

It decides, for one model over one sample, whether the shipped memory policies helped or hurt the answer — with the ceiling beside the F1 so the reader can tell a retrieval loss from a prompting one, and with the cost of each configuration in the same row. It cannot decide the model: the sample is sized to a request ceiling, and a difference within a few points is noise until the sample grows. It cannot decide embedding quality either: the keyless rows rank lexically, and only the live rows rank through a real wire. Order 17 puts the rivals — long context, the paper's three RAG corpora, the suite's own long-horizon agent — in this same table, and order 03 turns the policy knobs under it.

---

LoCoMo is CC BY-NC 4.0 (Maharana et al., ACL 2024, arXiv:2402.17753). This repository does not redistribute it; `git submodule update --init benchmark/locomo` fetches it.
