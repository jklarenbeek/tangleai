# LoCoMo policy matrix — the keyless screen

Source: `benchmark/locomo/data/locomo10.json` (sha256 `79fa87e90f04…`, 2,805,274 bytes, schema valid) — restricted to `conv-26`, `conv-41`, `conv-42`, `conv-43`, `conv-47`, `conv-49`, `conv-50`.
Registration `8565a3881370…` · report `fd1023544189…` · source `1366e3ce89d4…` (HEAD `534657a166b2…`, working tree modified, 52 files in the manifest).

A memory policy becomes the default only when a preregistered comparison proves it improves answers without hiding a category loss, a cost overrun, a failed call or an unequal denominator. **Nothing on this page is such a proof.** The embedder here is the suite's hashed-trigram reference: two texts score high when they share letters, so every number below is a property of the MECHANISM — ingest, gate, rank, cite — and of no model. This page is a screen, and a screen allocates budget; it does not predict the wire. The same shipped cell fires the contradiction judge about thirty times more often under this lexical embedder than under a real one, so a frontier read here says what is worth paying to measure, never what a policy does to an answer. Only an eligible live comparison on the held-out split can select a default.

## The registration

Seed 17753. Primary objective: **locomo-f1**, paired-bootstrap over 10,000 resamples at the 95% level (nearest-rank quantiles, seed 17753). A category's one-sided 95% lower bound may not fall below -0.05; tokens per answered question may not exceed 1.10× the control's and calls may not exceed 1.00×. The acting set is a blocking-secondary. If nothing passes, the inert cell becomes the default and the null is published as a bounded null.

| split | conversations | per category 1 / 2 / 3 / 4 | scorable | adversarial |
|---|---|---|---:|---:|
| selection | conv-26, conv-41, conv-42, conv-43, conv-47, conv-49, conv-50 | 16 / 16 / 16 / 16 | 64 | 6 |
| confirmation | conv-30, conv-44, conv-48 | 24 / 24 / 17 / 24 | 89 | 8 |

| axis | inert level | registered levels |
|---|---:|---|
| novelty | 2 | 0.99, 0.97, 0.9, 0.75 |
| contradiction | 2 | 0.9, 0.8, 0.75 |
| crystallize | 2 | 0.95, 0.9, 0.82 |
| k | 10 | 5, 20 |
| minScore | 0 | 0.25, 0.5, 0.75 |
| offlineWidth | 64 | 128, 256, 512 |

24 cells are registered; 24 were attempted in this run. Every cell is effective VALUES, never a profile name.

## What each attempted cell did to the corpus

