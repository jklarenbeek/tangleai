# @tangleai/experiential

## 0.48.2

### Patch Changes

- Build on Jaren 0.199.0, whose calendar (`@jarenjs/core/calendar`), iCalendar writer (`@jarenjs/josl/ical`) and calendar-scheduled database jobs arrive in these releases. The Pages desktop gains a Calendar built on them: a month view, a day panel and an editor, recurring events with skipped days, "find a time" over the person's working hours that never offers unknown time, an iCalendar export, and a `calendar` contract (agenda, add, free) that the assistant and other applications use as tools.
- Updated dependencies
  - @tangleai/models@0.48.2
  - @tangleai/config@0.48.2
  - @tangleai/documents@0.48.2
  - @tangleai/outcomes@0.48.2

## 0.48.1

### Patch Changes

- Build on Jaren 0.193.1. Its `sha256Hex` replaces the nine local SHA-256 helpers, each keeping its name, with identical digests. MAS caches compiled embedded schemas with Jaren's semantic cache, which now remembers the key of a frozen tree: 0.31 µs per lookup against 22.8 µs before. The Studio authoring gate now refuses an element written as an object and names an unknown operator with the nearest known one. The Studio file author sends an open profile in the prompt to an Anthropic model, which refuses an output schema with an open object, so the Pages Studio assistant no longer fails with HTTP 400 on the default model. The assistant's Japanese and Traditional Chinese packs use Jaren's 「…」 permalink wording.
- Updated dependencies
  - @tangleai/models@0.48.1
  - @tangleai/config@0.48.1
  - @tangleai/documents@0.48.1
  - @tangleai/outcomes@0.48.1

## 0.48.0

### Minor Changes

- Make Tangle OS the Pages site. Studio, Playground, Flow, Data, the adventure, the memory loop and moving browser data are desktop applications now, beside Welcome, the assistant, Settings and the to-do module; the assistant uses the work applications' authoring tools, and a former page link opens its application. `@tangleai/os` adds theme kits (`THEME_KITS`, `composeTheme`): each is one JSON document with light and dark palettes, a procedural wallpaper and a shape, and a person's changes (accent, highlight, pattern, seed, density, glass, corners, spacing) compose into an ordinary theme document that can be exported and imported. Five procedural wallpapers (`PATTERNS`, `patternBackground`: woven threads, contours, a two-ink halftone, a sun print and moiré tides) are drawn deterministically from a seed in the theme's own colours. Windows are laid out above the dock.

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.48.0
  - @tangleai/config@0.48.0
  - @tangleai/documents@0.48.0
  - @tangleai/outcomes@0.48.0

## 0.47.0

### Minor Changes

- Add `@tangleai/os`, a browser operating system for applications built on Jaren and Tangle. A module is a JSON manifest plus the contract operations it serves and needs; the desktop hosts it as a shipped component, as a jaren-app document in a sandboxed opaque-origin frame, or as an application's own page on its own origin that joins with `connectToOs` from `@tangleai/os/module`. The kernel installs modules in shipped, suite and user layers with RFC 6902 patches, keeps a journal with undo and a recovery boot, routes every call between modules as a contract operation under grants into a ledger, carries mail, and lists every granted operation as an assistant tool. The assistant's model placeholder and the documentation now name only the models that write Jaren's JSON documents reliably: `anthropic/claude-haiku-5.5`, and Qwen 3.7 27B or larger. The desktop has context menus on its background, title bars and dock, minimized windows now actually hide, and `mountDesktop` takes `themeFor` and `onSchemeSwitch` so a host's own colours survive the dock's light/dark switch. The Pages desktop ships an Assistant window and a Settings app: provider, OpenRouter key (kept in this browser, optionally for the tab only), region, a model picker over OpenRouter's catalogue, appearance, and forgetting what the browser keeps.

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.47.0
  - @tangleai/config@0.47.0
  - @tangleai/documents@0.47.0
  - @tangleai/outcomes@0.47.0

## 0.46.0

### Patch Changes

- Build on Jaren 0.188.0. Its validator keeps the text a schema's `errorMessage` wrote in every locale, a `$msgid` fallback included, and a validation error's `toJSON` carries that mark; `diffContracts` reports fewer false and more real breaking changes; `@jarenjs/db` reads a PostgreSQL `jsonb` null as SQL NULL and names unguarded number columns in `introspect()`. Every exact `@jarenjs/*` pin moves from 0.184.2 to 0.188.0, and the candidate tarballs are recaptured from the tagged source with an empty patch. Local copies of canonical cloning and RFC 6901 token escaping are replaced by `@jarenjs/json`'s `cloneJson` and pointer helpers, with identical output.
- Updated dependencies
  - @tangleai/config@0.46.0
  - @tangleai/documents@0.46.0
  - @tangleai/models@0.46.0
  - @tangleai/outcomes@0.46.0

