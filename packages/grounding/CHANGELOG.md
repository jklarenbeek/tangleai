# @tangleai/grounding

## 0.48.0

### Minor Changes

- Make Tangle OS the Pages site. Studio, Playground, Flow, Data, the adventure, the memory loop and moving browser data are desktop applications now, beside Welcome, the assistant, Settings and the to-do module; the assistant uses the work applications' authoring tools, and a former page link opens its application. `@tangleai/os` adds theme kits (`THEME_KITS`, `composeTheme`): each is one JSON document with light and dark palettes, a procedural wallpaper and a shape, and a person's changes (accent, highlight, pattern, seed, density, glass, corners, spacing) compose into an ordinary theme document that can be exported and imported. Five procedural wallpapers (`PATTERNS`, `patternBackground`: woven threads, contours, a two-ink halftone, a sun print and moiré tides) are drawn deterministically from a seed in the theme's own colours. Windows are laid out above the dock.

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.48.0
  - @tangleai/context@0.48.0
  - @tangleai/agents@0.48.0
  - @tangleai/core@0.48.0
  - @tangleai/config@0.48.0
  - @tangleai/mas@0.48.0
  - @tangleai/documents@0.48.0
  - @tangleai/search@0.48.0
  - @tangleai/gmpl@0.48.0

## 0.47.0

### Minor Changes

- Add `@tangleai/os`, a browser operating system for applications built on Jaren and Tangle. A module is a JSON manifest plus the contract operations it serves and needs; the desktop hosts it as a shipped component, as a jaren-app document in a sandboxed opaque-origin frame, or as an application's own page on its own origin that joins with `connectToOs` from `@tangleai/os/module`. The kernel installs modules in shipped, suite and user layers with RFC 6902 patches, keeps a journal with undo and a recovery boot, routes every call between modules as a contract operation under grants into a ledger, carries mail, and lists every granted operation as an assistant tool. The assistant's model placeholder and the documentation now name only the models that write Jaren's JSON documents reliably: `anthropic/claude-haiku-5.5`, and Qwen 3.7 27B or larger. The desktop has context menus on its background, title bars and dock, minimized windows now actually hide, and `mountDesktop` takes `themeFor` and `onSchemeSwitch` so a host's own colours survive the dock's light/dark switch. The Pages desktop ships an Assistant window and a Settings app: provider, OpenRouter key (kept in this browser, optionally for the tab only), region, a model picker over OpenRouter's catalogue, appearance, and forgetting what the browser keeps.

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.47.0
  - @tangleai/context@0.47.0
  - @tangleai/agents@0.47.0
  - @tangleai/core@0.47.0
  - @tangleai/config@0.47.0
  - @tangleai/mas@0.47.0
  - @tangleai/documents@0.47.0
  - @tangleai/search@0.47.0
  - @tangleai/gmpl@0.47.0

## 0.46.0

### Patch Changes

- Build on Jaren 0.188.0. Its validator keeps the text a schema's `errorMessage` wrote in every locale, a `$msgid` fallback included, and a validation error's `toJSON` carries that mark; `diffContracts` reports fewer false and more real breaking changes; `@jarenjs/db` reads a PostgreSQL `jsonb` null as SQL NULL and names unguarded number columns in `introspect()`. Every exact `@jarenjs/*` pin moves from 0.184.2 to 0.188.0, and the candidate tarballs are recaptured from the tagged source with an empty patch. Local copies of canonical cloning and RFC 6901 token escaping are replaced by `@jarenjs/json`'s `cloneJson` and pointer helpers, with identical output.
- Updated dependencies
  - @tangleai/agents@0.46.0
  - @tangleai/config@0.46.0
  - @tangleai/context@0.46.0
  - @tangleai/core@0.46.0
  - @tangleai/documents@0.46.0
  - @tangleai/gmpl@0.46.0
  - @tangleai/mas@0.46.0
  - @tangleai/models@0.46.0
  - @tangleai/search@0.46.0

## 0.45.2

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.45.2
  - @tangleai/documents@0.45.2
  - @tangleai/search@0.45.2
  - @tangleai/agents@0.45.2
  - @tangleai/config@0.45.2
  - @tangleai/context@0.45.2
  - @tangleai/gmpl@0.45.2
  - @tangleai/mas@0.45.2
  - @tangleai/models@0.45.2

