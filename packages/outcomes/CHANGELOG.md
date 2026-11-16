# @tangleai/outcomes

## 0.49.1

### Patch Changes

- Build on Jaren 0.206.0, whose calendar reads iCalendar back into its model, compiles and embeds zone definitions and edits foreign iCalendar losslessly, and whose core scores assignments exactly.
- Updated dependencies
  - @tangleai/models@0.49.1
  - @tangleai/agents@0.49.1
  - @tangleai/core@0.49.1
  - @tangleai/config@0.49.1
  - @tangleai/memory@0.49.1

## 0.49.0

### Patch Changes

- A limit that would never be reached is refused before any call, with `AI0001`: `maxRepairs`, `retry.attempts` and an agent's `maxToolRounds` and `budget.turns` must be whole numbers of at least 0, and `budget.tokens`, `budget.ms` and `budget.cost` finite numbers of at least 0. Before, `maxRepairs: Infinity` repaired without end and a NaN turn budget never stopped a run; `maxRepairs: -1` made no call and returned a failure with no errors. A structured result's `attempts` is the number of calls made.
- Build on Jaren 0.201.2, two patch releases of database, ordering and calendar fixes with fuller type declarations.
- `@tangleai/os` can be used from another repository without a registry. Every release keeps the package tarball, a one-file module side (`connectToOs` with its dependencies inside, for a page on any foundation) and a manifest of their hashes, protocol and Jaren foundation under `releases/os/`, and the desktop site serves the same files under `os/`. The package now depends on Jaren alone. `kernel.operations()` lists what a caller may call as plain data, for an application with its own agent runtime. Migration: `kernel.tools()` builds its tools with the host's tool builder, so pass one when creating the kernel: `createKernel({ tools })` with `import * as tools from "@tangleai/agents/toolbox"`; without one it refuses with `OS0301`.
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangleai/models@0.49.0
  - @tangleai/agents@0.49.0
  - @tangleai/core@0.49.0
  - @tangleai/config@0.49.0
  - @tangleai/memory@0.49.0

## 0.48.3

### Patch Changes

- Build on Jaren 0.201.0. Its calendar repeats monthly and yearly by the iCalendar standard, so the desktop Calendar now offers "Every month" and "Every year", and its editor says when a series skips a date that a month or year lacks. The Pages playground is now built on Jaren's play host kit instead of a copy of Jaren's site: a saved or shared session no longer carries a message language and opens in its reader's, and an example made to show one language shows it for its own run.
- Updated dependencies
  - @tangleai/models@0.48.3
  - @tangleai/agents@0.48.3
  - @tangleai/core@0.48.3
  - @tangleai/config@0.48.3
  - @tangleai/memory@0.48.3

## 0.48.2

### Patch Changes

- Build on Jaren 0.199.0, whose calendar (`@jarenjs/core/calendar`), iCalendar writer (`@jarenjs/josl/ical`) and calendar-scheduled database jobs arrive in these releases. The Pages desktop gains a Calendar built on them: a month view, a day panel and an editor, recurring events with skipped days, "find a time" over the person's working hours that never offers unknown time, an iCalendar export, and a `calendar` contract (agenda, add, free) that the assistant and other applications use as tools.
- Updated dependencies
  - @tangleai/models@0.48.2
  - @tangleai/agents@0.48.2
  - @tangleai/core@0.48.2
  - @tangleai/config@0.48.2
  - @tangleai/memory@0.48.2

## 0.48.1

### Patch Changes

- Build on Jaren 0.193.1. Its `sha256Hex` replaces the nine local SHA-256 helpers, each keeping its name, with identical digests. MAS caches compiled embedded schemas with Jaren's semantic cache, which now remembers the key of a frozen tree: 0.31 µs per lookup against 22.8 µs before. The Studio authoring gate now refuses an element written as an object and names an unknown operator with the nearest known one. The Studio file author sends an open profile in the prompt to an Anthropic model, which refuses an output schema with an open object, so the Pages Studio assistant no longer fails with HTTP 400 on the default model. The assistant's Japanese and Traditional Chinese packs use Jaren's 「…」 permalink wording.
- Updated dependencies
  - @tangleai/models@0.48.1
  - @tangleai/agents@0.48.1
  - @tangleai/core@0.48.1
  - @tangleai/config@0.48.1
  - @tangleai/memory@0.48.1

