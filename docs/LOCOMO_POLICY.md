# LoCoMo policy matrix — registered live experiment

Source: `benchmark/locomo/data/locomo10.json` (sha256 `79fa87e90f04…`, 2,805,274 bytes, schema valid) — restricted to `conv-26`, `conv-41`, `conv-42`, `conv-43`, `conv-47`, `conv-49`, `conv-50`.
Registration `617b777166ab…` · report `b003bccaac49…` · source `74b047084f61…` (HEAD `4f31d042d3b8…`, working tree modified, 117 files in the manifest).

The lexical screen allocated the live budget; it does not predict answer quality. Live rows use one approved provider and embedding identity. Only complete eligible held-out comparisons can select a default. Shipped is a historical control, never the fallback winner. Failed and partial attempts remain visible.

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

24 cells are registered; 32 were attempted in this run. Every cell is effective VALUES, never a profile name.

## What each attempted cell did to the corpus

| cell | novelty / contradiction / crystallize | k | minScore | width | runs | admitted | filtered | judged | judge failed | contradictions | unapplied | merged | unmerged | live | total |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| inert (keyless/selection) | 2 / 2 / 2 | 10 | 0 | 64 | 195 | 4157 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4155 | 4155 |
| shipped (keyless/selection) | 0.97 / 0.8 / 0.9 | 10 | 0 | 64 | 195 | 4154 | 3 | 3826 | 0 | 44 | 0 | 241 | 0 | 3874 | 3913 |
| novelty-0.99 (keyless/selection) | 0.99 / 2 / 2 | 10 | 0 | 64 | 195 | 4155 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 4155 | 4155 |
| novelty-0.97 (keyless/selection) | 0.97 / 2 / 2 | 10 | 0 | 64 | 195 | 4154 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 4154 | 4154 |
| novelty-0.9 (keyless/selection) | 0.9 / 2 / 2 | 10 | 0 | 64 | 195 | 3902 | 255 | 0 | 0 | 0 | 0 | 0 | 0 | 3902 | 3902 |
| novelty-0.75 (keyless/selection) | 0.75 / 2 / 2 | 10 | 0 | 64 | 195 | 1049 | 3108 | 0 | 0 | 0 | 0 | 0 | 0 | 1049 | 1049 |
| contradiction-0.9 (keyless/selection) | 2 / 0.9 / 2 | 10 | 0 | 64 | 195 | 4157 | 0 | 2565 | 0 | 18 | 0 | 0 | 0 | 4137 | 4155 |
| contradiction-0.8 (keyless/selection) | 2 / 0.8 / 2 | 10 | 0 | 64 | 195 | 4157 | 0 | 3826 | 0 | 50 | 0 | 0 | 0 | 4110 | 4155 |
| contradiction-0.75 (keyless/selection) | 2 / 0.75 / 2 | 10 | 0 | 64 | 195 | 4157 | 0 | 3868 | 0 | 50 | 0 | 0 | 0 | 4110 | 4155 |
| crystallize-0.95 (keyless/selection) | 2 / 2 / 0.95 | 10 | 0 | 64 | 195 | 4157 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 4154 | 4154 |
| crystallize-0.9 (keyless/selection) | 2 / 2 / 0.9 | 10 | 0 | 64 | 195 | 4157 | 0 | 0 | 0 | 0 | 0 | 253 | 0 | 3902 | 3902 |
| crystallize-0.82 (keyless/selection) | 2 / 2 / 0.82 | 10 | 0 | 64 | 195 | 4157 | 0 | 0 | 0 | 0 | 0 | 1968 | 0 | 2187 | 2187 |
| k-5 (keyless/selection) | 2 / 2 / 2 | 5 | 0 | 64 | 195 | 4157 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4155 | 4155 |
| k-20 (keyless/selection) | 2 / 2 / 2 | 20 | 0 | 64 | 195 | 4157 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4155 | 4155 |
| minScore-0.25 (keyless/selection) | 2 / 2 / 2 | 10 | 0.25 | 64 | 195 | 4157 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4155 | 4155 |
| minScore-0.5 (keyless/selection) | 2 / 2 / 2 | 10 | 0.5 | 64 | 195 | 4157 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4155 | 4155 |
| minScore-0.75 (keyless/selection) | 2 / 2 / 2 | 10 | 0.75 | 64 | 195 | 4157 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4155 | 4155 |
| offlineWidth-128 (keyless/selection) | 2 / 2 / 2 | 10 | 0 | 128 | 195 | 4157 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4155 | 4155 |
| offlineWidth-256 (keyless/selection) | 2 / 2 / 2 | 10 | 0 | 256 | 195 | 4157 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4155 | 4155 |
| offlineWidth-512 (keyless/selection) | 2 / 2 / 2 | 10 | 0 | 512 | 195 | 4157 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4155 | 4155 |
| contradiction-0.8+minScore-0.25 (keyless/selection) | 2 / 0.8 / 2 | 10 | 0.25 | 64 | 195 | 4157 | 0 | 3826 | 0 | 50 | 0 | 0 | 0 | 4110 | 4155 |
| contradiction-0.8+minScore-0.5 (keyless/selection) | 2 / 0.8 / 2 | 10 | 0.5 | 64 | 195 | 4157 | 0 | 3826 | 0 | 50 | 0 | 0 | 0 | 4110 | 4155 |
| contradiction-0.9+minScore-0.25 (keyless/selection) | 2 / 0.9 / 2 | 10 | 0.25 | 64 | 195 | 4157 | 0 | 2565 | 0 | 18 | 0 | 0 | 0 | 4137 | 4155 |
| contradiction-0.9+minScore-0.5 (keyless/selection) | 2 / 0.9 / 2 | 10 | 0.5 | 64 | 195 | 4157 | 0 | 2565 | 0 | 18 | 0 | 0 | 0 | 4137 | 4155 |
| inert (live/selection) | 2 / 2 / 2 | 10 | 0 | 1024 | 195 | 4157 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4155 | 4155 |
| shipped (live/selection) | 0.97 / 0.8 / 0.9 | 10 | 0 | 1024 | 195 | 4155 | 2 | 3392 | 0 | 1 | 0 | 46 | 0 | 4108 | 4109 |
| minScore-0.5 (live/selection) | 2 / 2 / 2 | 10 | 0.5 | 1024 | 195 | 4157 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4155 | 4155 |
| contradiction-0.8+minScore-0.25 (live/selection) | 2 / 0.8 / 2 | 10 | 0.25 | 1024 | 195 | 4157 | 0 | 3404 | 0 | 1 | 0 | 0 | 0 | 4154 | 4155 |
| contradiction-0.8 (live/selection) | 2 / 0.8 / 2 | 10 | 0 | 1024 | 195 | 4157 | 0 | 3404 | 0 | 1 | 0 | 0 | 0 | 4154 | 4155 |
| inert (live/confirmation) | 2 / 2 / 2 | 10 | 0 | 1024 | 77 | 1725 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1722 | 1722 |
| shipped (live/confirmation) | 0.97 / 0.8 / 0.9 | 10 | 0 | 1024 | 77 | 1722 | 3 | 1329 | 0 | 1 | 0 | 23 | 0 | 1698 | 1699 |
| contradiction-0.8+minScore-0.25 (live/confirmation) | 2 / 0.8 / 2 | 10 | 0.25 | 1024 | 77 | 1725 | 0 | 1340 | 0 | 1 | 0 | 0 | 0 | 1721 | 1722 |

