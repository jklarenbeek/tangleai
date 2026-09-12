# LoCoMo evidence recall — the keyless ceiling

Source: `benchmark/locomo/data/locomo10.json` (sha256 `79fa87e90f04…`, 2,805,274 bytes, schema valid).
Embedder `hash-trigram-512` (512 dims) — the suite's deterministic reference, LEXICAL: two texts score high when they share letters, so every `near` row below is a mechanism score, not an embedding-quality claim. Random seed 17753. Reproduce with `npm run benchmark:locomo:recall`.

Evidence recall is the official `recall_acc` of `task_eval/evaluation.py`: per question, the fraction of its gold `evidence` turns present in the k retrieved memories (a question citing nothing scores 1), averaged. A fact that never reached the prompt cannot be answered from it, so this is the model-free ceiling on any answer — and it costs nothing, which is why CI runs it on every commit.

## The corpus, as ingested

10 conversations · 272 sessions (0 refused for an unparseable stamp) · 5,882 turns, 910 of them with an image caption appended · 5 turns collapsed onto an identical earlier turn by the content-addressed id · span 2022-01-21T19:31:00.000Z → 2024-01-12T13:41:00.000Z (read as UTC, a convention — LoCoMo names no zone).
One memory per turn, `evidence` = `<sample_id>/<dia_id>`, tags = speaker and session, `at` = the session instant; one store per conversation, one `pipeline.run` per session, the pipeline's clock the conversation's last session instant. Max 20 contradiction pairs judged per run (the pipeline's default).

1,986 questions; **1,540 scorable** — 282 multi-hop, 321 temporal, 96 open-domain, 841 single-hop — of which 4 cite no evidence and score 1 by the official rule. Category 5 (446) is excluded: adversarial questions carry no `answer` (444 of 446) and the official evaluator scores the category by keyword, which marks the factually correct answer wrong.

## What the pipeline did to the corpus

| row | novelty / contradiction / crystallize | runs | observations | admitted | filtered | judged | judge failed | contradictions | unapplied | resolutions | merged | unmerged | live | total | unranked |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| near-raw | 2 / 2 / 2 | 272 | 5882 | 5882 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 5877 | 5877 | 0 |
| near | 0.97 / 0.8 / 0.9 | 272 | 5882 | 5876 | 6 | 133 | 0 | 0 | 0 | 0 | 0 | 0 | 5876 | 5876 | 0 |
| selected-default | 2 / 2 / 2 | 272 | 5882 | 5882 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 5877 | 5877 | 0 |

`filtered` is the novelty gate; `contradictions` marks the older record superseded (unretrievable, kept for audit) and `resolutions` are the synthesized records it wrote (no vector, so `unranked`); `merged` is the crystallizer absorbing a record into a survivor whose `evidence` then cites both turns. A threshold of 2 is a similarity no cosine reaches: the policies ran and did nothing, and that row is the baseline corpus the policy matrix measures against.

`judge failed` is a judge call that threw — the pair is skipped and the pass goes on, but a row that judged nothing because the judge was down is not a row that judged everything and found nothing. `unapplied` and `unmerged` are the confirmed contradictions and the planned merges whose records had already been raced away when the write came. Every attempt is judged or failed; every confirmed verdict is applied or unapplied; every planned merge is merged or unmerged. A zero in these columns is a measurement, not an absence.

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
| **near (policies off)** | 0.288 | 0.092 | 0.366 | 0.083 | 0.347 |
| **near (historical shipped thresholds; this run’s embedder)** | 0.288 | 0.092 | 0.366 | 0.083 | 0.347 |
| **Selected default (cell f9a742d02a54a2f222065707243200d84c7bd8afb9d2aacbd8b9ca524aaf49a6; report b003bccaac49b44931787955e5caa0efddb58fec706da029760e50540d8f5b14; default k=10, minScore=0)** | 0.288 | 0.092 | 0.366 | 0.083 | 0.347 |
| _analytic ceiling_ | 0.991 | 0.973 | 0.997 | 0.951 | 1.000 |

Gold hits credited through a crystallized survivor's absorbed address rather than its own: near-raw 0, near 0, selected-default 0.

### k = 10

| row | overall | 1 multi-hop | 2 temporal | 3 open-domain | 4 single-hop |
|---|---:|---:|---:|---:|---:|
| _oracle (gold first)_ | 0.995 | 0.992 | 0.997 | 0.964 | 1.000 |
| _random (seed 17753)_ | 0.014 | 0.010 | 0.011 | 0.051 | 0.013 |
| **recency (last k turns)** | 0.013 | 0.004 | 0.009 | 0.055 | 0.012 |
| **near (policies off)** | 0.360 | 0.136 | 0.450 | 0.141 | 0.425 |
| **near (historical shipped thresholds; this run’s embedder)** | 0.360 | 0.136 | 0.450 | 0.141 | 0.425 |
| **Selected default (cell f9a742d02a54a2f222065707243200d84c7bd8afb9d2aacbd8b9ca524aaf49a6; report b003bccaac49b44931787955e5caa0efddb58fec706da029760e50540d8f5b14; default k=10, minScore=0)** | 0.360 | 0.136 | 0.450 | 0.141 | 0.425 |
| _analytic ceiling_ | 0.995 | 0.992 | 0.997 | 0.964 | 1.000 |

Gold hits credited through a crystallized survivor's absorbed address rather than its own: near-raw 0, near 0, selected-default 0.

### k = 20

| row | overall | 1 multi-hop | 2 temporal | 3 open-domain | 4 single-hop |
|---|---:|---:|---:|---:|---:|
| _oracle (gold first)_ | 0.996 | 0.994 | 0.997 | 0.969 | 1.000 |
| _random (seed 17753)_ | 0.031 | 0.029 | 0.024 | 0.072 | 0.030 |
| **recency (last k turns)** | 0.027 | 0.011 | 0.034 | 0.076 | 0.024 |
| **near (policies off)** | 0.434 | 0.197 | 0.547 | 0.179 | 0.499 |
| **near (historical shipped thresholds; this run’s embedder)** | 0.434 | 0.197 | 0.547 | 0.179 | 0.499 |
| **Selected default (cell f9a742d02a54a2f222065707243200d84c7bd8afb9d2aacbd8b9ca524aaf49a6; report b003bccaac49b44931787955e5caa0efddb58fec706da029760e50540d8f5b14; default k=10, minScore=0)** | 0.434 | 0.197 | 0.547 | 0.179 | 0.499 |
| _analytic ceiling_ | 0.996 | 0.994 | 0.997 | 0.969 | 1.000 |

Gold hits credited through a crystallized survivor's absorbed address rather than its own: near-raw 0, near 0, selected-default 0.

## What this table can and cannot decide

At k = 20 the historical shipped policies move overall evidence recall by +0.00 points against the same pipeline with every policy inert (43.38% vs 43.38%), at a ceiling of 99.61%. That is the sign to read, and it is small: what the gate filtered and the judge superseded is what these questions could no longer retrieve.

The hash embedder ranks lexical overlap; these are retrieval mechanism scores, not semantic embedding quality or model answers. The selected-default row runs the public memory policy at the reported width, with k swept here as an experiment (its runtime default is k = 10). Historical shipped thresholds remain explicit in `near`; the original 64-dimensional screen remains in [LOCOMO_POLICY_SCREEN.md](LOCOMO_POLICY_SCREEN.md). The separate registered live decision, bounds and limitations are in [LOCOMO_POLICY.md](LOCOMO_POLICY.md). The temporal lane remains open in `docs/ROADMAP.md`.

---

LoCoMo is CC BY-NC 4.0 (Maharana et al., ACL 2024, arXiv:2402.17753). This repository does not redistribute it; `git submodule update --init benchmark/locomo` fetches it.
