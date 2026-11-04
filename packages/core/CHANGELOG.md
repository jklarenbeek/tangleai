# @tangleai/core

## 0.45.0

### Patch Changes

- Tooling: the Jaren bootstrap runs npm through the npm CLI that launched it, without a shell, so `npm run jaren:bootstrap` runs on Windows as on Linux. `compose/searxng.yml` serves SearxNG for the grounding web diagnostic; the web run keeps its model calls in the wire cache and its name resolutions beside its HTTP capture, `--web-replay` rebuilds a recorded run with zero network calls and fails unless its report identity is reproduced, and `--web-structured` sets the model's structured-output tier. The diagnostic ran on 2026-11-04 with Anthropic's Haiku 5.5 and replays byte for byte. The graph-retrieval live registration moves to Haiku 5.5 with every schema carried in the prompt. Every workspace now depends on the others at the exact suite version, so an install never mixes two Tangle releases. The interactive `changeset` command is gone with `@changesets/cli` and its 14 development packages: release intent is a hand-written `.changeset/<name>.md` file (see `.changeset/README.md`), and changelogs are written by `@changesets/changelog-git`, as before. Development audit findings in `launch-editor` and `shell-quote` are gone with it.
- Updated dependencies
  - @tangleai/context@0.45.0

## 0.44.0

### Patch Changes

- Move every package onto the Jaren 0.176.11 foundation, still consumed as candidate tarballs rebuilt byte for byte from the pinned source because npm does not serve that release. Its store builds a collection statement's SQL only when the statement is first prepared and gives every transaction view the same lazy member getters, so a finished transaction no longer outlives its collections.
- @tangleai/context@0.44.0

## 0.43.1

### Patch Changes

- Move every package onto the Jaren 0.176.8 foundation, still consumed as candidate tarballs rebuilt byte for byte from the pinned source because npm does not serve that release. Its validator tests tuples, leading object and array types and type-only members by code, and its default first-failure mode now asserts `required` beside a `properties` that names no member, as its collecting mode already did. No Tangle schema relies on the earlier answer, and no Tangle interface changes.
- @tangleai/context@0.43.1

## 0.43.0

### Minor Changes

- Move every package onto the Jaren 0.176.5 foundation, still consumed as candidate tarballs rebuilt byte for byte from the pinned source because npm does not serve that release. Its corrected JSLT registry and Node handler declarations remove the playground's options cast and the contract test's handler annotation. Its schema compiler no longer builds a discarded error for each reference-only array item and builds each document with an `$id` once, so compiling the role schemas takes about two thirds of the earlier time. No Tangle interface changes.

### Patch Changes

- @tangleai/context@0.43.0

## 0.42.1

### Patch Changes

- @tangleai/context@0.42.1

## 0.42.0

### Patch Changes

- @tangleai/context@0.42.0

## 0.41.0

### Patch Changes

- @tangleai/context@0.41.0

## 0.40.0

### Patch Changes

- @tangleai/context@0.40.0

## 0.39.0

### Patch Changes

- @tangleai/context@0.39.0

## 0.38.0

### Minor Changes

- e229e63: Expose uniform distinct-index initialization beside the default k-means++ initializer. Both use the same bounded iteration and injected random source. Refuse zero-weight weighted selections at a zero draw, and reassign points after the first centroid update before declaring convergence.

### Patch Changes

- @tangleai/context@0.38.0

## 0.37.0

### Minor Changes

- 364b336: Add closed sourced-place contracts, exact cited alias matching, temporal location claims and atomic gazetteer persistence with verified zero-write replay. Support explicit spatial intent and recognize location, residence and proximity questions in the existing authoring gates.

### Patch Changes

- @tangleai/context@0.37.0

## 0.36.0

### Patch Changes

- @tangleai/context@0.36.0

## 0.35.0

### Patch Changes

- @tangleai/context@0.35.0

## 0.34.0

### Patch Changes

- 2dce4bd: Add retained parent and child document evidence, shared bounded lexical retrieval,
  and governed hybrid local selection with atomic curator promotion. Preserve the
  flat defaults and consolidation scoring while fixing heading expansion and
  retaining superseded evidence addresses.
- a542379: Add bounded governed web retrieval with exact HTTP replay, cumulative plan budgets, atomic evidence traces and optional shared-budget model reranking. Enforce per-hop admission and protected mapped IPv6 addresses in the existing document fetcher. Share browser-safe HTML/text extraction and canonical HTTP capture identities with existing document and benchmark owners.
- @tangleai/context@0.34.0

## 0.33.0

### Patch Changes

- @tangleai/context@0.33.0

## 0.32.0

### Patch Changes

- @tangleai/context@0.32.0

## 0.31.0

### Patch Changes

- @tangleai/context@0.31.0

## 0.30.1

### Patch Changes

- @tangleai/context@0.30.1

## 0.30.0

### Patch Changes

- @tangleai/context@0.30.0

## 0.29.8

### Patch Changes

- @tangleai/context@0.29.8

## 0.29.7

### Patch Changes

- @tangleai/context@0.29.7

## 0.29.6

### Patch Changes

- @tangleai/context@0.29.6

## 0.29.5

### Patch Changes

