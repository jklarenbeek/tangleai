# @tangleai/documents

## 0.51.3

### Patch Changes

- Build on Jaren 0.215.0, which compares a caller-written numeric key exactly on PostgreSQL.
- Updated dependencies
  - @tangleai/models@0.51.3
  - @tangleai/context@0.51.3
  - @tangleai/core@0.51.3

## 0.51.2

### Patch Changes

- Build on Jaren 0.214.0, which exports its host tokens as light and dark stylesheets and lets its component stylesheets follow the host's dark selection.
- Updated dependencies
  - @tangleai/models@0.51.2
  - @tangleai/context@0.51.2
  - @tangleai/core@0.51.2

## 0.51.1

### Patch Changes

- Build on Jaren 0.213.0, which renders an untrusted app document with its data bindings and granted widgets without a frame.
- Updated dependencies
  - @tangleai/models@0.51.1
  - @tangleai/context@0.51.1
  - @tangleai/core@0.51.1

## 0.51.0

### Patch Changes

- The desktop has one Settings for every application. `@tangleai/os/settings` is a Settings module a host installs with its own sections first and then one per application whose manifest declares `settings`: `mount` (a shipped module's own settings screen), `page` (an origin application's settings page, framed from its own origin and given no contract ports) or `form` (a document module's JSON Schema, whose values the desktop keeps through `createKernel({ settings })`, checked against the schema and never a secret). Applications keep their own values; the desktop is where the person finds them, with a search, from the window and dock menus, and from the application itself (`openSettings()` over its own port, no grant needed). The Pages desktop's Settings is this module, and the Calendar's working hours are a section of it.
- Updated dependencies
  - @tangleai/models@0.51.0
  - @tangleai/context@0.51.0
  - @tangleai/core@0.51.0

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
  - @tangleai/core@0.50.0

## 0.49.2

### Patch Changes

- Build on Jaren 0.207.0, whose assignment scoring covers one resource on one local civil day through an injected zone.
- Updated dependencies
  - @tangleai/models@0.49.2
  - @tangleai/context@0.49.2
  - @tangleai/core@0.49.2

## 0.49.1

### Patch Changes

- Build on Jaren 0.206.0, whose calendar reads iCalendar back into its model, compiles and embeds zone definitions and edits foreign iCalendar losslessly, and whose core scores assignments exactly.
- Updated dependencies
  - @tangleai/models@0.49.1
  - @tangleai/context@0.49.1
  - @tangleai/core@0.49.1

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
  - @tangleai/core@0.49.0

## 0.48.3

### Patch Changes

- Build on Jaren 0.201.0. Its calendar repeats monthly and yearly by the iCalendar standard, so the desktop Calendar now offers "Every month" and "Every year", and its editor says when a series skips a date that a month or year lacks. The Pages playground is now built on Jaren's play host kit instead of a copy of Jaren's site: a saved or shared session no longer carries a message language and opens in its reader's, and an example made to show one language shows it for its own run.
- Updated dependencies
  - @tangleai/models@0.48.3
  - @tangleai/context@0.48.3
  - @tangleai/core@0.48.3

## 0.48.2

### Patch Changes

- Build on Jaren 0.199.0, whose calendar (`@jarenjs/core/calendar`), iCalendar writer (`@jarenjs/josl/ical`) and calendar-scheduled database jobs arrive in these releases. The Pages desktop gains a Calendar built on them: a month view, a day panel and an editor, recurring events with skipped days, "find a time" over the person's working hours that never offers unknown time, an iCalendar export, and a `calendar` contract (agenda, add, free) that the assistant and other applications use as tools.
- Updated dependencies
  - @tangleai/models@0.48.2
  - @tangleai/context@0.48.2
  - @tangleai/core@0.48.2

## 0.48.1

### Patch Changes

- Build on Jaren 0.193.1. Its `sha256Hex` replaces the nine local SHA-256 helpers, each keeping its name, with identical digests. MAS caches compiled embedded schemas with Jaren's semantic cache, which now remembers the key of a frozen tree: 0.31 µs per lookup against 22.8 µs before. The Studio authoring gate now refuses an element written as an object and names an unknown operator with the nearest known one. The Studio file author sends an open profile in the prompt to an Anthropic model, which refuses an output schema with an open object, so the Pages Studio assistant no longer fails with HTTP 400 on the default model. The assistant's Japanese and Traditional Chinese packs use Jaren's 「…」 permalink wording.
- Updated dependencies
  - @tangleai/models@0.48.1
  - @tangleai/context@0.48.1
  - @tangleai/core@0.48.1

## 0.48.0

### Minor Changes

- Make Tangle OS the Pages site. Studio, Playground, Flow, Data, the adventure, the memory loop and moving browser data are desktop applications now, beside Welcome, the assistant, Settings and the to-do module; the assistant uses the work applications' authoring tools, and a former page link opens its application. `@tangleai/os` adds theme kits (`THEME_KITS`, `composeTheme`): each is one JSON document with light and dark palettes, a procedural wallpaper and a shape, and a person's changes (accent, highlight, pattern, seed, density, glass, corners, spacing) compose into an ordinary theme document that can be exported and imported. Five procedural wallpapers (`PATTERNS`, `patternBackground`: woven threads, contours, a two-ink halftone, a sun print and moiré tides) are drawn deterministically from a seed in the theme's own colours. Windows are laid out above the dock.

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.48.0
  - @tangleai/context@0.48.0
  - @tangleai/core@0.48.0

## 0.47.0

### Minor Changes

- Add `@tangleai/os`, a browser operating system for applications built on Jaren and Tangle. A module is a JSON manifest plus the contract operations it serves and needs; the desktop hosts it as a shipped component, as a jaren-app document in a sandboxed opaque-origin frame, or as an application's own page on its own origin that joins with `connectToOs` from `@tangleai/os/module`. The kernel installs modules in shipped, suite and user layers with RFC 6902 patches, keeps a journal with undo and a recovery boot, routes every call between modules as a contract operation under grants into a ledger, carries mail, and lists every granted operation as an assistant tool. The assistant's model placeholder and the documentation now name only the models that write Jaren's JSON documents reliably: `anthropic/claude-haiku-5.5`, and Qwen 3.7 27B or larger. The desktop has context menus on its background, title bars and dock, minimized windows now actually hide, and `mountDesktop` takes `themeFor` and `onSchemeSwitch` so a host's own colours survive the dock's light/dark switch. The Pages desktop ships an Assistant window and a Settings app: provider, OpenRouter key (kept in this browser, optionally for the tab only), region, a model picker over OpenRouter's catalogue, appearance, and forgetting what the browser keeps.

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.47.0
  - @tangleai/context@0.47.0
  - @tangleai/core@0.47.0

## 0.46.0

### Patch Changes

- Build on Jaren 0.188.0. Its validator keeps the text a schema's `errorMessage` wrote in every locale, a `$msgid` fallback included, and a validation error's `toJSON` carries that mark; `diffContracts` reports fewer false and more real breaking changes; `@jarenjs/db` reads a PostgreSQL `jsonb` null as SQL NULL and names unguarded number columns in `introspect()`. Every exact `@jarenjs/*` pin moves from 0.184.2 to 0.188.0, and the candidate tarballs are recaptured from the tagged source with an empty patch. Local copies of canonical cloning and RFC 6901 token escaping are replaced by `@jarenjs/json`'s `cloneJson` and pointer helpers, with identical output.
- Updated dependencies
  - @tangleai/context@0.46.0
  - @tangleai/core@0.46.0
  - @tangleai/models@0.46.0

## 0.45.2

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.45.2
  - @tangleai/context@0.45.2
  - @tangleai/models@0.45.2

## 0.45.1

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.45.1
  - @tangleai/context@0.45.1
  - @tangleai/models@0.45.1

## 0.45.0

### Minor Changes

- Report scanned PDFs and let a host read them. A PDF whose pages carry no text answers its empty elements with an `image-only` warning. An `ocr: { version, read }` hook on `extractPdf`, `extractDocument` and `createDocumentIngester` reads each page without text through the host's own OCR (`read({ page, width, height, pdf })` answers the page's text or `{ text, bbox? }` lines), whose text becomes elements in page order beside an `ocr` warning; the hook's `version` enters the ingester's extraction identity, so a document read with and without OCR never shares a version.

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangleai/context@0.45.0
  - @tangleai/models@0.45.0
  - @tangleai/core@0.45.0

