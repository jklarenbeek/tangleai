# @tangleai/research

## 0.48.3

### Patch Changes

- Build on Jaren 0.201.0. Its calendar repeats monthly and yearly by the iCalendar standard, so the desktop Calendar now offers "Every month" and "Every year", and its editor says when a series skips a date that a month or year lacks. The Pages playground is now built on Jaren's play host kit instead of a copy of Jaren's site: a saved or shared session no longer carries a message language and opens in its reader's, and an example made to show one language shows it for its own run.
- Updated dependencies
  - @tangleai/models@0.48.3
  - @tangleai/context@0.48.3
  - @tangleai/agents@0.48.3
  - @tangleai/config@0.48.3
  - @tangleai/mas@0.48.3
  - @tangleai/documents@0.48.3
  - @tangleai/search@0.48.3
  - @tangleai/outcomes@0.48.3
  - @tangleai/trace2skill@0.48.3
  - @tangleai/evolve@0.48.3
  - @tangleai/gmpl@0.48.3

## 0.48.2

### Patch Changes

- Build on Jaren 0.199.0, whose calendar (`@jarenjs/core/calendar`), iCalendar writer (`@jarenjs/josl/ical`) and calendar-scheduled database jobs arrive in these releases. The Pages desktop gains a Calendar built on them: a month view, a day panel and an editor, recurring events with skipped days, "find a time" over the person's working hours that never offers unknown time, an iCalendar export, and a `calendar` contract (agenda, add, free) that the assistant and other applications use as tools.
- Updated dependencies
  - @tangleai/models@0.48.2
  - @tangleai/context@0.48.2
  - @tangleai/agents@0.48.2
  - @tangleai/config@0.48.2
  - @tangleai/mas@0.48.2
  - @tangleai/documents@0.48.2
  - @tangleai/search@0.48.2
  - @tangleai/outcomes@0.48.2
  - @tangleai/trace2skill@0.48.2
  - @tangleai/evolve@0.48.2
  - @tangleai/gmpl@0.48.2

## 0.48.1

### Patch Changes

- Build on Jaren 0.193.1. Its `sha256Hex` replaces the nine local SHA-256 helpers, each keeping its name, with identical digests. MAS caches compiled embedded schemas with Jaren's semantic cache, which now remembers the key of a frozen tree: 0.31 µs per lookup against 22.8 µs before. The Studio authoring gate now refuses an element written as an object and names an unknown operator with the nearest known one. The Studio file author sends an open profile in the prompt to an Anthropic model, which refuses an output schema with an open object, so the Pages Studio assistant no longer fails with HTTP 400 on the default model. The assistant's Japanese and Traditional Chinese packs use Jaren's 「…」 permalink wording.
- Updated dependencies
  - @tangleai/models@0.48.1
  - @tangleai/context@0.48.1
  - @tangleai/agents@0.48.1
  - @tangleai/config@0.48.1
  - @tangleai/mas@0.48.1
  - @tangleai/documents@0.48.1
  - @tangleai/search@0.48.1
  - @tangleai/outcomes@0.48.1
  - @tangleai/trace2skill@0.48.1
  - @tangleai/evolve@0.48.1
  - @tangleai/gmpl@0.48.1

## 0.48.0

### Minor Changes

- Make Tangle OS the Pages site. Studio, Playground, Flow, Data, the adventure, the memory loop and moving browser data are desktop applications now, beside Welcome, the assistant, Settings and the to-do module; the assistant uses the work applications' authoring tools, and a former page link opens its application. `@tangleai/os` adds theme kits (`THEME_KITS`, `composeTheme`): each is one JSON document with light and dark palettes, a procedural wallpaper and a shape, and a person's changes (accent, highlight, pattern, seed, density, glass, corners, spacing) compose into an ordinary theme document that can be exported and imported. Five procedural wallpapers (`PATTERNS`, `patternBackground`: woven threads, contours, a two-ink halftone, a sun print and moiré tides) are drawn deterministically from a seed in the theme's own colours. Windows are laid out above the dock.

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.48.0
  - @tangleai/context@0.48.0
  - @tangleai/agents@0.48.0
  - @tangleai/config@0.48.0
  - @tangleai/mas@0.48.0
  - @tangleai/documents@0.48.0
  - @tangleai/search@0.48.0
  - @tangleai/outcomes@0.48.0
  - @tangleai/trace2skill@0.48.0
  - @tangleai/evolve@0.48.0
  - @tangleai/gmpl@0.48.0