## 0.45.1

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.45.1
  - @tangleai/documents@0.45.1
  - @tangleai/search@0.45.1
  - @tangleai/agents@0.45.1
  - @tangleai/config@0.45.1
  - @tangleai/context@0.45.1
  - @tangleai/gmpl@0.45.1
  - @tangleai/mas@0.45.1
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
  - @tangleai/mas@0.45.0
  - @tangleai/config@0.45.0
  - @tangleai/search@0.45.0
  - @tangleai/gmpl@0.45.0

## 0.44.0

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.44.0
  - @tangleai/agents@0.44.0
  - @tangleai/config@0.44.0
  - @tangleai/context@0.44.0
  - @tangleai/documents@0.44.0
  - @tangleai/gmpl@0.44.0
  - @tangleai/mas@0.44.0
  - @tangleai/models@0.44.0
  - @tangleai/search@0.44.0

## 0.43.1

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.43.1
  - @tangleai/agents@0.43.1
  - @tangleai/config@0.43.1
  - @tangleai/context@0.43.1
  - @tangleai/documents@0.43.1
  - @tangleai/gmpl@0.43.1
  - @tangleai/mas@0.43.1
  - @tangleai/models@0.43.1
  - @tangleai/search@0.43.1

## 0.43.0

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @tangleai/documents@0.43.0
  - @tangleai/core@0.43.0
  - @tangleai/search@0.43.0
  - @tangleai/agents@0.43.0
  - @tangleai/config@0.43.0
  - @tangleai/context@0.43.0
  - @tangleai/gmpl@0.43.0
  - @tangleai/mas@0.43.0
  - @tangleai/models@0.43.0

## 0.42.1

### Patch Changes

- Updated dependencies
  - @tangleai/mas@0.42.1
  - @tangleai/agents@0.42.1
  - @tangleai/config@0.42.1
  - @tangleai/context@0.42.1
  - @tangleai/core@0.42.1
  - @tangleai/documents@0.42.1
  - @tangleai/gmpl@0.42.1
  - @tangleai/models@0.42.1
  - @tangleai/search@0.42.1

## 0.42.0

### Minor Changes

- Move every package onto the Jaren 0.161.0 foundation, consumed as candidate tarballs rebuilt byte for byte from the pinned source because npm does not serve that release. Absorb its typed check outcomes, stage-discriminated guarded commits, strict retry options and typed migration plans; remove the two declaration bridges its corrected LINQ declarations make unnecessary; re-derive the paid memory policy report's interval statistics under its corrected nearest-rank quantile, which changes the default policy's provenance report id but no selection, decision or default value; and raise the program pen bundle ceiling to 29,000 bytes for the larger captured-expression module.

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.42.0
  - @tangleai/agents@0.42.0
  - @tangleai/mas@0.42.0
  - @tangleai/context@0.42.0
  - @tangleai/documents@0.42.0
  - @tangleai/gmpl@0.42.0
  - @tangleai/config@0.42.0
  - @tangleai/core@0.42.0
  - @tangleai/search@0.42.0

## 0.41.0

### Patch Changes

- @tangleai/agents@0.41.0
  - @tangleai/config@0.41.0
  - @tangleai/context@0.41.0
  - @tangleai/core@0.41.0
  - @tangleai/documents@0.41.0
  - @tangleai/gmpl@0.41.0
  - @tangleai/mas@0.41.0
  - @tangleai/models@0.41.0
  - @tangleai/search@0.41.0

## 0.40.0

### Patch Changes

- @tangleai/agents@0.40.0
  - @tangleai/config@0.40.0
  - @tangleai/context@0.40.0
  - @tangleai/core@0.40.0
  - @tangleai/documents@0.40.0
  - @tangleai/gmpl@0.40.0
  - @tangleai/mas@0.40.0
  - @tangleai/models@0.40.0
  - @tangleai/search@0.40.0

## 0.39.0

### Patch Changes

- @tangleai/agents@0.39.0
  - @tangleai/config@0.39.0
  - @tangleai/context@0.39.0
  - @tangleai/core@0.39.0
  - @tangleai/documents@0.39.0
  - @tangleai/gmpl@0.39.0
  - @tangleai/mas@0.39.0
  - @tangleai/models@0.39.0
  - @tangleai/search@0.39.0

## 0.38.0

### Patch Changes

