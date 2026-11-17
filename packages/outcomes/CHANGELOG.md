# @tangleai/outcomes

## 0.53.2

### Patch Changes

- Builds on Jaren 0.220.0, whose linq database client builds each handle on its first read instead of all at open, and whose `prepareModel` lets many stores open from one prepared model. Tangle reads its handles by name, so no behaviour changes beyond a lighter open; the pins, the foundation manifest and the integration audit move to the new release.
- Updated dependencies
  - @tangleai/models@0.53.2
  - @tangleai/agents@0.53.2
  - @tangleai/core@0.53.2
  - @tangleai/config@0.53.2
  - @tangleai/memory@0.53.2

## 0.53.1

### Patch Changes

- Builds on Jaren 0.219.1, a patch whose database owner lease is pinned to a SQLite file under every spelling of its path. Its source is unchanged, so no behaviour changes; the pins, the foundation manifest and the integration audit move to the new release.
- Updated dependencies
  - @tangleai/models@0.53.1
  - @tangleai/agents@0.53.1
  - @tangleai/core@0.53.1
  - @tangleai/config@0.53.1
  - @tangleai/memory@0.53.1

## 0.53.0

### Minor Changes

- f4868f0: Applications put their toolbar in their window's title bar: buttons, toggles, menus, tabs and a search field, described as a JSON document (`HEADER_SCHEMA`) and drawn by the desktop, so every bar follows the theme and the writing direction, works by keyboard and screen reader, and fits a narrow window by moving what does not fit into one "More" menu. A framed page calls `setHeader` and hears uses at `onHeader`; a shipped module has the same pair on its context. Every use, the person's and the assistant's, goes through the kernel's own `tangle_os_header` contract (`header.list`, `header.activate`) under grants and into the ledger; an item marked `assistant: false` is kept from the assistant. Calendar moves its month controls into its header bar and Settings its search.

### Patch Changes

- Updated dependencies [f4868f0]
  - @tangleai/models@0.53.0
  - @tangleai/agents@0.53.0
  - @tangleai/core@0.53.0
  - @tangleai/config@0.53.0
  - @tangleai/memory@0.53.0

## 0.52.6

### Patch Changes

- Builds on Jaren 0.219.0, whose `$date-format` writes a date on a named time zone's wall clock through an injected zone provider and whose clock arithmetic cuts a sub-millisecond fraction instead of rounding it. Tangle uses none of the date operators, so no behaviour changes; the pins, the foundation manifest and the integration audit move to the new release.
- Updated dependencies
  - @tangleai/models@0.52.6
  - @tangleai/agents@0.52.6
  - @tangleai/core@0.52.6
  - @tangleai/config@0.52.6
  - @tangleai/memory@0.52.6

## 0.52.5

### Patch Changes

- Builds on Jaren 0.218.0, whose HTTP contract server can refuse a query member an operation does not declare (`closedQuery`, off by default, not turned on here). The Pages desktop adds two applications from Jaren's `@jarenjs/calc`: Calculator (standard, scientific, programmer, financial and converter modes) and Converter (the same component in its converter mode alone, with live public currency rates and an offline table to fall back on), both in the desktop's language and theme.
- Updated dependencies
  - @tangleai/models@0.52.5
  - @tangleai/agents@0.52.5
  - @tangleai/core@0.52.5
  - @tangleai/config@0.52.5
  - @tangleai/memory@0.52.5

## 0.52.4

### Patch Changes

- An agent send no longer waits on the platform's digest before its first request. The run identity's SHA-256 values are now computed synchronously (equal to `sha256Hex` and `canonicalSha256` on the same input, so every identity keeps its value): a busy thread pool held each request back by an unbounded number of event-loop turns, and on a page without `crypto.subtle` (plain http other than localhost) every send was refused.
- Updated dependencies
  - @tangleai/models@0.52.4
  - @tangleai/agents@0.52.4
  - @tangleai/core@0.52.4
  - @tangleai/config@0.52.4
  - @tangleai/memory@0.52.4

## 0.52.3

### Patch Changes