## The denominators, and whether the row may be compared at all

| cell | phase | tier | planned | answered | wire | budget | invalid | eligible | why not |
|---|---|---|---:|---:|---:|---:|---:|---|---|
| inert (keyless/selection) | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| shipped (keyless/selection) | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| novelty-0.99 (keyless/selection) | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| novelty-0.97 (keyless/selection) | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| novelty-0.9 (keyless/selection) | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| novelty-0.75 (keyless/selection) | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| contradiction-0.9 (keyless/selection) | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| contradiction-0.8 (keyless/selection) | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| contradiction-0.75 (keyless/selection) | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| crystallize-0.95 (keyless/selection) | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| crystallize-0.9 (keyless/selection) | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| crystallize-0.82 (keyless/selection) | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| k-5 (keyless/selection) | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| k-20 (keyless/selection) | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| minScore-0.25 (keyless/selection) | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| minScore-0.5 (keyless/selection) | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| minScore-0.75 (keyless/selection) | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| offlineWidth-128 (keyless/selection) | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| offlineWidth-256 (keyless/selection) | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| offlineWidth-512 (keyless/selection) | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| contradiction-0.8+minScore-0.25 (keyless/selection) | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| contradiction-0.8+minScore-0.5 (keyless/selection) | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| contradiction-0.9+minScore-0.25 (keyless/selection) | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| contradiction-0.9+minScore-0.5 (keyless/selection) | selection | keyless | 64 | 64 | 0 | 0 | 0 | yes | — |
| inert (live/selection) | selection | live | 64 | 64 | 0 | 0 | 0 | yes | — |
| shipped (live/selection) | selection | live | 64 | 64 | 0 | 0 | 0 | yes | — |
| minScore-0.5 (live/selection) | selection | live | 64 | 64 | 0 | 0 | 0 | yes | — |
| contradiction-0.8+minScore-0.25 (live/selection) | selection | live | 64 | 64 | 0 | 0 | 0 | yes | — |
| contradiction-0.8 (live/selection) | selection | live | 64 | 64 | 0 | 0 | 0 | yes | — |
| inert (live/confirmation) | confirmation | live | 89 | 89 | 0 | 0 | 0 | yes | — |
| shipped (live/confirmation) | confirmation | live | 89 | 89 | 0 | 0 | 0 | yes | — |
| contradiction-0.8+minScore-0.25 (live/confirmation) | confirmation | live | 89 | 89 | 0 | 0 | 0 | yes | — |

## Evidence recall at each cell's own k

| cell | overall | category 1 | category 2 | category 3 | category 4 |
|---|---:|---:|---:|---:|---:|
| inert (keyless/selection) | 0.126 | 0.100 | 0.281 | 0.063 | 0.063 |
| shipped (keyless/selection) | 0.080 | 0.131 | 0.063 | 0.063 | 0.063 |
| novelty-0.99 (keyless/selection) | 0.126 | 0.100 | 0.281 | 0.063 | 0.063 |
| novelty-0.97 (keyless/selection) | 0.126 | 0.100 | 0.281 | 0.063 | 0.063 |
| novelty-0.9 (keyless/selection) | 0.072 | 0.100 | 0.063 | 0.063 | 0.063 |
| novelty-0.75 (keyless/selection) | 0.056 | 0.036 | 0.063 | 0.063 | 0.063 |
| contradiction-0.9 (keyless/selection) | 0.126 | 0.100 | 0.281 | 0.063 | 0.063 |
| contradiction-0.8 (keyless/selection) | 0.126 | 0.100 | 0.281 | 0.063 | 0.063 |
| contradiction-0.75 (keyless/selection) | 0.126 | 0.100 | 0.281 | 0.063 | 0.063 |
| crystallize-0.95 (keyless/selection) | 0.126 | 0.100 | 0.281 | 0.063 | 0.063 |
| crystallize-0.9 (keyless/selection) | 0.072 | 0.100 | 0.063 | 0.063 | 0.063 |
| crystallize-0.82 (keyless/selection) | 0.071 | 0.127 | 0.063 | 0.094 | 0.000 |
| k-5 (keyless/selection) | 0.074 | 0.045 | 0.188 | 0.063 | 0.000 |
| k-20 (keyless/selection) | 0.150 | 0.100 | 0.344 | 0.063 | 0.094 |
| minScore-0.25 (keyless/selection) | 0.126 | 0.100 | 0.281 | 0.063 | 0.063 |
| minScore-0.5 (keyless/selection) | 0.126 | 0.100 | 0.281 | 0.063 | 0.063 |
| minScore-0.75 (keyless/selection) | 0.051 | 0.016 | 0.125 | 0.063 | 0.000 |
| offlineWidth-128 (keyless/selection) | 0.149 | 0.097 | 0.281 | 0.063 | 0.156 |
| offlineWidth-256 (keyless/selection) | 0.211 | 0.124 | 0.344 | 0.156 | 0.219 |
| offlineWidth-512 (keyless/selection) | 0.312 | 0.124 | 0.656 | 0.063 | 0.406 |
| contradiction-0.8+minScore-0.25 (keyless/selection) | 0.126 | 0.100 | 0.281 | 0.063 | 0.063 |
| contradiction-0.8+minScore-0.5 (keyless/selection) | 0.126 | 0.100 | 0.281 | 0.063 | 0.063 |
| contradiction-0.9+minScore-0.25 (keyless/selection) | 0.126 | 0.100 | 0.281 | 0.063 | 0.063 |
| contradiction-0.9+minScore-0.5 (keyless/selection) | 0.126 | 0.100 | 0.281 | 0.063 | 0.063 |
| inert (live/selection) | 0.133 | 0.000 | 0.250 | 0.094 | 0.188 |
| shipped (live/selection) | 0.133 | 0.000 | 0.250 | 0.094 | 0.188 |
| minScore-0.5 (live/selection) | 0.133 | 0.000 | 0.250 | 0.094 | 0.188 |
| contradiction-0.8+minScore-0.25 (live/selection) | 0.133 | 0.000 | 0.250 | 0.094 | 0.188 |
| contradiction-0.8 (live/selection) | 0.133 | 0.000 | 0.250 | 0.094 | 0.188 |
| inert (live/confirmation) | 0.237 | 0.067 | 0.333 | 0.118 | 0.396 |
| shipped (live/confirmation) | 0.251 | 0.076 | 0.375 | 0.118 | 0.396 |
| contradiction-0.8+minScore-0.25 (live/confirmation) | 0.237 | 0.067 | 0.333 | 0.118 | 0.396 |

