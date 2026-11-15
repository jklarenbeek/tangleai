# @tangleai/trading

## 0.49.0

### Patch Changes

- A limit that would never be reached is refused before any call, with `AI0001`: `maxRepairs`, `retry.attempts` and an agent's `maxToolRounds` and `budget.turns` must be whole numbers of at least 0, and `budget.tokens`, `budget.ms` and `budget.cost` finite numbers of at least 0. Before, `maxRepairs: Infinity` repaired without end and a NaN turn budget never stopped a run; `maxRepairs: -1` made no call and returned a failure with no errors. A structured result's `attempts` is the number of calls made.
- Build on Jaren 0.201.2, two patch releases of database, ordering and calendar fixes with fuller type declarations.
- `@tangleai/os` can be used from another repository without a registry. Every release keeps the package tarball, a one-file module side (`connectToOs` with its dependencies inside, for a page on any foundation) and a manifest of their hashes, protocol and Jaren foundation under `releases/os/`, and the desktop site serves the same files under `os/`. The package now depends on Jaren alone. `kernel.operations()` lists what a caller may call as plain data, for an application with its own agent runtime. Migration: `kernel.tools()` builds its tools with the host's tool builder, so pass one when creating the kernel: `createKernel({ tools })` with `import * as tools from "@tangleai/agents/toolbox"`; without one it refuses with `OS0301`.
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangleai/mas@0.49.0
  - @tangleai/gmpl@0.49.0

## 0.48.3

### Patch Changes

- Build on Jaren 0.201.0. Its calendar repeats monthly and yearly by the iCalendar standard, so the desktop Calendar now offers "Every month" and "Every year", and its editor says when a series skips a date that a month or year lacks. The Pages playground is now built on Jaren's play host kit instead of a copy of Jaren's site: a saved or shared session no longer carries a message language and opens in its reader's, and an example made to show one language shows it for its own run.
- Updated dependencies
  - @tangleai/mas@0.48.3
  - @tangleai/gmpl@0.48.3

## 0.48.2

### Patch Changes

- Build on Jaren 0.199.0, whose calendar (`@jarenjs/core/calendar`), iCalendar writer (`@jarenjs/josl/ical`) and calendar-scheduled database jobs arrive in these releases. The Pages desktop gains a Calendar built on them: a month view, a day panel and an editor, recurring events with skipped days, "find a time" over the person's working hours that never offers unknown time, an iCalendar export, and a `calendar` contract (agenda, add, free) that the assistant and other applications use as tools.
- Updated dependencies
  - @tangleai/mas@0.48.2
  - @tangleai/gmpl@0.48.2

## 0.48.1

### Patch Changes

- Build on Jaren 0.193.1. Its `sha256Hex` replaces the nine local SHA-256 helpers, each keeping its name, with identical digests. MAS caches compiled embedded schemas with Jaren's semantic cache, which now remembers the key of a frozen tree: 0.31 µs per lookup against 22.8 µs before. The Studio authoring gate now refuses an element written as an object and names an unknown operator with the nearest known one. The Studio file author sends an open profile in the prompt to an Anthropic model, which refuses an output schema with an open object, so the Pages Studio assistant no longer fails with HTTP 400 on the default model. The assistant's Japanese and Traditional Chinese packs use Jaren's 「…」 permalink wording.
- Updated dependencies
  - @tangleai/mas@0.48.1
  - @tangleai/gmpl@0.48.1

## 0.48.0

### Minor Changes

- Make Tangle OS the Pages site. Studio, Playground, Flow, Data, the adventure, the memory loop and moving browser data are desktop applications now, beside Welcome, the assistant, Settings and the to-do module; the assistant uses the work applications' authoring tools, and a former page link opens its application. `@tangleai/os` adds theme kits (`THEME_KITS`, `composeTheme`): each is one JSON document with light and dark palettes, a procedural wallpaper and a shape, and a person's changes (accent, highlight, pattern, seed, density, glass, corners, spacing) compose into an ordinary theme document that can be exported and imported. Five procedural wallpapers (`PATTERNS`, `patternBackground`: woven threads, contours, a two-ink halftone, a sun print and moiré tides) are drawn deterministically from a seed in the theme's own colours. Windows are laid out above the dock.

### Patch Changes

- Updated dependencies
  - @tangleai/mas@0.48.0
  - @tangleai/gmpl@0.48.0

## 0.47.0

### Minor Changes

- Add `@tangleai/os`, a browser operating system for applications built on Jaren and Tangle. A module is a JSON manifest plus the contract operations it serves and needs; the desktop hosts it as a shipped component, as a jaren-app document in a sandboxed opaque-origin frame, or as an application's own page on its own origin that joins with `connectToOs` from `@tangleai/os/module`. The kernel installs modules in shipped, suite and user layers with RFC 6902 patches, keeps a journal with undo and a recovery boot, routes every call between modules as a contract operation under grants into a ledger, carries mail, and lists every granted operation as an assistant tool. The assistant's model placeholder and the documentation now name only the models that write Jaren's JSON documents reliably: `anthropic/claude-haiku-5.5`, and Qwen 3.7 27B or larger. The desktop has context menus on its background, title bars and dock, minimized windows now actually hide, and `mountDesktop` takes `themeFor` and `onSchemeSwitch` so a host's own colours survive the dock's light/dark switch. The Pages desktop ships an Assistant window and a Settings app: provider, OpenRouter key (kept in this browser, optionally for the tab only), region, a model picker over OpenRouter's catalogue, appearance, and forgetting what the browser keeps.