- 5593e2d: An agent run can be resumed after a restart without a tool acting twice. A tool's context carries `call: { id, round, attempt }` (the provider's tool-call id, the round, and how often this agent ran that id), so a tool with an effect keys it by the id; `onCheckpoint` on a send is called after each round's tool results with a copy of the messages, the steps, the round and the spend, the point a host persists and resumes from.
- b351c19: Every agent result, and the partial result a rejected call carries, says what produced it: `identity` holds the SHA-256 of the base system prompt, the canonical SHA-256 of the listed tool definitions sorted by name, the tool names, the configured provider and model, and every model the provider reported answering. A host stores it beside the run so an evaluation names the prompt and tool versions it measured, and a changed prompt or schema shows as a changed digest. `@tangleai/agents` now depends directly on `@jarenjs/json`, which was already in its closure.
- Updated dependencies [5593e2d]
- Updated dependencies [b351c19]
  - @tangleai/models@0.52.3
  - @tangleai/agents@0.52.3
  - @tangleai/core@0.52.3
  - @tangleai/config@0.52.3
  - @tangleai/memory@0.52.3

## 0.52.2

### Patch Changes

- Builds on Jaren 0.217.0, whose database runs an existence test over a hop that pairs an equality with a comparison of two non-null columns as one native statement on SQLite and PostgreSQL. Tangle issues no such query, so no behaviour changes; the pins, the foundation manifest and the integration audit move to the new release.
- Updated dependencies
  - @tangleai/models@0.52.2
  - @tangleai/agents@0.52.2
  - @tangleai/core@0.52.2
  - @tangleai/config@0.52.2
  - @tangleai/memory@0.52.2

## 0.52.1

### Patch Changes

- Builds on Jaren 0.216.0, whose josl CSV writers can quote every field, the header included, on request. Tangle writes no CSV, so no behaviour changes; the pins, the foundation manifest and the integration audit move to the new release.
- Updated dependencies
  - @tangleai/models@0.52.1
  - @tangleai/agents@0.52.1
  - @tangleai/core@0.52.1
  - @tangleai/config@0.52.1
  - @tangleai/memory@0.52.1

## 0.52.0

### Patch Changes