## 0.48.0

### Minor Changes

- Make Tangle OS the Pages site. Studio, Playground, Flow, Data, the adventure, the memory loop and moving browser data are desktop applications now, beside Welcome, the assistant, Settings and the to-do module; the assistant uses the work applications' authoring tools, and a former page link opens its application. `@tangleai/os` adds theme kits (`THEME_KITS`, `composeTheme`): each is one JSON document with light and dark palettes, a procedural wallpaper and a shape, and a person's changes (accent, highlight, pattern, seed, density, glass, corners, spacing) compose into an ordinary theme document that can be exported and imported. Five procedural wallpapers (`PATTERNS`, `patternBackground`: woven threads, contours, a two-ink halftone, a sun print and moiré tides) are drawn deterministically from a seed in the theme's own colours. Windows are laid out above the dock.

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.48.0
  - @tangleai/agents@0.48.0
  - @tangleai/core@0.48.0
  - @tangleai/config@0.48.0
  - @tangleai/memory@0.48.0

## 0.47.0

### Minor Changes

- Add `@tangleai/os`, a browser operating system for applications built on Jaren and Tangle. A module is a JSON manifest plus the contract operations it serves and needs; the desktop hosts it as a shipped component, as a jaren-app document in a sandboxed opaque-origin frame, or as an application's own page on its own origin that joins with `connectToOs` from `@tangleai/os/module`. The kernel installs modules in shipped, suite and user layers with RFC 6902 patches, keeps a journal with undo and a recovery boot, routes every call between modules as a contract operation under grants into a ledger, carries mail, and lists every granted operation as an assistant tool. The assistant's model placeholder and the documentation now name only the models that write Jaren's JSON documents reliably: `anthropic/claude-haiku-5.5`, and Qwen 3.7 27B or larger. The desktop has context menus on its background, title bars and dock, minimized windows now actually hide, and `mountDesktop` takes `themeFor` and `onSchemeSwitch` so a host's own colours survive the dock's light/dark switch. The Pages desktop ships an Assistant window and a Settings app: provider, OpenRouter key (kept in this browser, optionally for the tab only), region, a model picker over OpenRouter's catalogue, appearance, and forgetting what the browser keeps.

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.47.0
  - @tangleai/agents@0.47.0
  - @tangleai/core@0.47.0
  - @tangleai/config@0.47.0
  - @tangleai/memory@0.47.0

## 0.46.0

### Patch Changes

- Build on Jaren 0.188.0. Its validator keeps the text a schema's `errorMessage` wrote in every locale, a `$msgid` fallback included, and a validation error's `toJSON` carries that mark; `diffContracts` reports fewer false and more real breaking changes; `@jarenjs/db` reads a PostgreSQL `jsonb` null as SQL NULL and names unguarded number columns in `introspect()`. Every exact `@jarenjs/*` pin moves from 0.184.2 to 0.188.0, and the candidate tarballs are recaptured from the tagged source with an empty patch. Local copies of canonical cloning and RFC 6901 token escaping are replaced by `@jarenjs/json`'s `cloneJson` and pointer helpers, with identical output.
- Updated dependencies
  - @tangleai/agents@0.46.0
  - @tangleai/config@0.46.0
  - @tangleai/core@0.46.0
  - @tangleai/memory@0.46.0
  - @tangleai/models@0.46.0

## 0.45.2

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.45.2
  - @tangleai/memory@0.45.2
  - @tangleai/agents@0.45.2
  - @tangleai/config@0.45.2
  - @tangleai/models@0.45.2

## 0.45.1

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.45.1
  - @tangleai/memory@0.45.1
  - @tangleai/agents@0.45.1
  - @tangleai/config@0.45.1
  - @tangleai/models@0.45.1

## 0.45.0

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangleai/agents@0.45.0
  - @tangleai/models@0.45.0
  - @tangleai/core@0.45.0
  - @tangleai/config@0.45.0
  - @tangleai/memory@0.45.0

## 0.44.0

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.44.0
  - @tangleai/agents@0.44.0
  - @tangleai/config@0.44.0
  - @tangleai/memory@0.44.0
  - @tangleai/models@0.44.0