## Where every gold address went

Each of a question's gold evidence addresses lands in exactly one bucket at each k — the buckets are ordered from what the release lost before any policy ran to what the prompt actually carried, and they are checked against the gold-address denominator by the report's own schema. A fact that never reached the prompt therefore says WHERE it was lost, which is the only way a policy's cost can be attributed to the policy. Vocabulary revision 1.

### k = 5

| cell | gold addresses | source-unresolved | content-collapsed | novelty-filtered | contradiction-superseded | crystallized-not-carried | identity-unranked | below-min-score | outside-k | retrieved |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| inert (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 109 | 6 |
| shipped (keyless/selection) | 116 | 1 | 0 | 0 | 5 | 0 | 0 | 0 | 106 | 4 |
| novelty-0.99 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 109 | 6 |
| novelty-0.97 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 109 | 6 |
| novelty-0.9 (keyless/selection) | 116 | 1 | 0 | 24 | 0 | 0 | 0 | 0 | 87 | 4 |
| novelty-0.75 (keyless/selection) | 116 | 1 | 0 | 100 | 0 | 0 | 0 | 0 | 11 | 4 |
| contradiction-0.9 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 109 | 6 |
| contradiction-0.8 (keyless/selection) | 116 | 1 | 0 | 0 | 4 | 0 | 0 | 0 | 105 | 6 |
| contradiction-0.75 (keyless/selection) | 116 | 1 | 0 | 0 | 4 | 0 | 0 | 0 | 105 | 6 |
| crystallize-0.95 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 109 | 6 |
| crystallize-0.9 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 111 | 4 |
| crystallize-0.82 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 111 | 4 |
| k-5 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 109 | 6 |
| k-20 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 109 | 6 |
| minScore-0.25 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 109 | 6 |
| minScore-0.5 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 21 | 88 | 6 |
| minScore-0.75 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 110 | 2 | 3 |
| offlineWidth-128 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 103 | 12 |
| offlineWidth-256 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 15 |
| offlineWidth-512 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 99 | 16 |
| contradiction-0.8+minScore-0.25 (keyless/selection) | 116 | 1 | 0 | 0 | 4 | 0 | 0 | 0 | 105 | 6 |
| contradiction-0.8+minScore-0.5 (keyless/selection) | 116 | 1 | 0 | 0 | 4 | 0 | 0 | 20 | 85 | 6 |
| contradiction-0.9+minScore-0.25 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 109 | 6 |
| contradiction-0.9+minScore-0.5 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 21 | 88 | 6 |
| inert (live/selection) | — | — | — | — | — | — | — | — | — | — |
| shipped (live/selection) | — | — | — | — | — | — | — | — | — | — |
| minScore-0.5 (live/selection) | — | — | — | — | — | — | — | — | — | — |
| contradiction-0.8+minScore-0.25 (live/selection) | — | — | — | — | — | — | — | — | — | — |
| contradiction-0.8 (live/selection) | — | — | — | — | — | — | — | — | — | — |
| inert (live/confirmation) | — | — | — | — | — | — | — | — | — | — |
| shipped (live/confirmation) | — | — | — | — | — | — | — | — | — | — |
| contradiction-0.8+minScore-0.25 (live/confirmation) | — | — | — | — | — | — | — | — | — | — |

### k = 10

| cell | gold addresses | source-unresolved | content-collapsed | novelty-filtered | contradiction-superseded | crystallized-not-carried | identity-unranked | below-min-score | outside-k | retrieved |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| inert (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 102 | 13 |
| shipped (keyless/selection) | 116 | 1 | 0 | 0 | 5 | 0 | 0 | 0 | 100 | 10 |
| novelty-0.99 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 102 | 13 |
| novelty-0.97 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 102 | 13 |
| novelty-0.9 (keyless/selection) | 116 | 1 | 0 | 24 | 0 | 0 | 0 | 0 | 82 | 9 |
| novelty-0.75 (keyless/selection) | 116 | 1 | 0 | 100 | 0 | 0 | 0 | 0 | 11 | 4 |
| contradiction-0.9 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 102 | 13 |
| contradiction-0.8 (keyless/selection) | 116 | 1 | 0 | 0 | 4 | 0 | 0 | 0 | 98 | 13 |
| contradiction-0.75 (keyless/selection) | 116 | 1 | 0 | 0 | 4 | 0 | 0 | 0 | 98 | 13 |
| crystallize-0.95 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 102 | 13 |
| crystallize-0.9 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 106 | 9 |
| crystallize-0.82 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 106 | 9 |
| k-5 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 102 | 13 |
| k-20 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 102 | 13 |
| minScore-0.25 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 102 | 13 |
| minScore-0.5 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 21 | 81 | 13 |
| minScore-0.75 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 110 | 2 | 3 |
| offlineWidth-128 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 102 | 13 |
| offlineWidth-256 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 95 | 20 |
| offlineWidth-512 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 89 | 26 |
| contradiction-0.8+minScore-0.25 (keyless/selection) | 116 | 1 | 0 | 0 | 4 | 0 | 0 | 0 | 98 | 13 |
| contradiction-0.8+minScore-0.5 (keyless/selection) | 116 | 1 | 0 | 0 | 4 | 0 | 0 | 20 | 78 | 13 |
| contradiction-0.9+minScore-0.25 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 102 | 13 |
| contradiction-0.9+minScore-0.5 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 21 | 81 | 13 |
| inert (live/selection) | — | — | — | — | — | — | — | — | — | — |
| shipped (live/selection) | — | — | — | — | — | — | — | — | — | — |
| minScore-0.5 (live/selection) | — | — | — | — | — | — | — | — | — | — |
| contradiction-0.8+minScore-0.25 (live/selection) | — | — | — | — | — | — | — | — | — | — |
| contradiction-0.8 (live/selection) | — | — | — | — | — | — | — | — | — | — |
| inert (live/confirmation) | — | — | — | — | — | — | — | — | — | — |
| shipped (live/confirmation) | — | — | — | — | — | — | — | — | — | — |
| contradiction-0.8+minScore-0.25 (live/confirmation) | — | — | — | — | — | — | — | — | — | — |

### k = 20

| cell | gold addresses | source-unresolved | content-collapsed | novelty-filtered | contradiction-superseded | crystallized-not-carried | identity-unranked | below-min-score | outside-k | retrieved |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| inert (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 15 |
| shipped (keyless/selection) | 116 | 1 | 0 | 0 | 5 | 0 | 0 | 0 | 95 | 15 |
| novelty-0.99 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 15 |
| novelty-0.97 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 15 |
| novelty-0.9 (keyless/selection) | 116 | 1 | 0 | 24 | 0 | 0 | 0 | 0 | 78 | 13 |
| novelty-0.75 (keyless/selection) | 116 | 1 | 0 | 100 | 0 | 0 | 0 | 0 | 8 | 7 |
| contradiction-0.9 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 15 |
| contradiction-0.8 (keyless/selection) | 116 | 1 | 0 | 0 | 4 | 0 | 0 | 0 | 96 | 15 |
| contradiction-0.75 (keyless/selection) | 116 | 1 | 0 | 0 | 4 | 0 | 0 | 0 | 96 | 15 |
| crystallize-0.95 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 15 |
| crystallize-0.9 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 102 | 13 |
| crystallize-0.82 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 97 | 18 |
| k-5 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 15 |
| k-20 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 15 |
| minScore-0.25 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 15 |
| minScore-0.5 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 21 | 79 | 15 |
| minScore-0.75 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 110 | 2 | 3 |
| offlineWidth-128 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 95 | 20 |
| offlineWidth-256 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 86 | 29 |
| offlineWidth-512 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 79 | 36 |
| contradiction-0.8+minScore-0.25 (keyless/selection) | 116 | 1 | 0 | 0 | 4 | 0 | 0 | 0 | 96 | 15 |
| contradiction-0.8+minScore-0.5 (keyless/selection) | 116 | 1 | 0 | 0 | 4 | 0 | 0 | 20 | 76 | 15 |
| contradiction-0.9+minScore-0.25 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 15 |
| contradiction-0.9+minScore-0.5 (keyless/selection) | 116 | 1 | 0 | 0 | 0 | 0 | 0 | 21 | 79 | 15 |
| inert (live/selection) | — | — | — | — | — | — | — | — | — | — |
| shipped (live/selection) | — | — | — | — | — | — | — | — | — | — |
| minScore-0.5 (live/selection) | — | — | — | — | — | — | — | — | — | — |
| contradiction-0.8+minScore-0.25 (live/selection) | — | — | — | — | — | — | — | — | — | — |
| contradiction-0.8 (live/selection) | — | — | — | — | — | — | — | — | — | — |
| inert (live/confirmation) | — | — | — | — | — | — | — | — | — | — |
| shipped (live/confirmation) | — | — | — | — | — | — | — | — | — | — |
| contradiction-0.8+minScore-0.25 (live/confirmation) | — | — | — | — | — | — | — | — | — | — |

## What each cell did to the prompt, and what it cost

| cell | prompts unchanged | prompts changed | token proxy | per question | ratio vs inert | policy operations | verbatim floor |
|---|---:|---:|---:|---:|---:|---:|---:|
| inert (keyless/selection) | 64 | 0 | 148,787 | 2325 | 1.000 | 0 | 0.024 |
| shipped (keyless/selection) | 9 | 55 | 140,419 | 2194 | 0.944 | 4114 | 0.026 |
| novelty-0.99 (keyless/selection) | 64 | 0 | 148,787 | 2325 | 1.000 | 2 | 0.024 |
| novelty-0.97 (keyless/selection) | 64 | 0 | 148,787 | 2325 | 1.000 | 3 | 0.024 |
| novelty-0.9 (keyless/selection) | 14 | 50 | 140,864 | 2201 | 0.947 | 255 | 0.027 |
| novelty-0.75 (keyless/selection) | 0 | 64 | 84,193 | 1316 | 0.566 | 3108 | 0.022 |
| contradiction-0.9 (keyless/selection) | 60 | 4 | 147,840 | 2310 | 0.994 | 2583 | 0.023 |
| contradiction-0.8 (keyless/selection) | 55 | 9 | 147,603 | 2306 | 0.992 | 3876 | 0.023 |
| contradiction-0.75 (keyless/selection) | 55 | 9 | 147,603 | 2306 | 0.992 | 3918 | 0.023 |
| crystallize-0.95 (keyless/selection) | 64 | 0 | 148,787 | 2325 | 1.000 | 1 | 0.024 |
| crystallize-0.9 (keyless/selection) | 9 | 55 | 141,009 | 2203 | 0.948 | 253 | 0.027 |
| crystallize-0.82 (keyless/selection) | 0 | 64 | 102,660 | 1604 | 0.690 | 1968 | 0.025 |
| k-5 (keyless/selection) | 0 | 64 | 73,574 | 1150 | 0.494 | 0 | 0.023 |
| k-20 (keyless/selection) | 0 | 64 | 303,647 | 4744 | 2.041 | 0 | 0.025 |
| minScore-0.25 (keyless/selection) | 64 | 0 | 148,787 | 2325 | 1.000 | 0 | 0.024 |
| minScore-0.5 (keyless/selection) | 64 | 0 | 148,787 | 2325 | 1.000 | 0 | 0.024 |
| minScore-0.75 (keyless/selection) | 10 | 54 | 44,194 | 691 | 0.297 | 0 | 0.013 |
| offlineWidth-128 (keyless/selection) | 0 | 64 | 156,547 | 2446 | 1.052 | 0 | 0.036 |
| offlineWidth-256 (keyless/selection) | 0 | 64 | 152,069 | 2376 | 1.022 | 0 | 0.027 |
| offlineWidth-512 (keyless/selection) | 0 | 64 | 145,823 | 2278 | 0.980 | 0 | 0.025 |
| contradiction-0.8+minScore-0.25 (keyless/selection) | 55 | 9 | 147,603 | 2306 | 0.992 | 3876 | 0.023 |
| contradiction-0.8+minScore-0.5 (keyless/selection) | 55 | 9 | 147,603 | 2306 | 0.992 | 3876 | 0.023 |
| contradiction-0.9+minScore-0.25 (keyless/selection) | 60 | 4 | 147,840 | 2310 | 0.994 | 2583 | 0.023 |
| contradiction-0.9+minScore-0.5 (keyless/selection) | 60 | 4 | 147,840 | 2310 | 0.994 | 2583 | 0.023 |
| inert (live/selection) | 64 | 0 | 36,400 | 569 | 1.000 | 0 | — |
| shipped (live/selection) | 46 | 18 | 36,551 | 571 | 1.004 | 3441 | — |
| minScore-0.5 (live/selection) | 64 | 0 | 36,400 | 569 | 1.000 | 0 | — |
| contradiction-0.8+minScore-0.25 (live/selection) | 63 | 1 | 36,455 | 570 | 1.002 | 3405 | — |
| contradiction-0.8 (live/selection) | 63 | 1 | 36,455 | 570 | 1.002 | 3405 | — |
| inert (live/confirmation) | 89 | 0 | 59,866 | 673 | 1.000 | 0 | — |
| shipped (live/confirmation) | 61 | 28 | 60,600 | 681 | 1.012 | 1356 | — |
| contradiction-0.8+minScore-0.25 (live/confirmation) | 86 | 3 | 59,937 | 673 | 1.001 | 1341 | — |


## Every comparison, with what it could have seen

| treatment | control | metric | pairs | mean Δ | interval | paired SD | SE | min. detectable | tied | acting | eligible | promotes |
|---|---|---|---:|---:|---|---:|---:|---:|---:|---:|---|---|
| shipped / selection | inert | evidence-recall | 64 | -0.0469 | [-0.1094, 0.0000] | 0.2309 | 0.0289 | 0.0566 | 59 | 55 | yes | no |
| novelty-0.99 / selection | inert | evidence-recall | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 0 | yes | no |
| novelty-0.97 / selection | inert | evidence-recall | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 0 | yes | no |
| novelty-0.9 / selection | inert | evidence-recall | 64 | -0.0547 | [-0.1172, -0.0078] | 0.2203 | 0.0275 | 0.0540 | 60 | 50 | yes | no |
| novelty-0.75 / selection | inert | evidence-recall | 64 | -0.0705 | [-0.1536, 0.0099] | 0.3382 | 0.0423 | 0.0829 | 52 | 64 | yes | no |
| contradiction-0.9 / selection | inert | evidence-recall | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 4 | yes | no |
| contradiction-0.8 / selection | inert | evidence-recall | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 9 | yes | no |
| contradiction-0.75 / selection | inert | evidence-recall | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 9 | yes | no |
| crystallize-0.95 / selection | inert | evidence-recall | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 0 | yes | no |
| crystallize-0.9 / selection | inert | evidence-recall | 64 | -0.0547 | [-0.1172, -0.0078] | 0.2203 | 0.0275 | 0.0540 | 60 | 55 | yes | no |
| crystallize-0.82 / selection | inert | evidence-recall | 64 | -0.0556 | [-0.1399, 0.0247] | 0.3411 | 0.0426 | 0.0836 | 51 | 64 | yes | no |
| k-5 / selection | inert | evidence-recall | 64 | -0.0526 | [-0.1047, -0.0123] | 0.1905 | 0.0238 | 0.0467 | 57 | 64 | yes | no |
| k-20 / selection | inert | evidence-recall | 64 | 0.0234 | [0.0000, 0.0625] | 0.1389 | 0.0174 | 0.0340 | 62 | 64 | yes | no |
| minScore-0.25 / selection | inert | evidence-recall | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 0 | yes | no |
| minScore-0.5 / selection | inert | evidence-recall | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 0 | yes | no |
| minScore-0.75 / selection | inert | evidence-recall | 64 | -0.0757 | [-0.1391, -0.0240] | 0.2354 | 0.0294 | 0.0577 | 56 | 54 | yes | no |
| offlineWidth-128 / selection | inert | evidence-recall | 64 | 0.0229 | [-0.0089, 0.0664] | 0.1599 | 0.0200 | 0.0392 | 59 | 64 | **no** | no |
| offlineWidth-256 / selection | inert | evidence-recall | 64 | 0.0843 | [0.0246, 0.1529] | 0.2661 | 0.0333 | 0.0652 | 54 | 64 | **no** | no |
| offlineWidth-512 / selection | inert | evidence-recall | 64 | 0.1858 | [0.0949, 0.2835] | 0.3907 | 0.0488 | 0.0957 | 48 | 64 | **no** | no |
| contradiction-0.8+minScore-0.25 / selection | inert | evidence-recall | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 9 | yes | no |
| contradiction-0.8+minScore-0.5 / selection | inert | evidence-recall | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 9 | yes | no |
| contradiction-0.9+minScore-0.25 / selection | inert | evidence-recall | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 4 | yes | no |
| contradiction-0.9+minScore-0.5 / selection | inert | evidence-recall | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 4 | yes | no |
| shipped / selection | inert | locomo-f1 | 64 | -0.0165 | [-0.0529, 0.0055] | 0.1305 | 0.0163 | 0.0320 | 58 | 18 | yes | no |
| minScore-0.5 / selection | inert | locomo-f1 | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 0 | yes | no |
| contradiction-0.8+minScore-0.25 / selection | inert | locomo-f1 | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 1 | yes | no |
| contradiction-0.8 / selection | inert | locomo-f1 | 64 | 0.0000 | [0.0000, 0.0000] | 0.0000 | 0.0000 | 0.0000 | 64 | 1 | yes | no |
| shipped / confirmation | inert | locomo-f1 | 89 | 0.0100 | [-0.0015, 0.0271] | 0.0719 | 0.0076 | 0.0149 | 73 | 28 | yes | no |
| contradiction-0.8+minScore-0.25 / confirmation | inert | locomo-f1 | 89 | 0.0007 | [-0.0015, 0.0032] | 0.0115 | 0.0012 | 0.0024 | 86 | 3 | yes | no |

- **shipped / selection / evidence-recall**: no effect larger than 0.0566 was detectable at 64 pairs (paired SD 0.2309, standard error 0.0289, 59 tied, 55 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is -0.1094; category 2's lower bound -0.3750 is below -0.05; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 55 prompts it changed the mean is -0.0545 with interval [-0.1273, 0.0000].
- **novelty-0.99 / selection / evidence-recall**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 0 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. The cell changed no prompt at all.
- **novelty-0.97 / selection / evidence-recall**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 0 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. The cell changed no prompt at all.
- **novelty-0.9 / selection / evidence-recall**: no effect larger than 0.0540 was detectable at 64 pairs (paired SD 0.2203, standard error 0.0275, 60 tied, 50 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is -0.1172; category 2's lower bound -0.3750 is below -0.05; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied; on the 50 prompts it changed the interval is [-0.1500, -0.0100] — harmful exactly where it acts. On the 50 prompts it changed the mean is -0.0700 with interval [-0.1500, -0.0100] — **harmful exactly where it acts**.
- **novelty-0.75 / selection / evidence-recall**: no effect larger than 0.0829 was detectable at 64 pairs (paired SD 0.3382, standard error 0.0423, 52 tied, 64 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is -0.1536; category 1's lower bound -0.1138 is below -0.05; category 2's lower bound -0.4375 is below -0.05; category 4's lower bound -0.1250 is below -0.05; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 64 prompts it changed the mean is -0.0705 with interval [-0.1536, 0.0099].
- **contradiction-0.9 / selection / evidence-recall**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 4 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 4 prompts it changed the mean is 0.0000 with interval [0.0000, 0.0000].
- **contradiction-0.8 / selection / evidence-recall**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 9 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 9 prompts it changed the mean is 0.0000 with interval [0.0000, 0.0000].
- **contradiction-0.75 / selection / evidence-recall**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 9 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 9 prompts it changed the mean is 0.0000 with interval [0.0000, 0.0000].
- **crystallize-0.95 / selection / evidence-recall**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 0 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. The cell changed no prompt at all.
- **crystallize-0.9 / selection / evidence-recall**: no effect larger than 0.0540 was detectable at 64 pairs (paired SD 0.2203, standard error 0.0275, 60 tied, 55 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is -0.1172; category 2's lower bound -0.3750 is below -0.05; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied; on the 55 prompts it changed the interval is [-0.1364, -0.0091] — harmful exactly where it acts. On the 55 prompts it changed the mean is -0.0636 with interval [-0.1364, -0.0091] — **harmful exactly where it acts**.
- **crystallize-0.82 / selection / evidence-recall**: no effect larger than 0.0836 was detectable at 64 pairs (paired SD 0.3411, standard error 0.0426, 51 tied, 64 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is -0.1399; category 1's lower bound -0.0766 is below -0.05; category 2's lower bound -0.4375 is below -0.05; category 4's lower bound -0.1875 is below -0.05; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 64 prompts it changed the mean is -0.0556 with interval [-0.1399, 0.0247].
- **k-5 / selection / evidence-recall**: no effect larger than 0.0467 was detectable at 64 pairs (paired SD 0.1905, standard error 0.0238, 57 tied, 64 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is -0.1047; category 1's lower bound -0.0997 is below -0.05; category 2's lower bound -0.2188 is below -0.05; category 4's lower bound -0.1875 is below -0.05; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied; on the 64 prompts it changed the interval is [-0.1047, -0.0123] — harmful exactly where it acts. On the 64 prompts it changed the mean is -0.0526 with interval [-0.1047, -0.0123] — **harmful exactly where it acts**.
- **k-20 / selection / evidence-recall**: no effect larger than 0.0340 was detectable at 64 pairs (paired SD 0.1389, standard error 0.0174, 62 tied, 64 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 64 prompts it changed the mean is 0.0234 with interval [0.0000, 0.0625].
- **minScore-0.25 / selection / evidence-recall**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 0 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. The cell changed no prompt at all.
- **minScore-0.5 / selection / evidence-recall**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 0 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. The cell changed no prompt at all.
- **minScore-0.75 / selection / evidence-recall**: no effect larger than 0.0577 was detectable at 64 pairs (paired SD 0.2354, standard error 0.0294, 56 tied, 54 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is -0.1391; category 1's lower bound -0.1637 is below -0.05; category 2's lower bound -0.3125 is below -0.05; category 4's lower bound -0.1875 is below -0.05; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied; on the 54 prompts it changed the interval is [-0.1629, -0.0295] — harmful exactly where it acts. On the 54 prompts it changed the mean is -0.0897 with interval [-0.1629, -0.0295] — **harmful exactly where it acts**.
- **offlineWidth-128 / selection / evidence-recall**: no effect larger than 0.0392 was detectable at 64 pairs (paired SD 0.1599, standard error 0.0200, 59 tied, 64 acting). Does not promote: an ineligible comparison can never promote a cell; evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is -0.0089; category 1's lower bound -0.0647 is below -0.05; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 64 prompts it changed the mean is 0.0229 with interval [-0.0089, 0.0664].
- **offlineWidth-256 / selection / evidence-recall**: no effect larger than 0.0652 was detectable at 64 pairs (paired SD 0.2661, standard error 0.0333, 54 tied, 64 acting). Does not promote: an ineligible comparison can never promote a cell; evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 64 prompts it changed the mean is 0.0843 with interval [0.0246, 0.1529].
- **offlineWidth-512 / selection / evidence-recall**: no effect larger than 0.0957 was detectable at 64 pairs (paired SD 0.3907, standard error 0.0488, 48 tied, 64 acting). Does not promote: an ineligible comparison can never promote a cell; evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 64 prompts it changed the mean is 0.1858 with interval [0.0949, 0.2835].
- **contradiction-0.8+minScore-0.25 / selection / evidence-recall**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 9 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 9 prompts it changed the mean is 0.0000 with interval [0.0000, 0.0000].
- **contradiction-0.8+minScore-0.5 / selection / evidence-recall**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 9 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 9 prompts it changed the mean is 0.0000 with interval [0.0000, 0.0000].
- **contradiction-0.9+minScore-0.25 / selection / evidence-recall**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 4 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 4 prompts it changed the mean is 0.0000 with interval [0.0000, 0.0000].
- **contradiction-0.9+minScore-0.5 / selection / evidence-recall**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 4 acting). Does not promote: evidence-recall is a screen: a retrieval-only win can never change a default; a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000; no provider cost exists on this tier, so the clause cannot be satisfied; no provider cost exists on this tier, so the clause cannot be satisfied. On the 4 prompts it changed the mean is 0.0000 with interval [0.0000, 0.0000].
- **shipped / selection / locomo-f1**: no effect larger than 0.0320 was detectable at 64 pairs (paired SD 0.1305, standard error 0.0163, 58 tied, 18 acting). Does not promote: a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is -0.0529; category 3's lower bound -0.1842 is below -0.05. On the 18 prompts it changed the mean is -0.0587 with interval [-0.1892, 0.0214].
- **minScore-0.5 / selection / locomo-f1**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 0 acting). Does not promote: a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000. The cell changed no prompt at all.
- **contradiction-0.8+minScore-0.25 / selection / locomo-f1**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 1 acting). Does not promote: a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000. On the 1 prompts it changed the mean is 0.0000 with interval [0.0000, 0.0000].
- **contradiction-0.8 / selection / locomo-f1**: no effect larger than 0.0000 was detectable at 64 pairs (paired SD 0.0000, standard error 0.0000, 64 tied, 1 acting). Does not promote: a selection result allocates budget; only the held-out confirmation may change a default; the 95% lower bound is 0.0000. On the 1 prompts it changed the mean is 0.0000 with interval [0.0000, 0.0000].
- **shipped / confirmation / locomo-f1**: no effect larger than 0.0149 was detectable at 89 pairs (paired SD 0.0719, standard error 0.0076, 73 tied, 28 acting). Does not promote: the 95% lower bound is -0.0015. On the 28 prompts it changed the mean is 0.0318 with interval [-0.0037, 0.0850].
- **contradiction-0.8+minScore-0.25 / confirmation / locomo-f1**: no effect larger than 0.0024 was detectable at 89 pairs (paired SD 0.0115, standard error 0.0012, 86 tied, 3 acting). Does not promote: the 95% lower bound is -0.0015. On the 3 prompts it changed the mean is 0.0213 with interval [-0.0601, 0.0741].

The acting set is a blocking secondary: a policy that changes a quarter of the prompts can only move the product by a quarter of its local effect, so it can refuse a cell and never promote one. A comparison with a zero-crossing interval is a bounded null, not a proven absence.

The registered minimum detectable effect is 1.96 × the realized paired standard error: a precision diagnostic, not an 80%-power design calculation or an equivalence test. An all-tied sample has zero estimated variation and a degenerate bound; it cannot establish absence of a population effect. The conclusion is bounded to this dataset, model and registered sample.

## Live inference and purchase accounting

Provider openrouter, endpoint https://openrouter.ai/api/v1; answer z-ai/glm-5.3-flash; judge qwen/qwen3.8-27b; embedding baai/bge-m3 at 1024 dimensions. Thinking default; schema https://tangleai.dev/schemas/locomo-answer@1; HTTP attempts 1; deadline 120000 ms; concurrency 4; ceilings 200 per run / 900 total.
Inference identity: `19d9034ed276b9296ed70f3e3e61624f5f7d54cb2dce67a8245cb0f035bac30a`. Physical requests recorded: 258. Repairs, retries and failed requests consume this ceiling; cache replays do not. Provider token costs below include replayed response usage for a fair paired comparison.

### Embeddings-only census

Observed embedding calls (including cache invocations): 17; chat calls: 0. A candidate is dropped only if both operation counts and every registered retrieved context equal inert.

| cell | filtered | judged | judge failures | resolutions | merged | live | superseded | changed contexts | dropped |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| inert | 0 | 0 | 0 | 0 | 0 | 4155 | 0 | 0 | no |
| shipped | 2 | 3392 | 0 | 0 | 46 | 4108 | 1 | 19 | no |
| minScore-0.25 | 0 | 0 | 0 | 0 | 0 | 4155 | 0 | 0 | yes |
| minScore-0.5 | 0 | 0 | 0 | 0 | 0 | 4155 | 0 | 2 | no |
| contradiction-0.8+minScore-0.25 | 0 | 3404 | 0 | 0 | 0 | 4154 | 1 | 1 | no |
| contradiction-0.8 | 0 | 3404 | 0 | 0 | 0 | 4154 | 1 | 1 | no |

### Live answer quality

| cell / phase | F1 | category 1 | category 2 | category 3 | category 4 | evidence recall | cited recall | tokens / answer | calls / answer |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| inert (live/selection) | 0.138 | 0.094 | 0.183 | 0.090 | 0.187 | 0.133 | 0.125 | 900.390625 | 1 |
| shipped (live/selection) | 0.122 | 0.091 | 0.179 | 0.031 | 0.187 | 0.133 | 0.125 | 865.640625 | 1 |
| minScore-0.5 (live/selection) | 0.138 | 0.094 | 0.183 | 0.090 | 0.187 | 0.133 | 0.125 | 900.390625 | 1 |
| contradiction-0.8+minScore-0.25 (live/selection) | 0.138 | 0.094 | 0.183 | 0.090 | 0.187 | 0.133 | 0.125 | 896.875 | 1 |
| contradiction-0.8 (live/selection) | 0.138 | 0.094 | 0.183 | 0.090 | 0.187 | 0.133 | 0.125 | 896.875 | 1 |
| inert (live/confirmation) | 0.156 | 0.093 | 0.181 | 0.063 | 0.261 | 0.237 | 0.228 | 998.4943820224719 | 1 |
| shipped (live/confirmation) | 0.166 | 0.096 | 0.193 | 0.062 | 0.284 | 0.251 | 0.241 | 1011.2359550561798 | 1 |
| contradiction-0.8+minScore-0.25 (live/confirmation) | 0.157 | 0.093 | 0.183 | 0.063 | 0.261 | 0.237 | 0.228 | 998.7865168539325 | 1 |

### Live paired category bounds

| cell / phase | category | pairs | mean delta | one-sided lower bound |
|---|---:|---:|---:|---:|
| shipped / selection | 1 | 16 | -0.0030 | -0.0086 |
| shipped / selection | 2 | 16 | -0.0039 | -0.0333 |
| shipped / selection | 3 | 16 | -0.0592 | -0.1842 |
| shipped / selection | 4 | 16 | 0.0000 | 0.0000 |
| minScore-0.5 / selection | 1 | 16 | 0.0000 | 0.0000 |
| minScore-0.5 / selection | 2 | 16 | 0.0000 | 0.0000 |
| minScore-0.5 / selection | 3 | 16 | 0.0000 | 0.0000 |
| minScore-0.5 / selection | 4 | 16 | 0.0000 | 0.0000 |
| contradiction-0.8+minScore-0.25 / selection | 1 | 16 | 0.0000 | 0.0000 |
| contradiction-0.8+minScore-0.25 / selection | 2 | 16 | 0.0000 | 0.0000 |
| contradiction-0.8+minScore-0.25 / selection | 3 | 16 | 0.0000 | 0.0000 |
| contradiction-0.8+minScore-0.25 / selection | 4 | 16 | 0.0000 | 0.0000 |
| contradiction-0.8 / selection | 1 | 16 | 0.0000 | 0.0000 |
| contradiction-0.8 / selection | 2 | 16 | 0.0000 | 0.0000 |
| contradiction-0.8 / selection | 3 | 16 | 0.0000 | 0.0000 |
| contradiction-0.8 / selection | 4 | 16 | 0.0000 | 0.0000 |
| shipped / confirmation | 1 | 24 | 0.0027 | -0.0082 |
| shipped / confirmation | 2 | 24 | 0.0117 | 0.0000 |
| shipped / confirmation | 3 | 17 | -0.0008 | -0.0023 |
| shipped / confirmation | 4 | 24 | 0.0232 | -0.0071 |
| contradiction-0.8+minScore-0.25 / confirmation | 1 | 24 | 0.0006 | -0.0050 |
| contradiction-0.8+minScore-0.25 / confirmation | 2 | 24 | 0.0021 | 0.0000 |
| contradiction-0.8+minScore-0.25 / confirmation | 3 | 17 | 0.0000 | 0.0000 |
| contradiction-0.8+minScore-0.25 / confirmation | 4 | 24 | 0.0000 | 0.0000 |

### Locked selection and default decision

Challenger `contradiction-0.8+minScore-0.25`, transition `dc50dbb1fb2a572f2b0086584c641bca8a9f9cc02ceae6423b50f3d3ca36f7db`: greatest eligible paired delta (0.0000) among 3 cells whose point category deltas all clear -0.05 and whose token and call ratios meet the objective; ties by ascending cell identity.
Default `inert`. the challenger did not pass every registered clause, so the inert cell is the default and the result is a bounded null: no effect larger than 0.0024 was detectable at 89 pairs (paired SD 0.0115, standard error 0.0012, 86 tied, 3 acting).

Raw evidence retains category-5 judgments, invalid replies, unresolved citations, provider usage, errors and latency. Each file has an immutable content hash:

- [selection evidence 5ba73af465eb](../benchmark/results/locomo-policy.json.selection.5ba73af465eb86fb1543a9b66963d446af7332f57bb71a68d10b8e4153457181.json) (SHA-256 `5ba73af465eb86fb1543a9b66963d446af7332f57bb71a68d10b8e4153457181`).
- [selection evidence d68986d7e876](../benchmark/results/locomo-policy.json.selection.d68986d7e8765279db7bc143dc3d0c21af3c5a779181d6587f5c4d9784f31fcf.json) (SHA-256 `d68986d7e8765279db7bc143dc3d0c21af3c5a779181d6587f5c4d9784f31fcf`).
- [selection evidence fc0705e19885](../benchmark/results/locomo-policy.json.selection.fc0705e198853f9a1f372c27e28c7eefbdbfe9a4ef901dfdbd179625ea875503.json) (SHA-256 `fc0705e198853f9a1f372c27e28c7eefbdbfe9a4ef901dfdbd179625ea875503`).
- [selection evidence 5ff951c3a317](../benchmark/results/locomo-policy.json.selection.5ff951c3a3175147c6fffbf7199405222c7b61158936b7016ab726e95e9893d7.json) (SHA-256 `5ff951c3a3175147c6fffbf7199405222c7b61158936b7016ab726e95e9893d7`).
- [selection evidence f7e2d12443bc](../benchmark/results/locomo-policy.json.selection.f7e2d12443bcb0d9a0eae7def99d9ed95c7554ae7a84ae87df5fb2b03fc0a043.json) (SHA-256 `f7e2d12443bcb0d9a0eae7def99d9ed95c7554ae7a84ae87df5fb2b03fc0a043`).
- [confirmation evidence 91316962517e](../benchmark/results/locomo-policy.json.confirmation.91316962517e2075b4a721b1323d17248c6e02d6a121cf18de6141c06066de17.json) (SHA-256 `91316962517e2075b4a721b1323d17248c6e02d6a121cf18de6141c06066de17`).
- [confirmation evidence 72382b47fc07](../benchmark/results/locomo-policy.json.confirmation.72382b47fc0788b853950dfefbda87f4ca9b9ed9cddad00a3b2e939ea4b1c110.json) (SHA-256 `72382b47fc0788b853950dfefbda87f4ca9b9ed9cddad00a3b2e939ea4b1c110`).
- [confirmation evidence 2e82d7e7190d](../benchmark/results/locomo-policy.json.confirmation.2e82d7e7190d0dce6524404527db0e90d4a0fef2ae9dae1450c2ae5c78744f6b.json) (SHA-256 `2e82d7e7190d0dce6524404527db0e90d4a0fef2ae9dae1450c2ae5c78744f6b`).

## The gate

**Gate passed.** The oracle row equals its analytic ceiling at k = 10 and the seeded random row sits in its band, so the scorer under every number above is proven.

## Selection state

State **confirmed**. a challenger is the greatest selection overall paired delta among eligible cells whose point category deltas are all at least the registered floor and whose normalized token and call costs meet the objective, ties broken by ascending cell identity; the tie-break is evidence recall at the cell's own effective k descending, verbatim floor at that same k descending, prompt-token proxy ascending, policy operations ascending, cell identity ascending.
Shortlist: `inert`, `shipped`, `minScore-0.5`, `contradiction-0.8+minScore-0.25`, `contradiction-0.8`.

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
| minScore-0.25 | ineligible | mechanically-inert-under-embedder: every live operation count equals the inert cell's and every registered selection question retrieves byte-identical context, so buying its answers would buy the inert cell twice |

## The built-in embedding width — a lexical-tier result

| width | evidence recall @ k | verbatim floor | token proxy | policy operations |
|---|---:|---:|---:|---:|
| 64 | 0.126 | 0.024 | 148,787 | 0 |
| 128 | 0.149 | 0.036 | 156,547 | 0 |
| 256 | 0.211 | 0.027 | 152,069 | 0 |
| 512 | 0.312 | 0.025 | 145,823 | 0 |

Read at k = 10. Proposed `OFFLINE_EMBEDDER_DIMS`: **512** — a lexical-tier retrieval result: it governs OFFLINE_EMBEDDER_DIMS, the width used when no provider is configured, which never serves a live answer. It is not an answer-quality result and it enters no clause of the objective.


---


LoCoMo is CC BY-NC 4.0 (Maharana et al., ACL 2024, arXiv:2402.17753). This repository does not redistribute it; `git submodule update --init benchmark/locomo` fetches it.
