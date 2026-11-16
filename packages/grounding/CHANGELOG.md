# @tangleai/grounding

## 0.50.0

### Patch Changes

- The desktop fits the applications that host it or join it. Hosting: `mountDesktop(node, { compact: { below } })` makes a narrow desktop compact, every window opening maximized and only the focused one shown; at any width the dock stays on screen, its tiles shrinking to fit and then scrolling, every module reachable by pointer and keyboard, and a keyboard user keeps their place when the dock redraws; `tray` decides the mail tile and the light/dark switch and adds a brand mark; `desktop.subscribe` reports every window change with its state, and when a module is `ready` or has `failed`; a shipped module learns from `visible` and `onVisibility` when its window is hidden; a host glyph is documented API. Framed applications: a framed module has `connectTimeoutMs` (15 s by default) to answer, past which its window says so, offers to try again and holds nothing open, and a module whose page reloads connects again on fresh ports. Joining: `connectToOs` takes `connectTimeoutMs` and `signal`, refuses with an `OsConnectError` (`OS0401`, `OS0403`) and leaves no listener behind, refuses a page that is not framed at once (`OS0402`), and keeps the application's own look with `presentation: "none"` or `{ root }`; `GrantedOperation` and `ToolBuilder` are exported. Windows open wholly on the desktop, keep their manifest's minimum size when resized, are labelled regions rather than dialogs, play their opening animation once and stop moving under reduced motion, and their glass survives a minified build. The assistant view opens, closes and toggles from the host, and builds its own Markdown only when the host renders none.
- Build on Jaren 0.212.0, whose assignment engine evaluates what-ifs incrementally, proposes fills and repairs against a baseline, and whose database reads hand-written SQLite triggers back as rules.
- `npm test` runs the release suite; the long-running set (reproducing committed measurements and qualifying crash recovery, about 88% of the recorded test time) runs with `npm run test:long`, and both with `npm run test:all`. CI runs the long-running set as a separate job that never blocks a release, and keeps a verified release artifact for 90 days.
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangleai/models@0.50.0
  - @tangleai/context@0.50.0
  - @tangleai/agents@0.50.0
  - @tangleai/core@0.50.0
  - @tangleai/config@0.50.0
  - @tangleai/mas@0.50.0
  - @tangleai/documents@0.50.0
  - @tangleai/search@0.50.0
  - @tangleai/gmpl@0.50.0

## 0.49.2

### Patch Changes

- Build on Jaren 0.207.0, whose assignment scoring covers one resource on one local civil day through an injected zone.
- Updated dependencies
  - @tangleai/models@0.49.2
  - @tangleai/context@0.49.2
  - @tangleai/agents@0.49.2
  - @tangleai/core@0.49.2
  - @tangleai/config@0.49.2
  - @tangleai/mas@0.49.2
  - @tangleai/documents@0.49.2
  - @tangleai/search@0.49.2
  - @tangleai/gmpl@0.49.2

## 0.49.1

### Patch Changes

- Build on Jaren 0.206.0, whose calendar reads iCalendar back into its model, compiles and embeds zone definitions and edits foreign iCalendar losslessly, and whose core scores assignments exactly.
- Updated dependencies
  - @tangleai/models@0.49.1
  - @tangleai/context@0.49.1
  - @tangleai/agents@0.49.1
  - @tangleai/core@0.49.1
  - @tangleai/config@0.49.1
  - @tangleai/mas@0.49.1
  - @tangleai/documents@0.49.1
  - @tangleai/search@0.49.1
  - @tangleai/gmpl@0.49.1

## 0.49.0

### Patch Changes