## 0.43.1

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.43.1
  - @tangleai/agents@0.43.1
  - @tangleai/config@0.43.1
  - @tangleai/memory@0.43.1
  - @tangleai/models@0.43.1

## 0.43.0

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.43.0
  - @tangleai/memory@0.43.0
  - @tangleai/agents@0.43.0
  - @tangleai/config@0.43.0
  - @tangleai/models@0.43.0

## 0.42.1

### Patch Changes

- @tangleai/agents@0.42.1
  - @tangleai/config@0.42.1
  - @tangleai/core@0.42.1
  - @tangleai/memory@0.42.1
  - @tangleai/models@0.42.1

## 0.42.0

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.42.0
  - @tangleai/agents@0.42.0
  - @tangleai/memory@0.42.0
  - @tangleai/config@0.42.0
  - @tangleai/core@0.42.0

## 0.41.0

### Patch Changes

- @tangleai/agents@0.41.0
  - @tangleai/config@0.41.0
  - @tangleai/core@0.41.0
  - @tangleai/memory@0.41.0
  - @tangleai/models@0.41.0

## 0.40.0

### Minor Changes

- a8765d5: Bind serving deployments to approved evaluations, deterministic canaries, immutable run pins and atomic rollback. Register the resolved base role before serving; deployment approvals now bind the deployment revision and canary fraction, and new pins use the checked pin command. Export the existing native head assertion so read-time fences use the same comparison as transitions.
- 1beddfc: Restore an experiential deployment to its exact registered base under explicit rollback authority. Bind the base role digest, fence both revisions, retain an incremented null learned head, and atomically archive failed routing with its audit. Preserve learned evaluations and in-flight pins across rollback, reopen and later activation; keep learned-target approval gates unchanged.

### Patch Changes

- @tangleai/agents@0.40.0
  - @tangleai/config@0.40.0
  - @tangleai/core@0.40.0
  - @tangleai/memory@0.40.0
  - @tangleai/models@0.40.0

## 0.39.0

### Patch Changes

- @tangleai/agents@0.39.0
  - @tangleai/config@0.39.0
  - @tangleai/core@0.39.0
  - @tangleai/memory@0.39.0
  - @tangleai/models@0.39.0

## 0.38.0

### Patch Changes

- Updated dependencies [e229e63]
  - @tangleai/core@0.38.0
  - @tangleai/memory@0.38.0
  - @tangleai/agents@0.38.0
  - @tangleai/config@0.38.0
  - @tangleai/models@0.38.0

## 0.37.0

### Patch Changes

- Updated dependencies [364b336]
  - @tangleai/core@0.37.0
  - @tangleai/memory@0.37.0
  - @tangleai/agents@0.37.0
  - @tangleai/config@0.37.0
  - @tangleai/models@0.37.0

## 0.36.0

### Patch Changes

- @tangleai/agents@0.36.0
  - @tangleai/config@0.36.0
  - @tangleai/core@0.36.0
  - @tangleai/memory@0.36.0
  - @tangleai/models@0.36.0

## 0.35.0

### Patch Changes

- @tangleai/agents@0.35.0
  - @tangleai/config@0.35.0
  - @tangleai/core@0.35.0
  - @tangleai/memory@0.35.0
  - @tangleai/models@0.35.0

## 0.34.0

### Patch Changes

- Updated dependencies [2dce4bd]
- Updated dependencies [a542379]
  - @tangleai/core@0.34.0
  - @tangleai/memory@0.34.0
  - @tangleai/agents@0.34.0
  - @tangleai/config@0.34.0
  - @tangleai/models@0.34.0

## 0.33.0

### Minor Changes

- 2d64db7: Score forecast decisions from retained resolution evidence, retain bounded retrospective purchases, and promote reusable harnesses only after independent paired evaluation. Resume both forecasting workflows without duplicating committed work. Support pure asynchronous outcome interpreters for canonical artifact lookup.

### Patch Changes

- Updated dependencies [236b915]
  - @tangleai/models@0.33.0
  - @tangleai/agents@0.33.0
  - @tangleai/memory@0.33.0
  - @tangleai/config@0.33.0
  - @tangleai/core@0.33.0

## 0.32.0

### Patch Changes