## 0.44.0

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.44.0
  - @tangleai/context@0.44.0
  - @tangleai/models@0.44.0

## 0.43.1

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.43.1
  - @tangleai/context@0.43.1
  - @tangleai/models@0.43.1

## 0.43.0

### Patch Changes

- Upgrade the Bun toolchain to 1.4.4 in the pins, workspace engines, CI setup and the scraper's container runtime.
- Updated dependencies
  - @tangleai/core@0.43.0
  - @tangleai/context@0.43.0
  - @tangleai/models@0.43.0

## 0.42.1

### Patch Changes

- @tangleai/context@0.42.1
  - @tangleai/core@0.42.1
  - @tangleai/models@0.42.1

## 0.42.0

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.42.0
  - @tangleai/context@0.42.0
  - @tangleai/core@0.42.0

## 0.41.0

### Patch Changes

- @tangleai/context@0.41.0
  - @tangleai/core@0.41.0
  - @tangleai/models@0.41.0

## 0.40.0

### Patch Changes

- @tangleai/context@0.40.0
  - @tangleai/core@0.40.0
  - @tangleai/models@0.40.0

## 0.39.0

### Patch Changes

- @tangleai/context@0.39.0
  - @tangleai/core@0.39.0
  - @tangleai/models@0.39.0