| cell | novelty / contradiction / crystallize | k | minScore | width | runs | admitted | filtered | judged | judge failed | contradictions | unapplied | merged | unmerged | live | total |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| inert | 2 / 2 / 2 | 10 | 0 | 64 | 195 | 4157 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4155 | 4155 |
| shipped | 0.97 / 0.8 / 0.9 | 10 | 0 | 64 | 195 | 4154 | 3 | 3826 | 0 | 44 | 0 | 241 | 0 | 3874 | 3913 |
| novelty-0.99 | 0.99 / 2 / 2 | 10 | 0 | 64 | 195 | 4155 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 4155 | 4155 |
| novelty-0.97 | 0.97 / 2 / 2 | 10 | 0 | 64 | 195 | 4154 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 4154 | 4154 |
| novelty-0.9 | 0.9 / 2 / 2 | 10 | 0 | 64 | 195 | 3902 | 255 | 0 | 0 | 0 | 0 | 0 | 0 | 3902 | 3902 |
| novelty-0.75 | 0.75 / 2 / 2 | 10 | 0 | 64 | 195 | 1049 | 3108 | 0 | 0 | 0 | 0 | 0 | 0 | 1049 | 1049 |
| contradiction-0.9 | 2 / 0.9 / 2 | 10 | 0 | 64 | 195 | 4157 | 0 | 2565 | 0 | 18 | 0 | 0 | 0 | 4137 | 4155 |
| contradiction-0.8 | 2 / 0.8 / 2 | 10 | 0 | 64 | 195 | 4157 | 0 | 3826 | 0 | 50 | 0 | 0 | 0 | 4110 | 4155 |
| contradiction-0.75 | 2 / 0.75 / 2 | 10 | 0 | 64 | 195 | 4157 | 0 | 3868 | 0 | 50 | 0 | 0 | 0 | 4110 | 4155 |
| crystallize-0.95 | 2 / 2 / 0.95 | 10 | 0 | 64 | 195 | 4157 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 4154 | 4154 |
| crystallize-0.9 | 2 / 2 / 0.9 | 10 | 0 | 64 | 195 | 4157 | 0 | 0 | 0 | 0 | 0 | 253 | 0 | 3902 | 3902 |
| crystallize-0.82 | 2 / 2 / 0.82 | 10 | 0 | 64 | 195 | 4157 | 0 | 0 | 0 | 0 | 0 | 1968 | 0 | 2187 | 2187 |
| k-5 | 2 / 2 / 2 | 5 | 0 | 64 | 195 | 4157 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4155 | 4155 |
| k-20 | 2 / 2 / 2 | 20 | 0 | 64 | 195 | 4157 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4155 | 4155 |
| minScore-0.25 | 2 / 2 / 2 | 10 | 0.25 | 64 | 195 | 4157 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4155 | 4155 |
| minScore-0.5 | 2 / 2 / 2 | 10 | 0.5 | 64 | 195 | 4157 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4155 | 4155 |
| minScore-0.75 | 2 / 2 / 2 | 10 | 0.75 | 64 | 195 | 4157 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4155 | 4155 |
| offlineWidth-128 | 2 / 2 / 2 | 10 | 0 | 128 | 195 | 4157 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4155 | 4155 |
| offlineWidth-256 | 2 / 2 / 2 | 10 | 0 | 256 | 195 | 4157 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4155 | 4155 |
| offlineWidth-512 | 2 / 2 / 2 | 10 | 0 | 512 | 195 | 4157 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4155 | 4155 |
| contradiction-0.8+minScore-0.25 | 2 / 0.8 / 2 | 10 | 0.25 | 64 | 195 | 4157 | 0 | 3826 | 0 | 50 | 0 | 0 | 0 | 4110 | 4155 |
| contradiction-0.8+minScore-0.5 | 2 / 0.8 / 2 | 10 | 0.5 | 64 | 195 | 4157 | 0 | 3826 | 0 | 50 | 0 | 0 | 0 | 4110 | 4155 |
| contradiction-0.9+minScore-0.25 | 2 / 0.9 / 2 | 10 | 0.25 | 64 | 195 | 4157 | 0 | 2565 | 0 | 18 | 0 | 0 | 0 | 4137 | 4155 |
| contradiction-0.9+minScore-0.5 | 2 / 0.9 / 2 | 10 | 0.5 | 64 | 195 | 4157 | 0 | 2565 | 0 | 18 | 0 | 0 | 0 | 4137 | 4155 |

## The denominators, and whether the row may be compared at all

| cell | phase | tier | planned | answered | wire | budget | invalid | eligible | why not |
|---|---|---|---:|---:|---:|---:|---:|---|---|
| inert | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| shipped | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| novelty-0.99 | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| novelty-0.97 | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| novelty-0.9 | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| novelty-0.75 | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| contradiction-0.9 | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| contradiction-0.8 | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| contradiction-0.75 | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| crystallize-0.95 | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| crystallize-0.9 | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| crystallize-0.82 | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| k-5 | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| k-20 | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| minScore-0.25 | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| minScore-0.5 | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| minScore-0.75 | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| offlineWidth-128 | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| offlineWidth-256 | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| offlineWidth-512 | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| contradiction-0.8+minScore-0.25 | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| contradiction-0.8+minScore-0.5 | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| contradiction-0.9+minScore-0.25 | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| contradiction-0.9+minScore-0.5 | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |

## Evidence recall at each cell's own k