## 0.47.0

### Minor Changes

- Add `@tangleai/os`, a browser operating system for applications built on Jaren and Tangle. A module is a JSON manifest plus the contract operations it serves and needs; the desktop hosts it as a shipped component, as a jaren-app document in a sandboxed opaque-origin frame, or as an application's own page on its own origin that joins with `connectToOs` from `@tangleai/os/module`. The kernel installs modules in shipped, suite and user layers with RFC 6902 patches, keeps a journal with undo and a recovery boot, routes every call between modules as a contract operation under grants into a ledger, carries mail, and lists every granted operation as an assistant tool. The assistant's model placeholder and the documentation now name only the models that write Jaren's JSON documents reliably: `anthropic/claude-haiku-5.5`, and Qwen 3.7 27B or larger. The desktop has context menus on its background, title bars and dock, minimized windows now actually hide, and `mountDesktop` takes `themeFor` and `onSchemeSwitch` so a host's own colours survive the dock's light/dark switch. The Pages desktop ships an Assistant window and a Settings app: provider, OpenRouter key (kept in this browser, optionally for the tab only), region, a model picker over OpenRouter's catalogue, appearance, and forgetting what the browser keeps.

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.47.0
  - @tangleai/context@0.47.0
  - @tangleai/agents@0.47.0
  - @tangleai/config@0.47.0
  - @tangleai/mas@0.47.0
  - @tangleai/documents@0.47.0
  - @tangleai/search@0.47.0
  - @tangleai/outcomes@0.47.0
  - @tangleai/trace2skill@0.47.0
  - @tangleai/evolve@0.47.0
  - @tangleai/gmpl@0.47.0

## 0.46.0

### Patch Changes

- Build on Jaren 0.188.0. Its validator keeps the text a schema's `errorMessage` wrote in every locale, a `$msgid` fallback included, and a validation error's `toJSON` carries that mark; `diffContracts` reports fewer false and more real breaking changes; `@jarenjs/db` reads a PostgreSQL `jsonb` null as SQL NULL and names unguarded number columns in `introspect()`. Every exact `@jarenjs/*` pin moves from 0.184.2 to 0.188.0, and the candidate tarballs are recaptured from the tagged source with an empty patch. Local copies of canonical cloning and RFC 6901 token escaping are replaced by `@jarenjs/json`'s `cloneJson` and pointer helpers, with identical output.
- Updated dependencies
  - @tangleai/agents@0.46.0
  - @tangleai/config@0.46.0
  - @tangleai/context@0.46.0
  - @tangleai/documents@0.46.0
  - @tangleai/evolve@0.46.0
  - @tangleai/gmpl@0.46.0
  - @tangleai/mas@0.46.0
  - @tangleai/models@0.46.0
  - @tangleai/outcomes@0.46.0
  - @tangleai/trace2skill@0.46.0
  - @tangleai/search@0.46.0

## 0.45.2

### Patch Changes

- @tangleai/documents@0.45.2
  - @tangleai/evolve@0.45.2
  - @tangleai/outcomes@0.45.2
  - @tangleai/search@0.45.2
  - @tangleai/trace2skill@0.45.2
  - @tangleai/agents@0.45.2
  - @tangleai/config@0.45.2
  - @tangleai/context@0.45.2
  - @tangleai/gmpl@0.45.2
  - @tangleai/mas@0.45.2
  - @tangleai/models@0.45.2

## 0.45.1

### Patch Changes

- @tangleai/documents@0.45.1
  - @tangleai/evolve@0.45.1
  - @tangleai/outcomes@0.45.1
  - @tangleai/search@0.45.1
  - @tangleai/trace2skill@0.45.1
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
  - @tangleai/agents@0.45.0
  - @tangleai/context@0.45.0
  - @tangleai/models@0.45.0
  - @tangleai/documents@0.45.0
  - @tangleai/mas@0.45.0
  - @tangleai/outcomes@0.45.0
  - @tangleai/trace2skill@0.45.0
  - @tangleai/config@0.45.0
  - @tangleai/evolve@0.45.0
  - @tangleai/search@0.45.0
  - @tangleai/gmpl@0.45.0