### Patch Changes

- Updated dependencies
  - @tangleai/mas@0.47.0
  - @tangleai/gmpl@0.47.0

## 0.46.0

### Patch Changes

- Build on Jaren 0.188.0. Its validator keeps the text a schema's `errorMessage` wrote in every locale, a `$msgid` fallback included, and a validation error's `toJSON` carries that mark; `diffContracts` reports fewer false and more real breaking changes; `@jarenjs/db` reads a PostgreSQL `jsonb` null as SQL NULL and names unguarded number columns in `introspect()`. Every exact `@jarenjs/*` pin moves from 0.184.2 to 0.188.0, and the candidate tarballs are recaptured from the tagged source with an empty patch. Local copies of canonical cloning and RFC 6901 token escaping are replaced by `@jarenjs/json`'s `cloneJson` and pointer helpers, with identical output.
- Updated dependencies
  - @tangleai/gmpl@0.46.0
  - @tangleai/mas@0.46.0

## 0.45.2

### Patch Changes

- @tangleai/gmpl@0.45.2
  - @tangleai/mas@0.45.2

## 0.45.1

### Patch Changes

- @tangleai/gmpl@0.45.1
  - @tangleai/mas@0.45.1

## 0.45.0

### Patch Changes

- @tangleai/mas@0.45.0
  - @tangleai/gmpl@0.45.0

## 0.44.0

### Patch Changes

- @tangleai/gmpl@0.44.0
  - @tangleai/mas@0.44.0

## 0.43.1

### Patch Changes

- @tangleai/gmpl@0.43.1
  - @tangleai/mas@0.43.1

## 0.43.0

### Patch Changes

- @tangleai/gmpl@0.43.0
  - @tangleai/mas@0.43.0

## 0.42.1

### Patch Changes

- Updated dependencies
  - @tangleai/mas@0.42.1
  - @tangleai/gmpl@0.42.1

## 0.42.0

### Patch Changes

- Updated dependencies
  - @tangleai/mas@0.42.0
  - @tangleai/gmpl@0.42.0

## 0.41.0

### Patch Changes

- @tangleai/gmpl@0.41.0
  - @tangleai/mas@0.41.0

## 0.40.0

### Patch Changes

- @tangleai/gmpl@0.40.0
  - @tangleai/mas@0.40.0

## 0.39.0

### Patch Changes

- @tangleai/gmpl@0.39.0
  - @tangleai/mas@0.39.0

## 0.38.0

### Patch Changes

- Updated dependencies [e6a6f5c]
- Updated dependencies [802642f]
- Updated dependencies [8a5af48]
  - @tangleai/mas@0.38.0
  - @tangleai/gmpl@0.38.0

## 0.37.0

### Patch Changes

- @tangleai/gmpl@0.37.0
  - @tangleai/mas@0.37.0

## 0.36.0

### Minor Changes

- ac6f698: Ship compiled trading prompts and concurrent evidence-bound analyst lanes with read-only cutoff-scoped tools. Reuse GMPL's reachable-schema projection for domain prompt contracts.
- 43cfab8: Compose resumable native trading decisions and causal backtests through one
  financial path, retain immutable decision receipts, and settle pre-aborted runs
  and recovered terminal segment jobs before exposing financial output.
  Preserve identical loop output provenance across restarts under the next native
  checkpoint identity, and count refusals from the retained provider snapshots.
- eeb6d77: Allow explicitly scoped combined analyst invocations, qualify native workflow
  ablations through the shared financial engine, and publish measured usage,
  execution coverage and the unavailable licensed replay state.
- 2a1f1d0: Add immutable point-in-time trading contracts and atomic simulated portfolio persistence with repeatable decision commits. No external order transport is provided.
- a9255aa: Add immutable fixture and replay providers, independently validated market snapshots, and deterministic baseline signals over native finance indicators. Verify snapshot bar staleness against retained calendar evidence.
- 78b00ba: Compose native bounded research and read-only trader proposals with attributed attempts, retained judgments and immutable artifact citation chains.
- f078031: Compose bounded risk review and fund-manager decisions with retained claim dispositions, causal order admission, and counted hard-policy reductions.
- f4926cf: Add next-open broker simulation, corporate settlement, valuation, hard risk sizing, and a shared chronological strategy loop with retained execution evidence and zero-write replay. Measure all five baselines and independently reproduce the cash and oracle control ledgers.

### Patch Changes

- Updated dependencies [ac6f698]
- Updated dependencies [43cfab8]
  - @tangleai/gmpl@0.36.0
  - @tangleai/mas@0.36.0

Changes are recorded by the coordinated suite release.