- @tangleai/context@0.29.5

## 0.29.4

### Patch Changes

- @tangleai/context@0.29.4

## 0.29.3

### Patch Changes

- @tangleai/context@0.29.3

## 0.29.2

### Patch Changes

- @tangleai/context@0.29.2

## 0.29.1

### Patch Changes

- @tangleai/context@0.29.1

## 0.29.0

### Patch Changes

- @tangleai/context@0.29.0

## 0.28.0

### Patch Changes

- @tangleai/context@0.28.0

## 0.27.3

### Patch Changes

- 9f7d8c8: Limit active release CI to Linux and the minimum supported Node consumer gate. Preserve the complete Windows workflow outside the active Actions directory for the future 1.0.0 release, with restoration instructions. Package runtime behavior is unchanged.
- @tangleai/context@0.27.3

## 0.27.2

### Patch Changes

- @tangleai/context@0.27.2

## 0.27.1

### Patch Changes

- @tangleai/context@0.27.1

## 0.27.0

### Minor Changes

- a6fa7f3: Add opt-in host-driven consolidation triggers and closed Jaren contract operations, with durable arrival/completion timing, restart-aware cooldown, bounded scheduling and drained close.
- d4d8d0b: Add immutable consolidation source snapshots, artifacts, bounded pending buffers and atomic pass/operation receipts with memory and Node/Bun SQLite parity. Preserve source evidence and qualify replay, rollback, concurrent activation and installed consumers.
- 63504f3: Add supported structured consolidation with durable callback reservations, staged restart, explicit unknown resolution, fresh embedding validation and atomic activation. Preserve overlapping evidence until active work is resolved, and expose logical-call accounting without claiming provider usage.

### Patch Changes

- 7f2e26f: Reject duplicate synthesis claims before support or embedding and refuse malformed direct executor requests before effects. Document the opt-in tiers, host operations, durable recovery and measured retrieval limits, with an installed Node/Bun example.
- Updated dependencies [6dcfde9]
  - @tangleai/context@0.27.0

## 0.26.3

### Patch Changes

- @tangleai/context@0.26.3

## 0.26.2

### Patch Changes

- @tangleai/context@0.26.2

## 0.26.1

### Patch Changes

- @tangleai/context@0.26.1

## 0.26.0

### Minor Changes

- 6e0f5be: Add opt-in evidenced temporal memory with distinct occurrence, observation, knowledge and validity semantics, bounded structured preparation, immutable SQLite projections and cited calendar answers. Qualify public Node, Bun and browser consumers, strict temporal fixtures and both full LongMemEval source profiles. Preserve ordinary recall defaults; live temporal QA gains and deployment costs remain unmeasured.

### Patch Changes

- @tangleai/context@0.26.0

## 0.25.1

### Patch Changes

- Consume the exact Jaren 0.87.0 registry packages and source pin. Qualify native SQLite schema changes, column references, JSON type inspection and per-call mutation semantics alongside Tangle records across Node, Bun and installed consumers. Preserve the existing document storage model and historical paid measurements.
- Updated dependencies
  - @tangleai/context@0.25.1

## 0.25.0

### Patch Changes

- @tangleai/context@0.25.0

## 0.24.1

### Patch Changes

- @tangleai/context@0.24.1

## 0.24.0

### Patch Changes

- @tangleai/context@0.24.0

## 0.23.0

### Patch Changes

- @tangleai/context@0.23.0

## 0.22.0

### Patch Changes

- Updated dependencies
  - @tangleai/context@0.22.0

## 0.21.1

### Patch Changes

- Update the exact Jaren foundation dependencies and source pin to the published
  0.84.3 release after verifying its AI-free archives against source-built bytes.
  Retain Tangle's model, context and agent ownership and align the development
  Node pin with 24.20.0. Tangle publication remains a manual author action.
  Allow release preparation after an already committed local release while
  preserving its record and rejecting unprepared version edits.
- Updated dependencies
  - @tangleai/context@0.21.1

## 0.21.0

### Minor Changes

- Use the models, context and agents owners of the inherited AI mechanisms. MAS
  executable identity version 3 names all executed mechanism versions; an old
  executable checkpoint is refused intact through the existing mismatch path.
  Memory and ledger records retain their schemas and projection contracts.

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @tangleai/context@0.21.0

## 0.20.1

### Patch Changes

- Wait for npm publish-time scanning before verifying fresh installations. Upload the complete suite, then poll full and install package indexes for up to 20 minutes, requiring matching versions, integrity and latest tags. Keep mismatched artifacts fatal and report packages that remain unavailable, so direct main releases can finish without manually retrying normal scan delays. Complete each release from the successful publication attempt's exact artifact ID, preserving earlier failed receipts without selecting them.

## 0.20.0

### Minor Changes

- Establish the coordinated 0.20.0 release with JavaScript and TypeScript declaration distributions, preserved public subpaths and JSON schemas, and verified Node and Bun consumers. Use published JarenJS 0.83.3 fixes without a consumer installation patch. Prepare versions before release commits, verify locally, push directly to main and publish CI-verified tarballs. Deploy the website independently from local Tangle workspace source with JarenJS packages from npm, verifying dependency sources and the live commit.