- @tangleai/agents@0.32.0
  - @tangleai/config@0.32.0
  - @tangleai/core@0.32.0
  - @tangleai/memory@0.32.0
  - @tangleai/models@0.32.0

## 0.31.0

### Patch Changes

- @tangleai/agents@0.31.0
  - @tangleai/config@0.31.0
  - @tangleai/core@0.31.0
  - @tangleai/memory@0.31.0
  - @tangleai/models@0.31.0

## 0.30.1

### Patch Changes

- @tangleai/agents@0.30.1
  - @tangleai/config@0.30.1
  - @tangleai/core@0.30.1
  - @tangleai/memory@0.30.1
  - @tangleai/models@0.30.1

## 0.30.0

### Patch Changes

- Updated dependencies
  - @tangleai/memory@0.30.0
  - @tangleai/agents@0.30.0
  - @tangleai/config@0.30.0
  - @tangleai/core@0.30.0
  - @tangleai/models@0.30.0

## 0.29.8

### Patch Changes

- @tangleai/agents@0.29.8
  - @tangleai/config@0.29.8
  - @tangleai/core@0.29.8
  - @tangleai/memory@0.29.8
  - @tangleai/models@0.29.8

## 0.29.7

### Patch Changes

- @tangleai/agents@0.29.7
  - @tangleai/config@0.29.7
  - @tangleai/core@0.29.7
  - @tangleai/memory@0.29.7
  - @tangleai/models@0.29.7

## 0.29.6

### Patch Changes

- @tangleai/agents@0.29.6
  - @tangleai/config@0.29.6
  - @tangleai/core@0.29.6
  - @tangleai/memory@0.29.6
  - @tangleai/models@0.29.6

## 0.29.5

### Patch Changes

- @tangleai/agents@0.29.5
  - @tangleai/config@0.29.5
  - @tangleai/core@0.29.5
  - @tangleai/memory@0.29.5
  - @tangleai/models@0.29.5

## 0.29.4

### Patch Changes

- @tangleai/agents@0.29.4
  - @tangleai/config@0.29.4
  - @tangleai/core@0.29.4
  - @tangleai/memory@0.29.4
  - @tangleai/models@0.29.4

## 0.29.3

### Patch Changes

- @tangleai/agents@0.29.3
  - @tangleai/config@0.29.3
  - @tangleai/core@0.29.3
  - @tangleai/memory@0.29.3
  - @tangleai/models@0.29.3

## 0.29.2

### Patch Changes

- @tangleai/agents@0.29.2
  - @tangleai/config@0.29.2
  - @tangleai/core@0.29.2
  - @tangleai/memory@0.29.2
  - @tangleai/models@0.29.2

## 0.29.1

### Patch Changes

- @tangleai/agents@0.29.1
  - @tangleai/config@0.29.1
  - @tangleai/core@0.29.1
  - @tangleai/memory@0.29.1
  - @tangleai/models@0.29.1

## 0.29.0

### Patch Changes

- @tangleai/agents@0.29.0
  - @tangleai/config@0.29.0
  - @tangleai/core@0.29.0
  - @tangleai/memory@0.29.0
  - @tangleai/models@0.29.0

## 0.28.0

### Minor Changes

- f2eb14d: Publish the adapter-construction kit a host needs to register its own outcome domain: `adapterIdentity` builds the pinned schema-and-scorer identity the service re-hashes at registration, `domainValidator` compiles one domain schema into the validator that boundary uses, and `checkedAdapter` composes an adapter's four validators with its payload check. They were already the recipe every in-tree adapter follows; an out-of-tree host previously had to reimplement the identity hash to be accepted, and a reimplementation that drifted by one byte was refused as an unregistered revision rather than as the mistake it was.

### Patch Changes

- @tangleai/agents@0.28.0
  - @tangleai/config@0.28.0
  - @tangleai/core@0.28.0
  - @tangleai/memory@0.28.0
  - @tangleai/models@0.28.0

## 0.27.3

### Patch Changes

- Updated dependencies [9f7d8c8]
  - @tangleai/core@0.27.3
  - @tangleai/agents@0.27.3
  - @tangleai/config@0.27.3
  - @tangleai/memory@0.27.3
  - @tangleai/models@0.27.3

## 0.27.2

### Patch Changes