- Updated dependencies [e6a6f5c]
- Updated dependencies [802642f]
- Updated dependencies [dc083d7]
- Updated dependencies [e229e63]
- Updated dependencies [8a5af48]
  - @tangleai/mas@0.38.0
  - @tangleai/gmpl@0.38.0
  - @tangleai/documents@0.38.0
  - @tangleai/core@0.38.0
  - @tangleai/search@0.38.0
  - @tangleai/agents@0.38.0
  - @tangleai/config@0.38.0
  - @tangleai/context@0.38.0
  - @tangleai/models@0.38.0

## 0.37.0

### Patch Changes

- Updated dependencies [364b336]
  - @tangleai/core@0.37.0
  - @tangleai/documents@0.37.0
  - @tangleai/search@0.37.0
  - @tangleai/agents@0.37.0
  - @tangleai/config@0.37.0
  - @tangleai/context@0.37.0
  - @tangleai/gmpl@0.37.0
  - @tangleai/mas@0.37.0
  - @tangleai/models@0.37.0

## 0.36.0

### Patch Changes

- Updated dependencies [ac6f698]
- Updated dependencies [43cfab8]
  - @tangleai/gmpl@0.36.0
  - @tangleai/mas@0.36.0
  - @tangleai/agents@0.36.0
  - @tangleai/config@0.36.0
  - @tangleai/context@0.36.0
  - @tangleai/core@0.36.0
  - @tangleai/documents@0.36.0
  - @tangleai/models@0.36.0
  - @tangleai/search@0.36.0

## 0.35.0

### Patch Changes

- Updated dependencies [44c24f8]
- Updated dependencies [9529ecd]
  - @tangleai/documents@0.35.0
  - @tangleai/agents@0.35.0
  - @tangleai/config@0.35.0
  - @tangleai/context@0.35.0
  - @tangleai/core@0.35.0
  - @tangleai/gmpl@0.35.0
  - @tangleai/mas@0.35.0
  - @tangleai/models@0.35.0
  - @tangleai/search@0.35.0

## 0.34.0

### Minor Changes

- c643e1e: Compose durable grounded sessions through the native MAS workflow and SQLite
  worker, with typed clarification, bounded retrieval and validated claim ledgers.
  Register revision-pinned agent components under native physical-call accounting.
  Checkpoint ABI 7 excludes unused branch outputs from downstream input identities
  while preserving strict provenance checks. Add retained session readers and
  native queue recovery.
- 8e34634: Add rules-first intent triage, durable one-question clarification and pinned atomic
  query plans with host-response fact projection. Compile grounding prompt packs,
  share enclosing call budgets with MAS, expose intent-only GMPL clarification and
  bind the existing SQLite queue to the optimizer. Retain native response fencing,
  replay, turn limits and explicit budget failure accounting.
- 1c79b6a: Reconcile admitted evidence by authority and proven time, persist conflict decisions, and generate claim ledgers through native citation validation and bounded guarded repair.
- d66c899: Add closed grounding profiles and evidence contracts with deterministic rule evaluation, revisioned session transitions and atomic memory/SQLite persistence.
- 2dce4bd: Add retained parent and child document evidence, shared bounded lexical retrieval,
  and governed hybrid local selection with atomic curator promotion. Preserve the
  flat defaults and consolidation scoring while fixing heading expansion and
  retaining superseded evidence addresses.
- 8b85ba6: Bound the final combined evidence context, reject unsupported configured personal
  facts in generated claims and caveats, and support profiles with no clarification
  turns. Qualify the composed grounding workflow with paired ablations, adversarial
  controls and an exact-authorized live runner. Share bounded response reading with
  HTTP capture so an oversized response cannot be drained before its budget check.
- a542379: Add bounded governed web retrieval with exact HTTP replay, cumulative plan budgets, atomic evidence traces and optional shared-budget model reranking. Enforce per-hop admission and protected mapped IPv6 addresses in the existing document fetcher. Share browser-safe HTML/text extraction and canonical HTTP capture identities with existing document and benchmark owners.

### Patch Changes

- Updated dependencies [c643e1e]
- Updated dependencies [8e34634]
- Updated dependencies [2dce4bd]
- Updated dependencies [8b85ba6]
- Updated dependencies [a542379]
  - @tangleai/mas@0.34.0
  - @tangleai/gmpl@0.34.0
  - @tangleai/core@0.34.0
  - @tangleai/documents@0.34.0
  - @tangleai/agents@0.34.0
  - @tangleai/config@0.34.0
  - @tangleai/context@0.34.0
  - @tangleai/models@0.34.0
  - @tangleai/search@0.34.0

Release history is generated from coordinated Changesets.