| cell | overall | category 1 | category 2 | category 3 | category 4 |
|---|---:|---:|---:|---:|---:|
| inert | 0.126 | 0.100 | 0.281 | 0.063 | 0.063 |
| shipped | 0.080 | 0.131 | 0.063 | 0.063 | 0.063 |
| novelty-0.99 | 0.126 | 0.100 | 0.281 | 0.063 | 0.063 |
| novelty-0.97 | 0.126 | 0.100 | 0.281 | 0.063 | 0.063 |
| novelty-0.9 | 0.072 | 0.100 | 0.063 | 0.063 | 0.063 |
| novelty-0.75 | 0.056 | 0.036 | 0.063 | 0.063 | 0.063 |
| contradiction-0.9 | 0.126 | 0.100 | 0.281 | 0.063 | 0.063 |
| contradiction-0.8 | 0.126 | 0.100 | 0.281 | 0.063 | 0.063 |
| contradiction-0.75 | 0.126 | 0.100 | 0.281 | 0.063 | 0.063 |
| crystallize-0.95 | 0.126 | 0.100 | 0.281 | 0.063 | 0.063 |
| crystallize-0.9 | 0.072 | 0.100 | 0.063 | 0.063 | 0.063 |
| crystallize-0.82 | 0.071 | 0.127 | 0.063 | 0.094 | 0.000 |
| k-5 | 0.074 | 0.045 | 0.188 | 0.063 | 0.000 |
| k-20 | 0.150 | 0.100 | 0.344 | 0.063 | 0.094 |
| minScore-0.25 | 0.126 | 0.100 | 0.281 | 0.063 | 0.063 |
| minScore-0.5 | 0.126 | 0.100 | 0.281 | 0.063 | 0.063 |
| minScore-0.75 | 0.051 | 0.016 | 0.125 | 0.063 | 0.000 |
| offlineWidth-128 | 0.149 | 0.097 | 0.281 | 0.063 | 0.156 |
| offlineWidth-256 | 0.211 | 0.124 | 0.344 | 0.156 | 0.219 |
| offlineWidth-512 | 0.312 | 0.124 | 0.656 | 0.063 | 0.406 |
| contradiction-0.8+minScore-0.25 | 0.126 | 0.100 | 0.281 | 0.063 | 0.063 |
| contradiction-0.8+minScore-0.5 | 0.126 | 0.100 | 0.281 | 0.063 | 0.063 |
| contradiction-0.9+minScore-0.25 | 0.126 | 0.100 | 0.281 | 0.063 | 0.063 |
| contradiction-0.9+minScore-0.5 | 0.126 | 0.100 | 0.281 | 0.063 | 0.063 |

## Where every gold address went

Each of a question's gold evidence addresses lands in exactly one bucket at each k — the buckets are ordered from what the release lost before any policy ran to what the prompt actually carried, and they are checked against the gold-address denominator by the report's own schema. A fact that never reached the prompt therefore says WHERE it was lost, which is the only way a policy's cost can be attributed to the policy. Vocabulary revision 1.

### k = 5

| cell | gold addresses | source-unresolved | content-collapsed | novelty-filtered | contradiction-superseded | crystallized-not-carried | identity-unranked | below-min-score | outside-k | retrieved |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| inert | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 109 | 6 |
| shipped | 116 | 1 | 0 | 0 | 5 | 0 | 0 | 0 | 106 | 4 |
| novelty-0.99 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 109 | 6 |
| novelty-0.97 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 109 | 6 |
| novelty-0.9 | 116 | 1 | 0 | 24 | 0 | 0 | 0 | 0 | 87 | 4 |
| novelty-0.75 | 116 | 1 | 0 | 100 | 0 | 0 | 0 | 0 | 11 | 4 |
| contradiction-0.9 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 109 | 6 |
| contradiction-0.8 | 116 | 1 | 0 | 0 | 4 | 0 | 0 | 0 | 105 | 6 |
| contradiction-0.75 | 116 | 1 | 0 | 0 | 4 | 0 | 0 | 0 | 105 | 6 |
| crystallize-0.95 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 109 | 6 |
| crystallize-0.9 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 111 | 4 |
| crystallize-0.82 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 111 | 4 |
| k-5 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 109 | 6 |
| k-20 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 109 | 6 |
| minScore-0.25 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 109 | 6 |
| minScore-0.5 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 21 | 88 | 6 |
| minScore-0.75 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 110 | 2 | 3 |
| offlineWidth-128 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 103 | 12 |
| offlineWidth-256 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 15 |
| offlineWidth-512 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 99 | 16 |
| contradiction-0.8+minScore-0.25 | 116 | 1 | 0 | 0 | 4 | 0 | 0 | 0 | 105 | 6 |
| contradiction-0.8+minScore-0.5 | 116 | 1 | 0 | 0 | 4 | 0 | 0 | 20 | 85 | 6 |
| contradiction-0.9+minScore-0.25 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 109 | 6 |
| contradiction-0.9+minScore-0.5 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 21 | 88 | 6 |

### k = 10