## 0.44.0

### Patch Changes

- @tangleai/agents@0.44.0
  - @tangleai/config@0.44.0
  - @tangleai/context@0.44.0
  - @tangleai/documents@0.44.0
  - @tangleai/evolve@0.44.0
  - @tangleai/gmpl@0.44.0
  - @tangleai/mas@0.44.0
  - @tangleai/models@0.44.0
  - @tangleai/outcomes@0.44.0
  - @tangleai/search@0.44.0
  - @tangleai/trace2skill@0.44.0

## 0.43.1

### Patch Changes

- @tangleai/agents@0.43.1
  - @tangleai/config@0.43.1
  - @tangleai/context@0.43.1
  - @tangleai/documents@0.43.1
  - @tangleai/evolve@0.43.1
  - @tangleai/gmpl@0.43.1
  - @tangleai/mas@0.43.1
  - @tangleai/models@0.43.1
  - @tangleai/outcomes@0.43.1
  - @tangleai/search@0.43.1
  - @tangleai/trace2skill@0.43.1

## 0.43.0

### Patch Changes

- Updated dependencies
  - @tangleai/documents@0.43.0
  - @tangleai/evolve@0.43.0
  - @tangleai/outcomes@0.43.0
  - @tangleai/search@0.43.0
  - @tangleai/agents@0.43.0
  - @tangleai/config@0.43.0
  - @tangleai/context@0.43.0
  - @tangleai/gmpl@0.43.0
  - @tangleai/mas@0.43.0
  - @tangleai/models@0.43.0
  - @tangleai/trace2skill@0.43.0

## 0.42.1

### Patch Changes

- Updated dependencies
  - @tangleai/mas@0.42.1
  - @tangleai/agents@0.42.1
  - @tangleai/config@0.42.1
  - @tangleai/context@0.42.1
  - @tangleai/documents@0.42.1
  - @tangleai/evolve@0.42.1
  - @tangleai/gmpl@0.42.1
  - @tangleai/models@0.42.1
  - @tangleai/outcomes@0.42.1
  - @tangleai/search@0.42.1
  - @tangleai/trace2skill@0.42.1

## 0.42.0

### Minor Changes

- Move every package onto the Jaren 0.161.0 foundation, consumed as candidate tarballs rebuilt byte for byte from the pinned source because npm does not serve that release. Absorb its typed check outcomes, stage-discriminated guarded commits, strict retry options and typed migration plans; remove the two declaration bridges its corrected LINQ declarations make unnecessary; re-derive the paid memory policy report's interval statistics under its corrected nearest-rank quantile, which changes the default policy's provenance report id but no selection, decision or default value; and raise the program pen bundle ceiling to 29,000 bytes for the larger captured-expression module.

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.42.0
  - @tangleai/agents@0.42.0
  - @tangleai/mas@0.42.0
  - @tangleai/evolve@0.42.0
  - @tangleai/context@0.42.0
  - @tangleai/documents@0.42.0
  - @tangleai/outcomes@0.42.0
  - @tangleai/trace2skill@0.42.0
  - @tangleai/gmpl@0.42.0
  - @tangleai/config@0.42.0
  - @tangleai/search@0.42.0

## 0.41.0

### Patch Changes

- @tangleai/agents@0.41.0
  - @tangleai/config@0.41.0
  - @tangleai/context@0.41.0
  - @tangleai/documents@0.41.0
  - @tangleai/evolve@0.41.0
  - @tangleai/gmpl@0.41.0
  - @tangleai/mas@0.41.0
  - @tangleai/models@0.41.0
  - @tangleai/outcomes@0.41.0
  - @tangleai/search@0.41.0
  - @tangleai/trace2skill@0.41.0

## 0.40.0

### Patch Changes

- Updated dependencies [a8765d5]
- Updated dependencies [1beddfc]
  - @tangleai/outcomes@0.40.0
  - @tangleai/evolve@0.40.0
  - @tangleai/trace2skill@0.40.0
  - @tangleai/agents@0.40.0
  - @tangleai/config@0.40.0
  - @tangleai/context@0.40.0
  - @tangleai/documents@0.40.0
  - @tangleai/gmpl@0.40.0
  - @tangleai/mas@0.40.0
  - @tangleai/models@0.40.0
  - @tangleai/search@0.40.0