## 0.38.0

### Patch Changes

- dc083d7: Add native-provider scholarly discovery with durable query plans, exact offline replay, explicit screening and immutable source evidence cards. Retain failed and partial request observations without admitting incomplete literature. Allow bounded document response readers to cancel pending reads through an injected signal.
- Updated dependencies [e229e63]
  - @tangleai/core@0.38.0
  - @tangleai/context@0.38.0
  - @tangleai/models@0.38.0

## 0.37.0

### Patch Changes

- Updated dependencies [364b336]
  - @tangleai/core@0.37.0
  - @tangleai/context@0.37.0
  - @tangleai/models@0.37.0

## 0.36.0

### Patch Changes

- @tangleai/context@0.36.0
  - @tangleai/core@0.36.0
  - @tangleai/models@0.36.0

## 0.35.0

### Minor Changes

- 44c24f8: Prepare document and graph evidence outside storage, then activate both under one checked source fence and atomic transaction. Preserve identity across incremental replacement, retract obsolete support, reuse retained contributions without new model or embedding calls, and collect only explicitly unreferenced historical document evidence. Ordinary document updates to indexed sources now require joint promotion; use createCorpusPromotion to preserve document and graph consistency.
- 9529ecd: Share the grounded answer contract and generate auditable graph answers with exact supplied citations, metered repair and named recall fallbacks. Expose experimental desktop graph inspection through two read operations and exercise both graph stores in the keyless consumer.

### Patch Changes

- @tangleai/context@0.35.0
  - @tangleai/core@0.35.0
  - @tangleai/models@0.35.0

## 0.34.0

### Patch Changes

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
- Updated dependencies [2dce4bd]
- Updated dependencies [a542379]
  - @tangleai/core@0.34.0
  - @tangleai/context@0.34.0
  - @tangleai/models@0.34.0

## 0.33.0

### Patch Changes

- Updated dependencies [236b915]
  - @tangleai/models@0.33.0
  - @tangleai/context@0.33.0
  - @tangleai/core@0.33.0

## 0.32.0

### Patch Changes

- @tangleai/context@0.32.0
  - @tangleai/core@0.32.0
  - @tangleai/models@0.32.0

## 0.31.0

### Patch Changes

- d6bc2fd: Upgrade the Bun toolchain to 1.4.2 and allow documentation-only branch pushes
  without a version bump while retaining source checks, Pages builds and the full
  release gate for package, source, configuration and toolchain changes.
- @tangleai/context@0.31.0
  - @tangleai/core@0.31.0
  - @tangleai/models@0.31.0

## 0.30.1

### Patch Changes

- @tangleai/context@0.30.1
  - @tangleai/core@0.30.1
  - @tangleai/models@0.30.1

## 0.30.0

### Patch Changes

- @tangleai/context@0.30.0
  - @tangleai/core@0.30.0
  - @tangleai/models@0.30.0

## 0.29.8

### Patch Changes

- @tangleai/context@0.29.8
  - @tangleai/core@0.29.8
  - @tangleai/models@0.29.8

## 0.29.7

### Patch Changes

- @tangleai/context@0.29.7
  - @tangleai/core@0.29.7
  - @tangleai/models@0.29.7

## 0.29.6

### Patch Changes

- @tangleai/context@0.29.6
  - @tangleai/core@0.29.6
  - @tangleai/models@0.29.6

## 0.29.5

### Patch Changes

- @tangleai/context@0.29.5
  - @tangleai/core@0.29.5
  - @tangleai/models@0.29.5

## 0.29.4

### Patch Changes

- @tangleai/context@0.29.4
  - @tangleai/core@0.29.4
  - @tangleai/models@0.29.4

## 0.29.3

### Patch Changes

- @tangleai/context@0.29.3
  - @tangleai/core@0.29.3
  - @tangleai/models@0.29.3

## 0.29.2

### Patch Changes

- @tangleai/context@0.29.2
  - @tangleai/core@0.29.2
  - @tangleai/models@0.29.2

## 0.29.1

### Patch Changes