| cell | gold addresses | source-unresolved | content-collapsed | novelty-filtered | contradiction-superseded | crystallized-not-carried | identity-unranked | below-min-score | outside-k | retrieved |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| inert | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 102 | 13 |
| shipped | 116 | 1 | 0 | 0 | 5 | 0 | 0 | 0 | 100 | 10 |
| novelty-0.99 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 102 | 13 |
| novelty-0.97 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 102 | 13 |
| novelty-0.9 | 116 | 1 | 0 | 24 | 0 | 0 | 0 | 0 | 82 | 9 |
| novelty-0.75 | 116 | 1 | 0 | 100 | 0 | 0 | 0 | 0 | 11 | 4 |
| contradiction-0.9 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 102 | 13 |
| contradiction-0.8 | 116 | 1 | 0 | 0 | 4 | 0 | 0 | 0 | 98 | 13 |
| contradiction-0.75 | 116 | 1 | 0 | 0 | 4 | 0 | 0 | 0 | 98 | 13 |
| crystallize-0.95 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 102 | 13 |
| crystallize-0.9 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 106 | 9 |
| crystallize-0.82 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 106 | 9 |
| k-5 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 102 | 13 |
| k-20 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 102 | 13 |
| minScore-0.25 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 102 | 13 |
| minScore-0.5 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 21 | 81 | 13 |
| minScore-0.75 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 110 | 2 | 3 |
| offlineWidth-128 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 102 | 13 |
| offlineWidth-256 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 95 | 20 |
| offlineWidth-512 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 89 | 26 |
| contradiction-0.8+minScore-0.25 | 116 | 1 | 0 | 0 | 4 | 0 | 0 | 0 | 98 | 13 |
| contradiction-0.8+minScore-0.5 | 116 | 1 | 0 | 0 | 4 | 0 | 0 | 20 | 78 | 13 |
| contradiction-0.9+minScore-0.25 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 102 | 13 |
| contradiction-0.9+minScore-0.5 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 21 | 81 | 13 |

### k = 20

| cell | gold addresses | source-unresolved | content-collapsed | novelty-filtered | contradiction-superseded | crystallized-not-carried | identity-unranked | below-min-score | outside-k | retrieved |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| inert | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 15 |
| shipped | 116 | 1 | 0 | 0 | 5 | 0 | 0 | 0 | 95 | 15 |
| novelty-0.99 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 15 |
| novelty-0.97 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 15 |
| novelty-0.9 | 116 | 1 | 0 | 24 | 0 | 0 | 0 | 0 | 78 | 13 |
| novelty-0.75 | 116 | 1 | 0 | 100 | 0 | 0 | 0 | 0 | 8 | 7 |
| contradiction-0.9 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 15 |
| contradiction-0.8 | 116 | 1 | 0 | 0 | 4 | 0 | 0 | 0 | 96 | 15 |
| contradiction-0.75 | 116 | 1 | 0 | 0 | 4 | 0 | 0 | 0 | 96 | 15 |
| crystallize-0.95 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 15 |
| crystallize-0.9 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 102 | 13 |
| crystallize-0.82 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 97 | 18 |
| k-5 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 15 |
| k-20 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 15 |
| minScore-0.25 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 15 |
| minScore-0.5 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 21 | 79 | 15 |
| minScore-0.75 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 110 | 2 | 3 |
| offlineWidth-128 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 95 | 20 |
| offlineWidth-256 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 86 | 29 |
| offlineWidth-512 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 79 | 36 |
| contradiction-0.8+minScore-0.25 | 116 | 1 | 0 | 0 | 4 | 0 | 0 | 0 | 96 | 15 |
| contradiction-0.8+minScore-0.5 | 116 | 1 | 0 | 0 | 4 | 0 | 0 | 20 | 76 | 15 |
| contradiction-0.9+minScore-0.25 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 15 |
| contradiction-0.9+minScore-0.5 | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 21 | 79 | 15 |

## What each cell did to the prompt, and what it cost

