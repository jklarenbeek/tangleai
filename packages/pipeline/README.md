# @tangleai/pipeline

Tangle AI pipeline — the memory loop as a jaren-dag document, executed by @jarenjs/flow, projected to mermaid for display

Install with `npm install @tangleai/pipeline`. The npm distribution provides ESM JavaScript, TypeScript declarations, and the documented package subpaths for Node 24 and Bun 1.4 or newer.

See the [Tangle documentation](https://github.com/jklarenbeek/tangleai#readme) for architecture, examples, and runtime requirements. All public Tangle packages use one coordinated version.

`DEFAULT_THRESHOLDS` and `createOfflineEmbedder()` consume the selected
`@tangleai/memory/policy` contract. The current ingest default is inert (novelty,
contradiction and crystallization thresholds are 2); the offline embedder is
`hash-trigram-512`. Explicit `thresholds`, `embedder` and `judge` options retain
their meanings. Outcome learning remains driven by evidenced outcomes.

The [memory package](../memory/README.md) documents the exact policy provenance,
measured alternatives and the explicit historical 64-dimensional configuration.
The [registered report](https://github.com/jklarenbeek/tangleai/blob/main/docs/LOCOMO_POLICY.md)
explains the held-out bounded-null decision and the independent lexical width.