- A limit that would never be reached is refused before any call, with `AI0001`: `maxRepairs`, `retry.attempts` and an agent's `maxToolRounds` and `budget.turns` must be whole numbers of at least 0, and `budget.tokens`, `budget.ms` and `budget.cost` finite numbers of at least 0. Before, `maxRepairs: Infinity` repaired without end and a NaN turn budget never stopped a run; `maxRepairs: -1` made no call and returned a failure with no errors. A structured result's `attempts` is the number of calls made.
- Build on Jaren 0.201.2, two patch releases of database, ordering and calendar fixes with fuller type declarations.
- `@tangleai/os` can be used from another repository without a registry. Every release keeps the package tarball, a one-file module side (`connectToOs` with its dependencies inside, for a page on any foundation) and a manifest of their hashes, protocol and Jaren foundation under `releases/os/`, and the desktop site serves the same files under `os/`. The package now depends on Jaren alone. `kernel.operations()` lists what a caller may call as plain data, for an application with its own agent runtime. Migration: `kernel.tools()` builds its tools with the host's tool builder, so pass one when creating the kernel: `createKernel({ tools })` with `import * as tools from "@tangleai/agents/toolbox"`; without one it refuses with `OS0301`.
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangleai/models@0.49.0
  - @tangleai/context@0.49.0
  - @tangleai/agents@0.49.0
  - @tangleai/core@0.49.0
  - @tangleai/config@0.49.0
  - @tangleai/mas@0.49.0
  - @tangleai/documents@0.49.0
  - @tangleai/search@0.49.0
  - @tangleai/gmpl@0.49.0

## 0.48.3

### Patch Changes

- Build on Jaren 0.201.0. Its calendar repeats monthly and yearly by the iCalendar standard, so the desktop Calendar now offers "Every month" and "Every year", and its editor says when a series skips a date that a month or year lacks. The Pages playground is now built on Jaren's play host kit instead of a copy of Jaren's site: a saved or shared session no longer carries a message language and opens in its reader's, and an example made to show one language shows it for its own run.
- Updated dependencies
  - @tangleai/models@0.48.3
  - @tangleai/context@0.48.3
  - @tangleai/agents@0.48.3
  - @tangleai/core@0.48.3
  - @tangleai/config@0.48.3
  - @tangleai/mas@0.48.3
  - @tangleai/documents@0.48.3
  - @tangleai/search@0.48.3
  - @tangleai/gmpl@0.48.3

## 0.48.2

### Patch Changes

- Build on Jaren 0.199.0, whose calendar (`@jarenjs/core/calendar`), iCalendar writer (`@jarenjs/josl/ical`) and calendar-scheduled database jobs arrive in these releases. The Pages desktop gains a Calendar built on them: a month view, a day panel and an editor, recurring events with skipped days, "find a time" over the person's working hours that never offers unknown time, an iCalendar export, and a `calendar` contract (agenda, add, free) that the assistant and other applications use as tools.
- Updated dependencies
  - @tangleai/models@0.48.2
  - @tangleai/context@0.48.2
  - @tangleai/agents@0.48.2
  - @tangleai/core@0.48.2
  - @tangleai/config@0.48.2
  - @tangleai/mas@0.48.2
  - @tangleai/documents@0.48.2
  - @tangleai/search@0.48.2
  - @tangleai/gmpl@0.48.2

## 0.48.1

### Patch Changes

- Build on Jaren 0.193.1. Its `sha256Hex` replaces the nine local SHA-256 helpers, each keeping its name, with identical digests. MAS caches compiled embedded schemas with Jaren's semantic cache, which now remembers the key of a frozen tree: 0.31 µs per lookup against 22.8 µs before. The Studio authoring gate now refuses an element written as an object and names an unknown operator with the nearest known one. The Studio file author sends an open profile in the prompt to an Anthropic model, which refuses an output schema with an open object, so the Pages Studio assistant no longer fails with HTTP 400 on the default model. The assistant's Japanese and Traditional Chinese packs use Jaren's 「…」 permalink wording.
- Updated dependencies
  - @tangleai/models@0.48.1
  - @tangleai/context@0.48.1
  - @tangleai/agents@0.48.1
  - @tangleai/core@0.48.1
  - @tangleai/config@0.48.1
  - @tangleai/mas@0.48.1
  - @tangleai/documents@0.48.1
  - @tangleai/search@0.48.1
  - @tangleai/gmpl@0.48.1

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