- @tangleai/agents@0.27.2
  - @tangleai/config@0.27.2
  - @tangleai/core@0.27.2
  - @tangleai/memory@0.27.2
  - @tangleai/models@0.27.2

## 0.27.1

### Patch Changes

- Updated dependencies [422afcd]
  - @tangleai/memory@0.27.1
  - @tangleai/agents@0.27.1
  - @tangleai/config@0.27.1
  - @tangleai/core@0.27.1
  - @tangleai/models@0.27.1

## 0.27.0

### Patch Changes

- Updated dependencies [84fe0a2]
- Updated dependencies [6dcfde9]
- Updated dependencies [a6fa7f3]
- Updated dependencies [d4d8d0b]
- Updated dependencies [63504f3]
- Updated dependencies [7f2e26f]
  - @tangleai/memory@0.27.0
  - @tangleai/core@0.27.0
  - @tangleai/agents@0.27.0
  - @tangleai/config@0.27.0
  - @tangleai/models@0.27.0

## 0.26.3

### Patch Changes

- 36b6a1d: Qualify concurrent outcome promotions without assuming which request wins, and replay the actual winning receipt while retaining every stale-head assertion.
- Updated dependencies [9cc91c1]
  - @tangleai/memory@0.26.3
  - @tangleai/agents@0.26.3
  - @tangleai/config@0.26.3
  - @tangleai/core@0.26.3
  - @tangleai/models@0.26.3

## 0.26.2

### Patch Changes

- Updated dependencies [4c42ba1]
  - @tangleai/memory@0.26.2
  - @tangleai/agents@0.26.2
  - @tangleai/config@0.26.2
  - @tangleai/core@0.26.2
  - @tangleai/models@0.26.2

## 0.26.1

### Patch Changes

- @tangleai/agents@0.26.1
  - @tangleai/config@0.26.1
  - @tangleai/core@0.26.1
  - @tangleai/memory@0.26.1
  - @tangleai/models@0.26.1

## 0.26.0

### Patch Changes

- Updated dependencies [6e0f5be]
  - @tangleai/core@0.26.0
  - @tangleai/memory@0.26.0
  - @tangleai/agents@0.26.0
  - @tangleai/config@0.26.0
  - @tangleai/models@0.26.0

## 0.25.1

### Patch Changes

- Consume the exact Jaren 0.87.0 registry packages and source pin. Qualify native SQLite schema changes, column references, JSON type inspection and per-call mutation semantics alongside Tangle records across Node, Bun and installed consumers. Preserve the existing document storage model and historical paid measurements.
- Updated dependencies
  - @tangleai/models@0.25.1
  - @tangleai/agents@0.25.1
  - @tangleai/core@0.25.1
  - @tangleai/config@0.25.1
  - @tangleai/memory@0.25.1

## 0.25.0

### Patch Changes

- @tangleai/agents@0.25.0
  - @tangleai/config@0.25.0
  - @tangleai/core@0.25.0
  - @tangleai/memory@0.25.0
  - @tangleai/models@0.25.0

## 0.24.1

### Patch Changes

- @tangleai/agents@0.24.1
  - @tangleai/config@0.24.1
  - @tangleai/core@0.24.1
  - @tangleai/memory@0.24.1
  - @tangleai/models@0.24.1

## 0.24.0

### Minor Changes

- Add the outcomes package for independently evidenced decisions, deterministic scoring, atomic confidence projection, bounded artifact refinement and explicitly approved promotion and rollback. The public operation contract, two-domain adapter kit and keyless example share the same scoped request receipts, one-use held-out gates, full head revision checks and interruption recovery.

  The store adapter owns outcome records and memory changes in one SQLite transaction. The new pure confidence helper preserves fact fields; existing applyOutcome calls retain their original duplicate-citation and timestamp behavior and do not acquire a durable replay guarantee. No existing persisted memory format changes. Hosts opt into the new lifecycle, provide evidence and approval authority, and use a new artifact key for schema or policy changes. Scripted paired measurements and Node/Bun packed consumers qualify the mechanism; downstream domain integrations and automatic promotion remain separate work.

### Patch Changes

- Updated dependencies
  - @tangleai/memory@0.24.0
  - @tangleai/agents@0.24.0
  - @tangleai/config@0.24.0
  - @tangleai/core@0.24.0
  - @tangleai/models@0.24.0
