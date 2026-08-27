# LoCoMo evidence recall — the keyless ceiling

Source: `benchmark/locomo/data/locomo10.json` (sha256 `79fa87e90f04…`, 2,805,274 bytes, schema valid).
Embedder `hash-trigram-64` (64 dims) — the suite's deterministic reference, LEXICAL: two texts score high when they share letters, so every `near` row below is a mechanism score, not an embedding-quality claim. Random seed 17753. Reproduce with `npm run benchmark:locomo:recall`.

Evidence recall is the official `recall_acc` of `task_eval/evaluation.py`: per question, the fraction of its gold `evidence` turns present in the k retrieved memories (a question citing nothing scores 1), averaged. A fact that never reached the prompt cannot be answered from it, so this is the model-free ceiling on any answer — and it costs nothing, which is why CI runs it on every commit.

## The corpus, as ingested

10 conversations · 272 sessions (0 refused for an unparseable stamp) · 5,882 turns, 910 of them with an image caption appended · 5 turns collapsed onto an identical earlier turn by the content-addressed id · span 2022-01-21T19:31:00.000Z → 2024-01-12T13:41:00.000Z (read as UTC, a convention — LoCoMo names no zone).
One memory per turn, `evidence` = `<sample_id>/<dia_id>`, tags = speaker and session, `at` = the session instant; one store per conversation, one `pipeline.run` per session, the pipeline's clock the conversation's last session instant. Max 20 contradiction pairs judged per run (the pipeline's default).

1,986 questions; **1,540 scorable** — 282 multi-hop, 321 temporal, 96 open-domain, 841 single-hop — of which 4 cite no evidence and score 1 by the official rule. Category 5 (446) is excluded: adversarial questions carry no `answer` (444 of 446) and the official evaluator scores the category by keyword, which marks the factually correct answer wrong.

## What the pipeline did to the corpus

| row | novelty / contradiction / crystallize | runs | observations | admitted | filtered | judged | contradictions | resolutions | merged | live | total | unranked |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| near-raw | 2 / 2 / 2 | 272 | 5882 | 5882 | 0 | 0 | 0 | 0 | 0 | 5877 | 5877 | 0 |
| near | 0.97 / 0.8 / 0.9 | 272 | 5882 | 5876 | 6 | 5326 | 63 | 0 | 339 | 5485 | 5537 | 0 |

`filtered` is the novelty gate; `contradictions` marks the older record superseded (unretrievable, kept for audit) and `resolutions` are the synthesized records it wrote (no vector, so `unranked`); `merged` is the crystallizer absorbing a record into a survivor whose `evidence` then cites both turns. A threshold of 2 is a similarity no cosine reaches: the policies ran and did nothing, and that row is the baseline corpus order 03 measures against.

## The gate

| k | oracle | analytic ceiling | random | analytic band |
|---|---:|---:|---:|---:|
| 5 | 0.991 | 0.991 | 0.007 | 0.0019 – 0.0204 around 0.0112 |
| 10 | 0.995 | 0.995 | 0.014 | 0.0069 – 0.0325 around 0.0197 |
| 20 | 0.996 | 0.996 | 0.031 | 0.0192 – 0.0544 around 0.0368 |

**Gate passed.** The oracle row equals its analytic ceiling at every k and the random row sits in its band. The ceiling is below 1 because 9 of 2,815 evidence ids resolve to no turn (see the census), and below that at small k because a question may cite up to 19 turns — an oracle at 1.000 would be a global dia_id lookup reading another conversation's turns.

## Evidence recall@k, per category

### k = 5

| row | overall | 1 multi-hop | 2 temporal | 3 open-domain | 4 single-hop |
|---|---:|---:|---:|---:|---:|
| _oracle (gold first)_ | 0.991 | 0.973 | 0.997 | 0.951 | 1.000 |
| _random (seed 17753)_ | 0.007 | 0.004 | 0.008 | 0.050 | 0.003 |
| **recency (last k turns)** | 0.004 | 0.002 | 0.000 | 0.044 | 0.002 |
| **near (policies off)** | 0.124 | 0.042 | 0.139 | 0.072 | 0.152 |
| **near (pipeline defaults)** | 0.115 | 0.041 | 0.130 | 0.072 | 0.139 |
| _analytic ceiling_ | 0.991 | 0.973 | 0.997 | 0.951 | 1.000 |

Gold hits credited through a crystallized survivor's absorbed address rather than its own: near-raw 0, near 10.

### k = 10

| row | overall | 1 multi-hop | 2 temporal | 3 open-domain | 4 single-hop |
|---|---:|---:|---:|---:|---:|
| _oracle (gold first)_ | 0.995 | 0.992 | 0.997 | 0.964 | 1.000 |
| _random (seed 17753)_ | 0.014 | 0.010 | 0.011 | 0.051 | 0.013 |
| **recency (last k turns)** | 0.013 | 0.004 | 0.009 | 0.055 | 0.012 |
| **near (policies off)** | 0.174 | 0.073 | 0.208 | 0.072 | 0.207 |
| **near (pipeline defaults)** | 0.165 | 0.072 | 0.184 | 0.076 | 0.200 |
| _analytic ceiling_ | 0.995 | 0.992 | 0.997 | 0.964 | 1.000 |

Gold hits credited through a crystallized survivor's absorbed address rather than its own: near-raw 0, near 17.

### k = 20

| row | overall | 1 multi-hop | 2 temporal | 3 open-domain | 4 single-hop |
|---|---:|---:|---:|---:|---:|
| _oracle (gold first)_ | 0.996 | 0.994 | 0.997 | 0.969 | 1.000 |
| _random (seed 17753)_ | 0.031 | 0.029 | 0.024 | 0.072 | 0.030 |
| **recency (last k turns)** | 0.027 | 0.011 | 0.034 | 0.076 | 0.024 |
| **near (policies off)** | 0.250 | 0.126 | 0.312 | 0.091 | 0.287 |
| **near (pipeline defaults)** | 0.241 | 0.128 | 0.298 | 0.115 | 0.272 |
| _analytic ceiling_ | 0.996 | 0.994 | 0.997 | 0.969 | 1.000 |

Gold hits credited through a crystallized survivor's absorbed address rather than its own: near-raw 0, near 38.

## What this table can and cannot decide

At k = 20 the shipped policies move overall evidence recall by -0.91 points against the same pipeline with every policy inert (24.14% vs 25.05%), at a ceiling of 99.61%. That is a LOSS, and it is published as one: what the gate filtered and the judge superseded is what these questions could no longer retrieve.

What it cannot decide is embedding quality. The ranker here is the hashed-trigram reference, so `near` finds turns that share letters with the question. Read category 2 with that in mind: a temporal question quotes the event it asks about ("when did Caroline go to the support group"), so a lexical ranker finds the turn easily — but the turn holds no date; the answer is arithmetic over the session stamp, which no recall metric sees, and which is exactly the failure the category measures. Order 03 puts a real embedding client behind the same seam and re-runs this exact instrument; order 13 gives the ranker a notion of *when*; order 16's F1 will say what recall could not. Until then, every number above is a property of the mechanism — ingest, gate, rank, cite — and not of any model.

---

LoCoMo is CC BY-NC 4.0 (Maharana et al., ACL 2024, arXiv:2402.17753). This repository does not redistribute it; `git submodule update --init benchmark/locomo` fetches it.