- @tangleai/context@0.29.1
  - @tangleai/core@0.29.1
  - @tangleai/models@0.29.1

## 0.29.0

### Patch Changes

- @tangleai/context@0.29.0
  - @tangleai/core@0.29.0
  - @tangleai/models@0.29.0

## 0.28.0

### Patch Changes

- @tangleai/context@0.28.0
  - @tangleai/core@0.28.0
  - @tangleai/models@0.28.0

## 0.27.3

### Patch Changes

- Updated dependencies [9f7d8c8]
  - @tangleai/core@0.27.3
  - @tangleai/context@0.27.3
  - @tangleai/models@0.27.3

## 0.27.2

### Patch Changes

- @tangleai/context@0.27.2
  - @tangleai/core@0.27.2
  - @tangleai/models@0.27.2

## 0.27.1

### Patch Changes

- @tangleai/context@0.27.1
  - @tangleai/core@0.27.1
  - @tangleai/models@0.27.1

## 0.27.0

### Patch Changes

- Updated dependencies [6dcfde9]
- Updated dependencies [a6fa7f3]
- Updated dependencies [d4d8d0b]
- Updated dependencies [63504f3]
- Updated dependencies [7f2e26f]
  - @tangleai/context@0.27.0
  - @tangleai/core@0.27.0
  - @tangleai/models@0.27.0

## 0.26.3

### Patch Changes

- @tangleai/context@0.26.3
  - @tangleai/core@0.26.3
  - @tangleai/models@0.26.3

## 0.26.2

### Patch Changes

- @tangleai/context@0.26.2
  - @tangleai/core@0.26.2
  - @tangleai/models@0.26.2

## 0.26.1

### Patch Changes

- @tangleai/context@0.26.1
  - @tangleai/core@0.26.1
  - @tangleai/models@0.26.1

## 0.26.0

### Patch Changes

- Updated dependencies [6e0f5be]
  - @tangleai/core@0.26.0
  - @tangleai/context@0.26.0
  - @tangleai/models@0.26.0

## 0.25.1

### Patch Changes

- Consume the exact Jaren 0.87.0 registry packages and source pin. Qualify native SQLite schema changes, column references, JSON type inspection and per-call mutation semantics alongside Tangle records across Node, Bun and installed consumers. Preserve the existing document storage model and historical paid measurements.
- Updated dependencies
  - @tangleai/models@0.25.1
  - @tangleai/context@0.25.1
  - @tangleai/core@0.25.1

## 0.25.0

### Patch Changes

- @tangleai/context@0.25.0
  - @tangleai/core@0.25.0
  - @tangleai/models@0.25.0

## 0.24.1

### Patch Changes

- @tangleai/context@0.24.1
  - @tangleai/core@0.24.1
  - @tangleai/models@0.24.1

## 0.24.0

### Patch Changes

- @tangleai/context@0.24.0
  - @tangleai/core@0.24.0
  - @tangleai/models@0.24.0

## 0.23.0

### Patch Changes

- @tangleai/context@0.23.0
  - @tangleai/core@0.23.0
  - @tangleai/models@0.23.0

## 0.22.0

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.22.0
  - @tangleai/context@0.22.0
  - @tangleai/core@0.22.0

## 0.21.1

### Patch Changes

- Update the exact Jaren foundation dependencies and source pin to the published
  0.84.3 release after verifying its AI-free archives against source-built bytes.
  Retain Tangle's model, context and agent ownership and align the development
  Node pin with 24.20.0. Tangle publication remains a manual author action.
  Allow release preparation after an already committed local release while
  preserving its record and rejecting unprepared version edits.
- Updated dependencies
  - @tangleai/models@0.21.1
  - @tangleai/context@0.21.1
  - @tangleai/core@0.21.1

## 0.21.0

### Minor Changes

- Use the models, context and agents owners of the inherited AI mechanisms. MAS
  executable identity version 3 names all executed mechanism versions; an old
  executable checkpoint is refused intact through the existing mismatch path.
  Memory and ledger records retain their schemas and projection contracts.

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangleai/core@0.21.0
  - @tangleai/models@0.21.0
  - @tangleai/context@0.21.0

## 0.20.1

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.20.1

## 0.20.0

### Minor Changes

- Establish the coordinated 0.20.0 release with JavaScript and TypeScript declaration distributions, preserved public subpaths and JSON schemas, and verified Node and Bun consumers. Use published JarenJS 0.83.3 fixes without a consumer installation patch. Prepare versions before release commits, verify locally, push directly to main and publish CI-verified tarballs. Deploy the website independently from local Tangle workspace source with JarenJS packages from npm, verifying dependency sources and the live commit.

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.20.0