| cell | prompts unchanged | prompts changed | token proxy | per question | ratio vs inert | policy operations | verbatim floor |
|---|---:|---:|---:|---:|---:|---:|---:|
| inert | 64 | 0 | 148,787 | 2325 | 1.000 | 0 | 0.024 |
| shipped | 9 | 55 | 140,419 | 2194 | 0.944 | 4114 | 0.026 |
| novelty-0.99 | 64 | 0 | 148,787 | 2325 | 1.000 | 2 | 0.024 |
| novelty-0.97 | 64 | 0 | 148,787 | 2325 | 1.000 | 3 | 0.024 |
| novelty-0.9 | 14 | 50 | 140,864 | 2201 | 0.947 | 255 | 0.027 |
| novelty-0.75 | 0 | 64 | 84,193 | 1316 | 0.566 | 3108 | 0.022 |
| contradiction-0.9 | 60 | 4 | 147,840 | 2310 | 0.994 | 2583 | 0.023 |
| contradiction-0.8 | 55 | 9 | 147,603 | 2306 | 0.992 | 3876 | 0.023 |
| contradiction-0.75 | 55 | 9 | 147,603 | 2306 | 0.992 | 3918 | 0.023 |
| crystallize-0.95 | 64 | 0 | 148,787 | 2325 | 1.000 | 1 | 0.024 |
| crystallize-0.9 | 9 | 55 | 141,009 | 2203 | 0.948 | 253 | 0.027 |
| crystallize-0.82 | 0 | 64 | 102,660 | 1604 | 0.690 | 1968 | 0.025 |
| k-5 | 0 | 64 | 73,574 | 1150 | 0.494 | 0 | 0.023 |
| k-20 | 0 | 64 | 303,647 | 4744 | 2.041 | 0 | 0.025 |
| minScore-0.25 | 64 | 0 | 148,787 | 2325 | 1.000 | 0 | 0.024 |
| minScore-0.5 | 64 | 0 | 148,787 | 2325 | 1.000 | 0 | 0.024 |
| minScore-0.75 | 10 | 54 | 44,194 | 691 | 0.297 | 0 | 0.013 |
| offlineWidth-128 | 0 | 64 | 156,547 | 2446 | 1.052 | 0 | 0.036 |
| offlineWidth-256 | 0 | 64 | 152,069 | 2376 | 1.022 | 0 | 0.027 |
| offlineWidth-512 | 0 | 64 | 145,823 | 2278 | 0.980 | 0 | 0.025 |
| contradiction-0.8+minScore-0.25 | 55 | 9 | 147,603 | 2306 | 0.992 | 3876 | 0.023 |
| contradiction-0.8+minScore-0.5 | 55 | 9 | 147,603 | 2306 | 0.992 | 3876 | 0.023 |
| contradiction-0.9+minScore-0.25 | 60 | 4 | 147,840 | 2310 | 0.994 | 2583 | 0.023 |
| contradiction-0.9+minScore-0.5 | 60 | 4 | 147,840 | 2310 | 0.994 | 2583 | 0.023 |

`token proxy` is `sizeOf` over the serialized context — characters, the suite's one size rule — and it IS a proxy: a tier that buys nothing has no provider usage to report. `prompts changed` counts the questions whose serialized prompt this cell made different from the inert reference's, read from the prompt bytes and never from a score; it is what the acting set below is computed from. `verbatim floor` is the retrieved context quoted as the answer and scored by the official evaluator — the best a model could do by copying, at this cell's own k.

## Every comparison, with what it could have seen