## 0.39.0

### Minor Changes

- aa45527: Retain origin-bound research lessons and stage held-out-validated procedure
  candidates through the native guarded compiler and atomic research transaction.
  Expose the native candidate diff calculation for shared compiler receipts.
  Generate bounded source-class proposals, qualify immutable sets through native
  outcome promotion and rollback, and freeze their procedures into workflow and
  export provenance. Retain actual lesson measurements and refusals with writeback
  disabled by default.
- c804d7f: Bind immutable domain profiles to exact host capabilities before research stages execute.

  Add the tabular statistics profile with independently reproduced CSV samples,
  signed metric directions, deterministic paired uncertainty and guarded lesson
  measurements. Retain unsupported-profile refusals before execution and explicit
  external benchmark deferral.

### Patch Changes

- cd819a1: Show persisted research runs, artifact lineage, lessons and independently qualified ablation reports through read-only operations and run-addressed sequence replay.
- 6e5c582: Keep malformed asynchronous domain validators as counted refusals through process settlement, including rejected promises and throwing thenable accessors. Document guarded lessons, measured defaults, domain coverage and research operations with pinned report and contract checks.
- Updated dependencies [aa45527]
  - @tangleai/trace2skill@0.39.0
  - @tangleai/agents@0.39.0
  - @tangleai/config@0.39.0
  - @tangleai/context@0.39.0
  - @tangleai/documents@0.39.0
  - @tangleai/evolve@0.39.0
  - @tangleai/gmpl@0.39.0
  - @tangleai/mas@0.39.0
  - @tangleai/models@0.39.0
  - @tangleai/outcomes@0.39.0
  - @tangleai/search@0.39.0

## 0.38.0

### Minor Changes

- accf91e: Bind research experiments to immutable workspaces and execution manifests, independently reproduce registered metrics, and preserve replicate receipts through native workflow recovery. Expose bounded native process settlement evidence to injected hosts without changing existing runner outcomes.
- e6a6f5c: Run the research lifecycle through one durable MAS workflow with bounded refinement, pivot and review, manifest-bound gates, exact stage replay and counted overdue policy. Preserve task-refusal causes and atomically fence terminal interaction, run and attempt writes in the native store.
- de8a412: Analyze registered experiments with independent aggregates, explicit replication
  power and frozen branch selection. Retain native peer-review findings and every
  candidate cost when planning bounded Proceed, Refine, Pivot or Stop decisions.

  Resume missing seeds with unchanged authored code, expose bounded repair inputs,
  and atomically activate pivot amendments while preserving exploratory results.
- 802642f: Run evidence-linked synthesis, hypothesis generation and preregistration through
  native single-agent or GMPL debate stages, with read-only tools, retained model
  costs, atomic plan freezing and advisory novelty replay. Bind participant-specific
  GMPL prompts without changing pattern topology and preserve typed native refusals.
- 32cba1d: Introduce closed research records, content-addressed artifact provenance and atomic lifecycle persistence. Preserve run-log identities across recreated writers and compose frame writes inside caller transactions.
- dc083d7: Add native-provider scholarly discovery with durable query plans, exact offline replay, explicit screening and immutable source evidence cards. Retain failed and partial request observations without admitting incomplete literature. Allow bounded document response readers to cancel pending reads through an injected signal.
- 8a5af48: Add attributable research commands, guarded immutable proposal edits and bounded
  human retries. Record cancellation responses atomically, disclose experimental
  automatic gate tasks, and export exact intervention counts with the measured
  core research handoff.
- 8d988df: Bind reviewable research drafts to admitted quotations and registered observations,
  verify claims independently, and reproduce Markdown and optional TeX exports with
  complete provenance, explicit unresolved claims and file checksums.

### Patch Changes

- Updated dependencies [accf91e]
- Updated dependencies [e6a6f5c]
- Updated dependencies [802642f]
- Updated dependencies [dc083d7]
- Updated dependencies [8a5af48]
  - @tangleai/evolve@0.38.0
  - @tangleai/mas@0.38.0
  - @tangleai/gmpl@0.38.0
  - @tangleai/documents@0.38.0
  - @tangleai/search@0.38.0
  - @tangleai/agents@0.38.0
  - @tangleai/config@0.38.0
  - @tangleai/context@0.38.0
  - @tangleai/models@0.38.0
