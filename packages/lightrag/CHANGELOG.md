# @tangleai/lightrag

## 0.48.2

### Patch Changes

- Build on Jaren 0.199.0, whose calendar (`@jarenjs/core/calendar`), iCalendar writer (`@jarenjs/josl/ical`) and calendar-scheduled database jobs arrive in these releases. The Pages desktop gains a Calendar built on them: a month view, a day panel and an editor, recurring events with skipped days, "find a time" over the person's working hours that never offers unknown time, an iCalendar export, and a `calendar` contract (agenda, add, free) that the assistant and other applications use as tools.
- Updated dependencies
  - @tangleai/models@0.48.2
  - @tangleai/context@0.48.2
  - @tangleai/agents@0.48.2
  - @tangleai/core@0.48.2
  - @tangleai/documents@0.48.2
  - @tangleai/outcomes@0.48.2

## 0.48.1

### Patch Changes

- Build on Jaren 0.193.1. Its `sha256Hex` replaces the nine local SHA-256 helpers, each keeping its name, with identical digests. MAS caches compiled embedded schemas with Jaren's semantic cache, which now remembers the key of a frozen tree: 0.31 µs per lookup against 22.8 µs before. The Studio authoring gate now refuses an element written as an object and names an unknown operator with the nearest known one. The Studio file author sends an open profile in the prompt to an Anthropic model, which refuses an output schema with an open object, so the Pages Studio assistant no longer fails with HTTP 400 on the default model. The assistant's Japanese and Traditional Chinese packs use Jaren's 「…」 permalink wording.
- Updated dependencies
  - @tangleai/models@0.48.1
  - @tangleai/context@0.48.1
  - @tangleai/agents@0.48.1
  - @tangleai/core@0.48.1
  - @tangleai/documents@0.48.1
  - @tangleai/outcomes@0.48.1

## 0.48.0

### Minor Changes

- Make Tangle OS the Pages site. Studio, Playground, Flow, Data, the adventure, the memory loop and moving browser data are desktop applications now, beside Welcome, the assistant, Settings and the to-do module; the assistant uses the work applications' authoring tools, and a former page link opens its application. `@tangleai/os` adds theme kits (`THEME_KITS`, `composeTheme`): each is one JSON document with light and dark palettes, a procedural wallpaper and a shape, and a person's changes (accent, highlight, pattern, seed, density, glass, corners, spacing) compose into an ordinary theme document that can be exported and imported. Five procedural wallpapers (`PATTERNS`, `patternBackground`: woven threads, contours, a two-ink halftone, a sun print and moiré tides) are drawn deterministically from a seed in the theme's own colours. Windows are laid out above the dock.

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.48.0
  - @tangleai/context@0.48.0
  - @tangleai/agents@0.48.0
  - @tangleai/core@0.48.0
  - @tangleai/documents@0.48.0
  - @tangleai/outcomes@0.48.0

## 0.47.0

### Minor Changes

- Add `@tangleai/os`, a browser operating system for applications built on Jaren and Tangle. A module is a JSON manifest plus the contract operations it serves and needs; the desktop hosts it as a shipped component, as a jaren-app document in a sandboxed opaque-origin frame, or as an application's own page on its own origin that joins with `connectToOs` from `@tangleai/os/module`. The kernel installs modules in shipped, suite and user layers with RFC 6902 patches, keeps a journal with undo and a recovery boot, routes every call between modules as a contract operation under grants into a ledger, carries mail, and lists every granted operation as an assistant tool. The assistant's model placeholder and the documentation now name only the models that write Jaren's JSON documents reliably: `anthropic/claude-haiku-5.5`, and Qwen 3.7 27B or larger. The desktop has context menus on its background, title bars and dock, minimized windows now actually hide, and `mountDesktop` takes `themeFor` and `onSchemeSwitch` so a host's own colours survive the dock's light/dark switch. The Pages desktop ships an Assistant window and a Settings app: provider, OpenRouter key (kept in this browser, optionally for the tab only), region, a model picker over OpenRouter's catalogue, appearance, and forgetting what the browser keeps.

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.47.0
  - @tangleai/context@0.47.0
  - @tangleai/agents@0.47.0
  - @tangleai/core@0.47.0
  - @tangleai/documents@0.47.0
  - @tangleai/outcomes@0.47.0

## 0.46.0

### Patch Changes

- Build on Jaren 0.188.0. Its validator keeps the text a schema's `errorMessage` wrote in every locale, a `$msgid` fallback included, and a validation error's `toJSON` carries that mark; `diffContracts` reports fewer false and more real breaking changes; `@jarenjs/db` reads a PostgreSQL `jsonb` null as SQL NULL and names unguarded number columns in `introspect()`. Every exact `@jarenjs/*` pin moves from 0.184.2 to 0.188.0, and the candidate tarballs are recaptured from the tagged source with an empty patch. Local copies of canonical cloning and RFC 6901 token escaping are replaced by `@jarenjs/json`'s `cloneJson` and pointer helpers, with identical output.
- Updated dependencies
  - @tangleai/agents@0.46.0
  - @tangleai/context@0.46.0
  - @tangleai/core@0.46.0
  - @tangleai/documents@0.46.0
  - @tangleai/models@0.46.0
  - @tangleai/outcomes@0.46.0

## 0.45.2

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.45.2
  - @tangleai/documents@0.45.2
  - @tangleai/outcomes@0.45.2
  - @tangleai/agents@0.45.2
  - @tangleai/context@0.45.2
  - @tangleai/models@0.45.2

## 0.45.1

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.45.1
  - @tangleai/documents@0.45.1
  - @tangleai/outcomes@0.45.1
  - @tangleai/agents@0.45.1
  - @tangleai/context@0.45.1
  - @tangleai/models@0.45.1

## 0.45.0

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangleai/agents@0.45.0
  - @tangleai/context@0.45.0
  - @tangleai/models@0.45.0
  - @tangleai/documents@0.45.0
  - @tangleai/core@0.45.0
  - @tangleai/outcomes@0.45.0

## 0.44.0

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.44.0
  - @tangleai/agents@0.44.0
  - @tangleai/context@0.44.0
  - @tangleai/documents@0.44.0
  - @tangleai/models@0.44.0
  - @tangleai/outcomes@0.44.0

## 0.43.1

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.43.1
  - @tangleai/agents@0.43.1
  - @tangleai/context@0.43.1
  - @tangleai/documents@0.43.1
  - @tangleai/models@0.43.1
  - @tangleai/outcomes@0.43.1

## 0.43.0

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @tangleai/documents@0.43.0
  - @tangleai/core@0.43.0
  - @tangleai/outcomes@0.43.0
  - @tangleai/agents@0.43.0
  - @tangleai/context@0.43.0
  - @tangleai/models@0.43.0

## 0.42.1

### Patch Changes

- @tangleai/agents@0.42.1
  - @tangleai/context@0.42.1
  - @tangleai/core@0.42.1
  - @tangleai/documents@0.42.1
  - @tangleai/models@0.42.1
  - @tangleai/outcomes@0.42.1

## 0.42.0

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.42.0
  - @tangleai/agents@0.42.0
  - @tangleai/context@0.42.0
  - @tangleai/documents@0.42.0
  - @tangleai/outcomes@0.42.0
  - @tangleai/core@0.42.0

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