| treatment | control | metric | pairs | mean Δ | interval | paired SD | SE | min. detectable | tied | acting | eligible | promotes |
|---|---|---|---:|---:|---|---:|---:|---:|---:|---:|---|---|
| shipped | inert | evidence-recall | 64 | -0.0469 | [-0.1094, 0.0000] | 0.2309 | 0.0289 | 0.0566 | 59 | 55 | yes | no |
| novelty-0.99 | inert | evidence-recall | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 0 | yes | no |
| novelty-0.97 | inert | evidence-recall | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 0 | yes | no |
| novelty-0.9 | inert | evidence-recall | 64 | -0.0547 | [-0.1172, -0.0078] | 0.2203 | 0.0275 | 0.0540 | 60 | 50 | yes | no |
| novelty-0.75 | inert | evidence-recall | 64 | -0.0705 | [-0.1536, 0.0099] | 0.3382 | 0.0423 | 0.0829 | 52 | 64 | yes | no |
| contradiction-0.9 | inert | evidence-recall | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 4 | yes | no |
| contradiction-0.8 | inert | evidence-recall | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 9 | yes | no |
| contradiction-0.75 | inert | evidence-recall | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 9 | yes | no |
| crystallize-0.95 | inert | evidence-recall | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 0 | yes | no |
| crystallize-0.9 | inert | evidence-recall | 64 | -0.0547 | [-0.1172, -0.0078] | 0.2203 | 0.0275 | 0.0540 | 60 | 55 | yes | no |
| crystallize-0.82 | inert | evidence-recall | 64 | -0.0556 | [-0.1399, 0.0247] | 0.3411 | 0.0426 | 0.0836 | 51 | 64 | yes | no |
| k-5 | inert | evidence-recall | 64 | -0.0526 | [-0.1047, -0.0123] | 0.1905 | 0.0238 | 0.0467 | 57 | 64 | yes | no |
| k-20 | inert | evidence-recall | 64 | 0.0234 | [0.0000, 0.0625] | 0.1389 | 0.0174 | 0.0340 | 62 | 64 | yes | no |
| minScore-0.25 | inert | evidence-recall | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 0 | yes | no |
| minScore-0.5 | inert | evidence-recall | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 0 | yes | no |
| minScore-0.75 | inert | evidence-recall | 64 | -0.0757 | [-0.1391, -0.0240] | 0.2354 | 0.0294 | 0.0577 | 56 | 54 | yes | no |
| offlineWidth-128 | inert | evidence-recall | 64 | 0.0229 | [-0.0089, 0.0664] | 0.1599 | 0.0200 | 0.0392 | 59 | 64 | **no** | no |
| offlineWidth-256 | inert | evidence-recall | 64 | 0.0843 | [0.0246, 0.1529] | 0.2661 | 0.0333 | 0.0652 | 54 | 64 | **no** | no |
| offlineWidth-512 | inert | evidence-recall | 64 | 0.1858 | [0.0949, 0.2835] | 0.3907 | 0.0488 | 0.0957 | 48 | 64 | **no** | no |
| contradiction-0.8+minScore-0.25 | inert | evidence-recall | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 9 | yes | no |
| contradiction-0.8+minScore-0.5 | inert | evidence-recall | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 9 | yes | no |
| contradiction-0.9+minScore-0.25 | inert | evidence-recall | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 4 | yes | no |
| contradiction-0.9+minScore-0.5 | inert | evidence-recall | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 4 | yes | no |