- e5d7435: A failure says how it happened without a message to match: a direct call's `AI0002` carries `outcome: "timeout"` or `outcome: "network"`, and a routed client reports every route it tried, including one stopped before it started by the caller's abort or the account's budget (`outcome: "budget"`, `started: false`), so a meter accounts for every attempt. The assistant view announces its errors (`role="alert"`), keeps its log live and busy while a run works, offers a failed run a retry (the `retry` intent, in all twelve languages) and returns focus to its launcher when the panel closes with focus inside it.
- fd8be60: The desktop stamps `data-theme` beside `data-scheme` on its own root and on a joined page's, so Jaren's component stylesheets (Markdown, diagrams, charts, Studio) turn dark with the desktop.
- e5d7435: The Pages playground hands its renderers and validator to the Play component once instead of on every run, and its game shares the playground's compiled language catalogues instead of compiling its own.
- e5d7435: The desktop's mail is the one inbox for what a person decides. An application declares the kinds of proposal it files (`proposals` in its manifest) and files them with `propose` (the same id replaces, `withdraw` takes one back); the mail shows them as text, with evidence linking only to http(s) pages, and the person accepts or rejects. The decision goes back to the application over its own control channel (`onDecision`), never as a contract operation, so neither the assistant nor another module can decide, whatever their grants. One decision runs at a time; an application that is not running or refuses (a moved revision) leaves the proposal pending with the reason. `kernel.propose`, `kernel.decide` and the `mail` events serve a host with its own inbox.
- 552b27e: A provider's usage has a type, `ChatUsage`, in place of `any`; a structured result's summed usage keeps reasoning tokens once a call reports them, and `usageComplete` says whether every call reported usage, so a partial sum no longer reads as complete. Every release build writes `releases/digests.json` (each tarball's size, SHA-256 and integrity, with the input hash), committed with the release and checked against a fresh build, so a release stays verifiable from the repository after CI's artifact expires.
- Updated dependencies [e5d7435]
- Updated dependencies [fd8be60]
- Updated dependencies [e5d7435]
- Updated dependencies [e5d7435]
- Updated dependencies [552b27e]
  - @tangleai/models@0.52.0
  - @tangleai/agents@0.52.0
  - @tangleai/core@0.52.0
  - @tangleai/config@0.52.0
  - @tangleai/memory@0.52.0

## 0.51.3

### Patch Changes

- Build on Jaren 0.215.0, which compares a caller-written numeric key exactly on PostgreSQL.
- Updated dependencies
  - @tangleai/models@0.51.3
  - @tangleai/agents@0.51.3
  - @tangleai/core@0.51.3
  - @tangleai/config@0.51.3
  - @tangleai/memory@0.51.3

## 0.51.2

### Patch Changes

- Build on Jaren 0.214.0, which exports its host tokens as light and dark stylesheets and lets its component stylesheets follow the host's dark selection.
- Updated dependencies
  - @tangleai/models@0.51.2
  - @tangleai/agents@0.51.2
  - @tangleai/core@0.51.2
  - @tangleai/config@0.51.2
  - @tangleai/memory@0.51.2

## 0.51.1

### Patch Changes

- Build on Jaren 0.213.0, which renders an untrusted app document with its data bindings and granted widgets without a frame.
- Updated dependencies
  - @tangleai/models@0.51.1
  - @tangleai/agents@0.51.1
  - @tangleai/core@0.51.1
  - @tangleai/config@0.51.1
  - @tangleai/memory@0.51.1

## 0.51.0

### Patch Changes

- The desktop has one Settings for every application. `@tangleai/os/settings` is a Settings module a host installs with its own sections first and then one per application whose manifest declares `settings`: `mount` (a shipped module's own settings screen), `page` (an origin application's settings page, framed from its own origin and given no contract ports) or `form` (a document module's JSON Schema, whose values the desktop keeps through `createKernel({ settings })`, checked against the schema and never a secret). Applications keep their own values; the desktop is where the person finds them, with a search, from the window and dock menus, and from the application itself (`openSettings()` over its own port, no grant needed). The Pages desktop's Settings is this module, and the Calendar's working hours are a section of it.
- Updated dependencies
  - @tangleai/models@0.51.0
  - @tangleai/agents@0.51.0
  - @tangleai/core@0.51.0
  - @tangleai/config@0.51.0
  - @tangleai/memory@0.51.0

## 0.50.0

### Patch Changes

- The desktop fits the applications that host it or join it. Hosting: `mountDesktop(node, { compact: { below } })` makes a narrow desktop compact, every window opening maximized and only the focused one shown; at any width the dock stays on screen, its tiles shrinking to fit and then scrolling, every module reachable by pointer and keyboard, and a keyboard user keeps their place when the dock redraws; `tray` decides the mail tile and the light/dark switch and adds a brand mark; `desktop.subscribe` reports every window change with its state, and when a module is `ready` or has `failed`; a shipped module learns from `visible` and `onVisibility` when its window is hidden; a host glyph is documented API. Framed applications: a framed module has `connectTimeoutMs` (15 s by default) to answer, past which its window says so, offers to try again and holds nothing open, and a module whose page reloads connects again on fresh ports. Joining: `connectToOs` takes `connectTimeoutMs` and `signal`, refuses with an `OsConnectError` (`OS0401`, `OS0403`) and leaves no listener behind, refuses a page that is not framed at once (`OS0402`), and keeps the application's own look with `presentation: "none"` or `{ root }`; `GrantedOperation` and `ToolBuilder` are exported. Windows open wholly on the desktop, keep their manifest's minimum size when resized, are labelled regions rather than dialogs, play their opening animation once and stop moving under reduced motion, and their glass survives a minified build. The assistant view opens, closes and toggles from the host, and builds its own Markdown only when the host renders none.
- Build on Jaren 0.212.0, whose assignment engine evaluates what-ifs incrementally, proposes fills and repairs against a baseline, and whose database reads hand-written SQLite triggers back as rules.
- `npm test` runs the release suite; the long-running set (reproducing committed measurements and qualifying crash recovery, about 88% of the recorded test time) runs with `npm run test:long`, and both with `npm run test:all`. CI runs the long-running set as a separate job that never blocks a release, and keeps a verified release artifact for 90 days.
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangleai/models@0.50.0
  - @tangleai/agents@0.50.0
  - @tangleai/core@0.50.0
  - @tangleai/config@0.50.0
  - @tangleai/memory@0.50.0

## 0.49.2

### Patch Changes

- Build on Jaren 0.207.0, whose assignment scoring covers one resource on one local civil day through an injected zone.
- Updated dependencies
  - @tangleai/models@0.49.2
  - @tangleai/agents@0.49.2
  - @tangleai/core@0.49.2
  - @tangleai/config@0.49.2
  - @tangleai/memory@0.49.2

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
