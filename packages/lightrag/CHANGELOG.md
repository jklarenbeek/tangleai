# @tangleai/lightrag

## 0.41.0

### Minor Changes

- Add explicit native graph vector declarations and guarded migrations for canonical
  entities and relations. Complete document and graph identity changes stage in a
  separate store, swap atomically, and retain exact zero-embedding rollback with
  revision-fenced disposal and column-removal guards.

  Expose an optional native graph candidate seam with plan verification, physical
  statistics, complete trace parity and counted sweep fallback. Default graph
  retrieval continues to use the sweep; the registered scale instrument measures
  native performance and operational costs before any production adoption.

### Patch Changes

- @tangleai/agents@0.41.0
  - @tangleai/context@0.41.0
  - @tangleai/core@0.41.0
  - @tangleai/documents@0.41.0
  - @tangleai/models@0.41.0
  - @tangleai/outcomes@0.41.0

## 0.40.0

### Patch Changes

- Updated dependencies [a8765d5]
- Updated dependencies [1beddfc]
  - @tangleai/outcomes@0.40.0
  - @tangleai/agents@0.40.0
  - @tangleai/context@0.40.0
  - @tangleai/core@0.40.0
  - @tangleai/documents@0.40.0
  - @tangleai/models@0.40.0

## 0.39.0

### Patch Changes

- @tangleai/agents@0.39.0
  - @tangleai/context@0.39.0
  - @tangleai/core@0.39.0
  - @tangleai/documents@0.39.0
  - @tangleai/models@0.39.0
  - @tangleai/outcomes@0.39.0

## 0.38.0

### Patch Changes

- Updated dependencies [dc083d7]
- Updated dependencies [e229e63]
  - @tangleai/documents@0.38.0
  - @tangleai/core@0.38.0
  - @tangleai/outcomes@0.38.0
  - @tangleai/agents@0.38.0
  - @tangleai/context@0.38.0
  - @tangleai/models@0.38.0

## 0.37.0

### Patch Changes

- Updated dependencies [364b336]
  - @tangleai/core@0.37.0
  - @tangleai/documents@0.37.0
  - @tangleai/outcomes@0.37.0
  - @tangleai/agents@0.37.0
  - @tangleai/context@0.37.0
  - @tangleai/models@0.37.0

## 0.36.0

### Patch Changes

- @tangleai/agents@0.36.0
  - @tangleai/context@0.36.0
  - @tangleai/core@0.36.0
  - @tangleai/documents@0.36.0
  - @tangleai/models@0.36.0
  - @tangleai/outcomes@0.36.0

## 0.35.0

### Minor Changes

- 44c24f8: Prepare document and graph evidence outside storage, then activate both under one checked source fence and atomic transaction. Preserve identity across incremental replacement, retract obsolete support, reuse retained contributions without new model or embedding calls, and collect only explicitly unreferenced historical document evidence. Ordinary document updates to indexed sources now require joint promotion; use createCorpusPromotion to preserve document and graph consistency.
- 0e81abc: Prepare evidence-bound graph contributions through injected structured extraction, bounded gleaning, co-reference review, profiling, and separate name and theme embeddings. Compile four static prompt packs with owned schema identities, reserve the shared budget before each call, retain failure spend and partial evidence, and reproduce the complete keyless fixture without writing an active graph.
- 9529ecd: Share the grounded answer contract and generate auditable graph answers with exact supplied citations, metered repair and named recall fallbacks. Expose experimental desktop graph inspection through two read operations and exercise both graph stores in the keyless consumer.
- 9564a6a: Add evidence-bound graph claims, canonical identity and support validation, checked source-head transitions, pure contribution plans, and identical atomic memory and SQLite lifecycle behavior. Retain superseded evidence and merged identities, reject stale or forged plans before writes, and make exact replay a zero-write operation. These contracts remain experimental and make no graph retrieval quality claim.
- 8df35fd: Measure graph coverage, incremental replacement and the registered SQLite scale ladder. Add separately authorized paired-answer and order-swapped judge instruments with retained attempts, request ceilings, control drift and explicit unrun licensed parity. Graph retrieval remains experimental.

  Bound large SQLite graph membership filters while preserving transaction consistency, intersections, distinct rows and deterministic ordering.

  Reuse contribution-scoped claim, endpoint and profile lookups while retaining the complete canonical validation and co-reference review rules.

  Keep retained preparation bound once in graph write-plan snapshots and restore its exact bytes at the atomic storage boundary. This prevents large source promotion from exceeding the runtime's JSON string limit through duplicated projection payloads. Recompute older serialized write plans before applying them; stored projections and contributions remain compatible.
- 6117dd1: Add bounded low, high and hybrid graph retrieval with metered keyword planning, one-hop expansion, active document citations and a shared context serializer. Publish deterministic scripted measurements and the original-text ablation beside unchanged dense controls.

### Patch Changes

- Updated dependencies [44c24f8]
- Updated dependencies [9529ecd]
  - @tangleai/documents@0.35.0
  - @tangleai/agents@0.35.0
  - @tangleai/context@0.35.0
  - @tangleai/core@0.35.0
  - @tangleai/models@0.35.0
  - @tangleai/outcomes@0.35.0

## 0.34.0

Initial development surface for evidence-bound graph contracts, pure projection
planning, and shared in-memory and SQLite lifecycle validation.