## 0.45.2

### Patch Changes

- @tangleai/documents@0.45.2
  - @tangleai/outcomes@0.45.2
  - @tangleai/config@0.45.2
  - @tangleai/models@0.45.2

## 0.45.1

### Patch Changes

- @tangleai/documents@0.45.1
  - @tangleai/outcomes@0.45.1
  - @tangleai/config@0.45.1
  - @tangleai/models@0.45.1

## 0.45.0

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangleai/models@0.45.0
  - @tangleai/documents@0.45.0
  - @tangleai/outcomes@0.45.0
  - @tangleai/config@0.45.0

## 0.44.0

### Patch Changes

- @tangleai/config@0.44.0
  - @tangleai/documents@0.44.0
  - @tangleai/models@0.44.0
  - @tangleai/outcomes@0.44.0

## 0.43.1

### Patch Changes

- @tangleai/config@0.43.1
  - @tangleai/documents@0.43.1
  - @tangleai/models@0.43.1
  - @tangleai/outcomes@0.43.1

## 0.43.0

### Patch Changes

- Updated dependencies
  - @tangleai/documents@0.43.0
  - @tangleai/outcomes@0.43.0
  - @tangleai/config@0.43.0
  - @tangleai/models@0.43.0

## 0.42.1

### Patch Changes

- @tangleai/config@0.42.1
  - @tangleai/documents@0.42.1
  - @tangleai/models@0.42.1
  - @tangleai/outcomes@0.42.1

## 0.42.0

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.42.0
  - @tangleai/documents@0.42.0
  - @tangleai/outcomes@0.42.0
  - @tangleai/config@0.42.0

## 0.41.0

### Patch Changes

- @tangleai/config@0.41.0
  - @tangleai/documents@0.41.0
  - @tangleai/models@0.41.0
  - @tangleai/outcomes@0.41.0

## 0.40.0

### Minor Changes

- dcfaf59: Add disabled-by-default host ticks with durable cadence and budget reservations,
  stale-parent cancellation or rebasing, and counted replay and no-op outcomes.
  Retain episode lineage through atomic archival with dependency, rollback-window,
  hold and sole-provenance checks. Include a keyless native SQLite tick walkthrough.
- 5d6ee92: Add a closed HTTP training service contract, bounded idempotent backend adapter,
  verified artifact downloads and credential-free training configuration.
- 4259b10: Add closed experiential record contracts with credential-free, synchronous validation.
- c092814: Run bounded training through durable native DAG jobs, preserve uncertain submissions and consumed poll credits across restarts, and atomically stage independently verified artifacts.
- 4259b10: Add content-addressed experiential lineage, checked lifecycle plans and atomic memory and SQLite persistence with replay and native deployment-head comparison.
- 4ce4158: Expose eight native read-only operations over atomic experiential snapshots,
  with schema-derived redacted views, retained log digests and pure retention
  previews. Publish the registered scientific claim as not-run beside a real
  scripted rollback receipt, and qualify installed Node, Bun and browser APIs.
  Preserve native persistence refusal codes through inspection, lineage, inference
  startup, artifact byte reads, policy revision and scheduling without exposing raw
  diagnostics or nesting causes outside the closed issue schema.
- a8765d5: Bind serving deployments to approved evaluations, deterministic canaries, immutable run pins and atomic rollback. Register the resolved base role before serving; deployment approvals now bind the deployment revision and canary fraction, and new pins use the checked pin command. Export the existing native head assertion so read-time fences use the same comparison as transitions.
- 460156f: Register immutable evaluation inputs before measuring a candidate and enforce
  recorded learning, retention, security and operational gates in atomic state
  transitions. Publish reproducible scripted candidate losses and refusals without
  claiming training quality or activation.

  Evaluation records now require the complete registration and measurement
  bindings. Generic writes no longer grant evaluation or artifact transition
  authority; callers use `startEvaluation` and `recordEvaluation` with retained
  policies, datasets and artifact receipts.
- 1beddfc: Restore an experiential deployment to its exact registered base under explicit rollback authority. Bind the base role digest, fence both revisions, retain an incremented null learned head, and atomically archive failed routing with its audit. Preserve learned evaluations and in-flight pins across rollback, reopen and later activation; keep learned-target approval gates unchanged.
- 8d246e0: Add independent evidence-bound selection, retained duplicate and episode grouping, deterministic dataset partitions and pinned JTLT example rendering. Recheck selection authority and leakage at dataset admission.
- c092814: Define the injected training backend and verify artifact bytes, submission ancestry and configured runtime before registration.

### Patch Changes

- Updated dependencies [a8765d5]
- Updated dependencies [1beddfc]
  - @tangleai/outcomes@0.40.0
  - @tangleai/config@0.40.0
  - @tangleai/documents@0.40.0
  - @tangleai/models@0.40.0