- **shipped**: no effect larger than 0.0566 was detectable at 64 pairs (paired SD 0.2309, standard error 0.0289, 59 tied, 55 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is -0.1094; category 2's lower bound -0.3861 is below -0.05; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 55 prompts it changed the mean is -0.0545 with interval [-0.1273, 0.0000].
- **novelty-0.99**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 0 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. The cell changed no prompt at all.
- **novelty-0.97**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 0 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. The cell changed no prompt at all.
- **novelty-0.9**: no effect larger than 0.0540 was detectable at 64 pairs (paired SD 0.2203, standard error 0.0275, 60 tied, 50 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is -0.1172; category 2's lower bound -0.3861 is below -0.05; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied; on the 50 prompts it changed the interval is [-0.1500, -0.0100] — harmful exactly where it acts. On the 50 prompts it changed the mean is -0.0700 with interval [-0.1500, -0.0100] — **harmful exactly where it acts**.
- **novelty-0.75**: no effect larger than 0.0829 was detectable at 64 pairs (paired SD 0.3382, standard error 0.0423, 52 tied, 64 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is -0.1536; category 1's lower bound -0.1121 is below -0.05; category 2's lower bound -0.4436 is below -0.05; category 4's lower bound -0.1502 is below -0.05; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 64 prompts it changed the mean is -0.0705 with interval [-0.1536, 0.0099].
- **contradiction-0.9**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 4 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 4 prompts it changed the mean is 0.0000 with interval [0.0000, 0.0000].
- **contradiction-0.8**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 9 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 9 prompts it changed the mean is 0.0000 with interval [0.0000, 0.0000].
- **contradiction-0.75**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 9 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 9 prompts it changed the mean is 0.0000 with interval [0.0000, 0.0000].
- **crystallize-0.95**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 0 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. The cell changed no prompt at all.
- **crystallize-0.9**: no effect larger than 0.0540 was detectable at 64 pairs (paired SD 0.2203, standard error 0.0275, 60 tied, 55 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is -0.1172; category 2's lower bound -0.3861 is below -0.05; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied; on the 55 prompts it changed the interval is [-0.1364, -0.0091] — harmful exactly where it acts. On the 55 prompts it changed the mean is -0.0636 with interval [-0.1364, -0.0091] — **harmful exactly where it acts**.
- **crystallize-0.82**: no effect larger than 0.0836 was detectable at 64 pairs (paired SD 0.3411, standard error 0.0426, 51 tied, 64 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is -0.1399; category 1's lower bound -0.0795 is below -0.05; category 2's lower bound -0.4436 is below -0.05; category 4's lower bound -0.1653 is below -0.05; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 64 prompts it changed the mean is -0.0556 with interval [-0.1399, 0.0247].
- **k-5**: no effect larger than 0.0467 was detectable at 64 pairs (paired SD 0.1905, standard error 0.0238, 57 tied, 64 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is -0.1047; category 1's lower bound -0.0977 is below -0.05; category 2's lower bound -0.2056 is below -0.05; category 4's lower bound -0.1653 is below -0.05; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied; on the 64 prompts it changed the interval is [-0.1047, -0.0123] — harmful exactly where it acts. On the 64 prompts it changed the mean is -0.0526 with interval [-0.1047, -0.0123] — **harmful exactly where it acts**.
- **k-20**: no effect larger than 0.0340 was detectable at 64 pairs (paired SD 0.1389, standard error 0.0174, 62 tied, 64 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 64 prompts it changed the mean is 0.0234 with interval [0.0000, 0.0625].
- **minScore-0.25**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 0 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. The cell changed no prompt at all.
- **minScore-0.5**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 0 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. The cell changed no prompt at all.
- **minScore-0.75**: no effect larger than 0.0577 was detectable at 64 pairs (paired SD 0.2354, standard error 0.0294, 56 tied, 54 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is -0.1391; category 1's lower bound -0.1588 is below -0.05; category 2's lower bound -0.3010 is below -0.05; category 4's lower bound -0.1653 is below -0.05; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied; on the 54 prompts it changed the interval is [-0.1629, -0.0295] — harmful exactly where it acts. On the 54 prompts it changed the mean is -0.0897 with interval [-0.1629, -0.0295] — **harmful exactly where it acts**.
- **offlineWidth-128**: no effect larger than 0.0392 was detectable at 64 pairs (paired SD 0.1599, standard error 0.0200, 59 tied, 64 acting). Does not promote: an ineligible comparison can never promote a cell; evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is -0.0089; category 1's lower bound -0.0689 is below -0.05; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 64 prompts it changed the mean is 0.0229 with interval [-0.0089, 0.0664].
- **offlineWidth-256**: no effect larger than 0.0652 was detectable at 64 pairs (paired SD 0.2661, standard error 0.0333, 54 tied, 64 acting). Does not promote: an ineligible comparison can never promote a cell; evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 64 prompts it changed the mean is 0.0843 with interval [0.0246, 0.1529].
- **offlineWidth-512**: no effect larger than 0.0957 was detectable at 64 pairs (paired SD 0.3907, standard error 0.0488, 48 tied, 64 acting). Does not promote: an ineligible comparison can never promote a cell; evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; category 1's lower bound -0.0555 is below -0.05; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 64 prompts it changed the mean is 0.1858 with interval [0.0949, 0.2835].
- **contradiction-0.8+minScore-0.25**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 9 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 9 prompts it changed the mean is 0.0000 with interval [0.0000, 0.0000].
- **contradiction-0.8+minScore-0.5**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 9 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 9 prompts it changed the mean is 0.0000 with interval [0.0000, 0.0000].
- **contradiction-0.9+minScore-0.25**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 4 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 4 prompts it changed the mean is 0.0000 with interval [0.0000, 0.0000].
- **contradiction-0.9+minScore-0.5**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 4 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 4 prompts it changed the mean is 0.0000 with interval [0.0000, 0.0000].

The acting set is a blocking secondary: a policy that changes a quarter of the prompts can only move the product by a quarter of its local effect, so it can refuse a cell and never promote one. A comparison with a zero-crossing interval is a bounded null, not a proven absence.

## The gate

**Gate passed.** The oracle row equals its analytic ceiling at k = 10 and the seeded random row sits in its band, so the scorer under every number above is proven.

## Selection state

State **frozen**. a challenger is the greatest selection overall paired delta among eligible cells whose point category deltas are all at least the registered floor and whose normalized token and call costs meet the objective, ties broken by ascending cell identity; the tie-break is evidence recall at the cell's own effective k descending, verbatim floor at that same k descending, prompt-token proxy ascending, policy operations ascending, cell identity ascending.
Shortlist: `inert`, `shipped`, `minScore-0.25`, `minScore-0.5`, `contradiction-0.8+minScore-0.25`, `contradiction-0.8`.

Frozen as `e33f4bddee40…` by: Pareto frontier over evidence recall and verbatim floor at each cell's own k against prompt-token proxy and policy operations, subject to no category losing more than the registered floor; then the cost-feasibility and live-applicability filters; then the registered tie-break.

Every cell the screen rejected, with the reason — a screen that published only its survivors would be a screen nobody could check:

| cell | reason | detail |
|---|---|---|
| novelty-0.9 | category-loss | category 2 loses more than -0.05 evidence recall against the inert cell |
| novelty-0.75 | category-loss | category 1, 2 loses more than -0.05 evidence recall against the inert cell |
| crystallize-0.9 | category-loss | category 2 loses more than -0.05 evidence recall against the inert cell |
| crystallize-0.82 | category-loss | category 2, 4 loses more than -0.05 evidence recall against the inert cell |
| k-5 | category-loss | category 1, 2, 4 loses more than -0.05 evidence recall against the inert cell |
| k-20 | cost-infeasible | 303,647 proxy characters against the inert cell's 148,787, which cannot land inside 1.10× however good the answers are |
| minScore-0.75 | category-loss | category 1, 2, 4 loses more than -0.05 evidence recall against the inert cell |
| offlineWidth-128 | live-inapplicable | a live run resolves one embedder identity and the wire model is not parameterized by a hash width, so a 128-dimension built-in cell can never be a live treatment |
| offlineWidth-256 | live-inapplicable | a live run resolves one embedder identity and the wire model is not parameterized by a hash width, so a 256-dimension built-in cell can never be a live treatment |
| offlineWidth-512 | live-inapplicable | a live run resolves one embedder identity and the wire model is not parameterized by a hash width, so a 512-dimension built-in cell can never be a live treatment |
| novelty-0.99 | dominated | crystallize-0.95 is at least as good on recall, floor, token proxy and operations, and better on one |
| novelty-0.97 | dominated | novelty-0.99 is at least as good on recall, floor, token proxy and operations, and better on one |
| contradiction-0.75 | dominated | contradiction-0.8 is at least as good on recall, floor, token proxy and operations, and better on one |
| crystallize-0.95 | dominated | minScore-0.25 is at least as good on recall, floor, token proxy and operations, and better on one |
| contradiction-0.8+minScore-0.5 | dominated | the registered tie-break kept 4 candidates and this cell ranked below them |
| contradiction-0.9+minScore-0.25 | dominated | the registered tie-break kept 4 candidates and this cell ranked below them |
| contradiction-0.9 | dominated | the registered tie-break kept 4 candidates and this cell ranked below them |
| contradiction-0.9+minScore-0.5 | dominated | the registered tie-break kept 4 candidates and this cell ranked below them |

## The built-in embedding width — a lexical-tier result

| width | evidence recall @ k | verbatim floor | token proxy | policy operations |
|---|---:|---:|---:|---:|
| 64 | 0.126 | 0.024 | 148,787 | 0 |
| 128 | 0.149 | 0.036 | 156,547 | 0 |
| 256 | 0.211 | 0.027 | 152,069 | 0 |
| 512 | 0.312 | 0.025 | 145,823 | 0 |

Read at k = 10. Proposed `OFFLINE_EMBEDDER_DIMS`: **512** — a lexical-tier retrieval result: it governs OFFLINE_EMBEDDER_DIMS, the width used when no provider is configured, which never serves a live answer. It is not an answer-quality result and it enters no clause of the objective.

This is the only decision this page proposes, and it is proposed here because this is the only tier that can decide it: a live run resolves one embedder identity, the wire model is not parameterized by a hash width, and vectors from two identities never rank against each other.

---

Retrieval recall is the official `recall_acc` of `task_eval/evaluation.py`, and the verbatim floor is that evaluator's F1 over the retrieved context quoted as the answer. Neither is an answer-quality result. This page makes no default claim and selects no policy: it names what is worth paying to measure, and the live comparison on the held-out split is what may change a runtime default.

LoCoMo is CC BY-NC 4.0 (Maharana et al., ACL 2024, arXiv:2402.17753). This repository does not redistribute it; `git submodule update --init benchmark/locomo` fetches it.
