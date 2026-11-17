# @tangleai/models

## 0.52.4

### Patch Changes

- An agent send no longer waits on the platform's digest before its first request. The run identity's SHA-256 values are now computed synchronously (equal to `sha256Hex` and `canonicalSha256` on the same input, so every identity keeps its value): a busy thread pool held each request back by an unbounded number of event-loop turns, and on a page without `crypto.subtle` (plain http other than localhost) every send was refused.

## 0.52.3

### Patch Changes

- 5593e2d: An agent run can be resumed after a restart without a tool acting twice. A tool's context carries `call: { id, round, attempt }` (the provider's tool-call id, the round, and how often this agent ran that id), so a tool with an effect keys it by the id; `onCheckpoint` on a send is called after each round's tool results with a copy of the messages, the steps, the round and the spend, the point a host persists and resumes from.
- b351c19: Every agent result, and the partial result a rejected call carries, says what produced it: `identity` holds the SHA-256 of the base system prompt, the canonical SHA-256 of the listed tool definitions sorted by name, the tool names, the configured provider and model, and every model the provider reported answering. A host stores it beside the run so an evaluation names the prompt and tool versions it measured, and a changed prompt or schema shows as a changed digest. `@tangleai/agents` now depends directly on `@jarenjs/json`, which was already in its closure.

## 0.52.2

### Patch Changes

- Builds on Jaren 0.217.0, whose database runs an existence test over a hop that pairs an equality with a comparison of two non-null columns as one native statement on SQLite and PostgreSQL. Tangle issues no such query, so no behaviour changes; the pins, the foundation manifest and the integration audit move to the new release.

## 0.52.1

### Patch Changes

- Builds on Jaren 0.216.0, whose josl CSV writers can quote every field, the header included, on request. Tangle writes no CSV, so no behaviour changes; the pins, the foundation manifest and the integration audit move to the new release.

## 0.52.0

### Patch Changes

- e5d7435: A failure says how it happened without a message to match: a direct call's `AI0002` carries `outcome: "timeout"` or `outcome: "network"`, and a routed client reports every route it tried, including one stopped before it started by the caller's abort or the account's budget (`outcome: "budget"`, `started: false`), so a meter accounts for every attempt. The assistant view announces its errors (`role="alert"`), keeps its log live and busy while a run works, offers a failed run a retry (the `retry` intent, in all twelve languages) and returns focus to its launcher when the panel closes with focus inside it.
- fd8be60: The desktop stamps `data-theme` beside `data-scheme` on its own root and on a joined page's, so Jaren's component stylesheets (Markdown, diagrams, charts, Studio) turn dark with the desktop.
- e5d7435: The Pages playground hands its renderers and validator to the Play component once instead of on every run, and its game shares the playground's compiled language catalogues instead of compiling its own.
- e5d7435: The desktop's mail is the one inbox for what a person decides. An application declares the kinds of proposal it files (`proposals` in its manifest) and files them with `propose` (the same id replaces, `withdraw` takes one back); the mail shows them as text, with evidence linking only to http(s) pages, and the person accepts or rejects. The decision goes back to the application over its own control channel (`onDecision`), never as a contract operation, so neither the assistant nor another module can decide, whatever their grants. One decision runs at a time; an application that is not running or refuses (a moved revision) leaves the proposal pending with the reason. `kernel.propose`, `kernel.decide` and the `mail` events serve a host with its own inbox.
- 552b27e: A provider's usage has a type, `ChatUsage`, in place of `any`; a structured result's summed usage keeps reasoning tokens once a call reports them, and `usageComplete` says whether every call reported usage, so a partial sum no longer reads as complete. Every release build writes `releases/digests.json` (each tarball's size, SHA-256 and integrity, with the input hash), committed with the release and checked against a fresh build, so a release stays verifiable from the repository after CI's artifact expires.

## 0.51.3

### Patch Changes

- Build on Jaren 0.215.0, which compares a caller-written numeric key exactly on PostgreSQL.

## 0.51.2

### Patch Changes

- Build on Jaren 0.214.0, which exports its host tokens as light and dark stylesheets and lets its component stylesheets follow the host's dark selection.

## 0.51.1

### Patch Changes

- Build on Jaren 0.213.0, which renders an untrusted app document with its data bindings and granted widgets without a frame.

## 0.51.0

### Patch Changes

- The desktop has one Settings for every application. `@tangleai/os/settings` is a Settings module a host installs with its own sections first and then one per application whose manifest declares `settings`: `mount` (a shipped module's own settings screen), `page` (an origin application's settings page, framed from its own origin and given no contract ports) or `form` (a document module's JSON Schema, whose values the desktop keeps through `createKernel({ settings })`, checked against the schema and never a secret). Applications keep their own values; the desktop is where the person finds them, with a search, from the window and dock menus, and from the application itself (`openSettings()` over its own port, no grant needed). The Pages desktop's Settings is this module, and the Calendar's working hours are a section of it.

## 0.50.0

### Patch Changes

- The desktop fits the applications that host it or join it. Hosting: `mountDesktop(node, { compact: { below } })` makes a narrow desktop compact, every window opening maximized and only the focused one shown; at any width the dock stays on screen, its tiles shrinking to fit and then scrolling, every module reachable by pointer and keyboard, and a keyboard user keeps their place when the dock redraws; `tray` decides the mail tile and the light/dark switch and adds a brand mark; `desktop.subscribe` reports every window change with its state, and when a module is `ready` or has `failed`; a shipped module learns from `visible` and `onVisibility` when its window is hidden; a host glyph is documented API. Framed applications: a framed module has `connectTimeoutMs` (15 s by default) to answer, past which its window says so, offers to try again and holds nothing open, and a module whose page reloads connects again on fresh ports. Joining: `connectToOs` takes `connectTimeoutMs` and `signal`, refuses with an `OsConnectError` (`OS0401`, `OS0403`) and leaves no listener behind, refuses a page that is not framed at once (`OS0402`), and keeps the application's own look with `presentation: "none"` or `{ root }`; `GrantedOperation` and `ToolBuilder` are exported. Windows open wholly on the desktop, keep their manifest's minimum size when resized, are labelled regions rather than dialogs, play their opening animation once and stop moving under reduced motion, and their glass survives a minified build. The assistant view opens, closes and toggles from the host, and builds its own Markdown only when the host renders none.
- Build on Jaren 0.212.0, whose assignment engine evaluates what-ifs incrementally, proposes fills and repairs against a baseline, and whose database reads hand-written SQLite triggers back as rules.
- `npm test` runs the release suite; the long-running set (reproducing committed measurements and qualifying crash recovery, about 88% of the recorded test time) runs with `npm run test:long`, and both with `npm run test:all`. CI runs the long-running set as a separate job that never blocks a release, and keeps a verified release artifact for 90 days.

## 0.49.2

### Patch Changes

- Build on Jaren 0.207.0, whose assignment scoring covers one resource on one local civil day through an injected zone.

## 0.49.1

### Patch Changes

- Build on Jaren 0.206.0, whose calendar reads iCalendar back into its model, compiles and embeds zone definitions and edits foreign iCalendar losslessly, and whose core scores assignments exactly.

## 0.49.0

### Patch Changes

- A limit that would never be reached is refused before any call, with `AI0001`: `maxRepairs`, `retry.attempts` and an agent's `maxToolRounds` and `budget.turns` must be whole numbers of at least 0, and `budget.tokens`, `budget.ms` and `budget.cost` finite numbers of at least 0. Before, `maxRepairs: Infinity` repaired without end and a NaN turn budget never stopped a run; `maxRepairs: -1` made no call and returned a failure with no errors. A structured result's `attempts` is the number of calls made.
- Build on Jaren 0.201.2, two patch releases of database, ordering and calendar fixes with fuller type declarations.
- `@tangleai/os` can be used from another repository without a registry. Every release keeps the package tarball, a one-file module side (`connectToOs` with its dependencies inside, for a page on any foundation) and a manifest of their hashes, protocol and Jaren foundation under `releases/os/`, and the desktop site serves the same files under `os/`. The package now depends on Jaren alone. `kernel.operations()` lists what a caller may call as plain data, for an application with its own agent runtime. Migration: `kernel.tools()` builds its tools with the host's tool builder, so pass one when creating the kernel: `createKernel({ tools })` with `import * as tools from "@tangleai/agents/toolbox"`; without one it refuses with `OS0301`.

## 0.48.3

### Patch Changes

- Build on Jaren 0.201.0. Its calendar repeats monthly and yearly by the iCalendar standard, so the desktop Calendar now offers "Every month" and "Every year", and its editor says when a series skips a date that a month or year lacks. The Pages playground is now built on Jaren's play host kit instead of a copy of Jaren's site: a saved or shared session no longer carries a message language and opens in its reader's, and an example made to show one language shows it for its own run.

## 0.48.2

### Patch Changes

- Build on Jaren 0.199.0, whose calendar (`@jarenjs/core/calendar`), iCalendar writer (`@jarenjs/josl/ical`) and calendar-scheduled database jobs arrive in these releases. The Pages desktop gains a Calendar built on them: a month view, a day panel and an editor, recurring events with skipped days, "find a time" over the person's working hours that never offers unknown time, an iCalendar export, and a `calendar` contract (agenda, add, free) that the assistant and other applications use as tools.

## 0.48.1

### Patch Changes

- Build on Jaren 0.193.1. Its `sha256Hex` replaces the nine local SHA-256 helpers, each keeping its name, with identical digests. MAS caches compiled embedded schemas with Jaren's semantic cache, which now remembers the key of a frozen tree: 0.31 µs per lookup against 22.8 µs before. The Studio authoring gate now refuses an element written as an object and names an unknown operator with the nearest known one. The Studio file author sends an open profile in the prompt to an Anthropic model, which refuses an output schema with an open object, so the Pages Studio assistant no longer fails with HTTP 400 on the default model. The assistant's Japanese and Traditional Chinese packs use Jaren's 「…」 permalink wording.

## 0.48.0

### Minor Changes

- Make Tangle OS the Pages site. Studio, Playground, Flow, Data, the adventure, the memory loop and moving browser data are desktop applications now, beside Welcome, the assistant, Settings and the to-do module; the assistant uses the work applications' authoring tools, and a former page link opens its application. `@tangleai/os` adds theme kits (`THEME_KITS`, `composeTheme`): each is one JSON document with light and dark palettes, a procedural wallpaper and a shape, and a person's changes (accent, highlight, pattern, seed, density, glass, corners, spacing) compose into an ordinary theme document that can be exported and imported. Five procedural wallpapers (`PATTERNS`, `patternBackground`: woven threads, contours, a two-ink halftone, a sun print and moiré tides) are drawn deterministically from a seed in the theme's own colours. Windows are laid out above the dock.

## 0.47.0

### Minor Changes

- Add `@tangleai/os`, a browser operating system for applications built on Jaren and Tangle. A module is a JSON manifest plus the contract operations it serves and needs; the desktop hosts it as a shipped component, as a jaren-app document in a sandboxed opaque-origin frame, or as an application's own page on its own origin that joins with `connectToOs` from `@tangleai/os/module`. The kernel installs modules in shipped, suite and user layers with RFC 6902 patches, keeps a journal with undo and a recovery boot, routes every call between modules as a contract operation under grants into a ledger, carries mail, and lists every granted operation as an assistant tool. The assistant's model placeholder and the documentation now name only the models that write Jaren's JSON documents reliably: `anthropic/claude-haiku-5.5`, and Qwen 3.7 27B or larger. The desktop has context menus on its background, title bars and dock, minimized windows now actually hide, and `mountDesktop` takes `themeFor` and `onSchemeSwitch` so a host's own colours survive the dock's light/dark switch. The Pages desktop ships an Assistant window and a Settings app: provider, OpenRouter key (kept in this browser, optionally for the tab only), region, a model picker over OpenRouter's catalogue, appearance, and forgetting what the browser keeps.

## 0.46.0

### Patch Changes

- Build on Jaren 0.188.0. Its validator keeps the text a schema's `errorMessage` wrote in every locale, a `$msgid` fallback included, and a validation error's `toJSON` carries that mark; `diffContracts` reports fewer false and more real breaking changes; `@jarenjs/db` reads a PostgreSQL `jsonb` null as SQL NULL and names unguarded number columns in `introspect()`. Every exact `@jarenjs/*` pin moves from 0.184.2 to 0.188.0, and the candidate tarballs are recaptured from the tagged source with an empty patch. Local copies of canonical cloning and RFC 6901 token escaping are replaced by `@jarenjs/json`'s `cloneJson` and pointer helpers, with identical output.

## 0.45.2

No changes in this release.

## 0.45.1

No changes in this release.

## 0.45.0

### Minor Changes

- Let the host decide the agent loop's language, tools, context and spend. `createAgent({ messages })` replaces every sentence the loop writes into a request or a result (`AgentMessages`; the English `AGENT_MESSAGES` are byte for byte the earlier text), and passes `messages.goal`, `messages.recall`, `messages.environment` and `messages.toolbox` to the goal prompt, the `recall` and environment tools and its own toolboxes; `createLedger({ messages: { goal } })`, `goalPrompt(goal, messages)`, `createRecallTool(ledger, { messages })`, `environmentTools(environment, messages)` and `createToolbox({ messages })` take the same words. `recall` is now listed only when the agent can compact (a ledger and a `historyBudget`), or with `recall: true`; `recall: false` never lists it. Tools run as `execute(input, { signal, context })` with the send's abort signal and the host's `toolContext`, so a stopped run stops its tools (Jaren's contract tools read the same signal). A model call that rejects counts as a turn and carries `error.partial = { messages, steps, spent }`. `budget.cost` bounds a run priced by `prices(model)`, `spend()` reports `cost`, and `budget.reserve` with `maxOutputTokens` refuses any call whose worst case could cross the token or cost budget, booking the worst case when a provider reports no usage; `probePrices` in `@tangleai/models/providers` reads per-token prices from a provider's model listing. `toolbox.add` throws `AI0001` for a name it already holds unless `{ replace: true }`, and `toolboxFromContract(contract, client, { bind, mapOutcome, … })` registers a contract's operations with host-bound input members removed from the model's schema and injected on execution.
- Keep the API key out of every client object. `client.endpoint` is the credential-free identity `{ provider, base, url, model, hasKey }`; the headers, key included, stay inside the client, so logging, serializing or inspecting a chat client, or a routed client over it, never shows them, and a provider error body that echoes the key has it replaced by `[redacted]` in the `AI0002` message. Migration: read `hasKey` instead of `endpoint.headers`; `resolveEndpoint` still returns the headers to the caller that passed the key. A base URL with a username or password, or with a scheme other than `http:` or `https:`, is refused with `AI0001` when the client is built, and no refusal quotes credentials or a query. The routed client codes its own failures: a deadline is `AI0004` (`outcome: 'timeout'`, `deadlineMs`), a reply over its token ceiling `AI0005` (`outcome: 'token-limit'`, `usage`, `limit`) and an account stop `AI0006` (`outcome: 'budget'`); a caller's own abort still rejects with the caller's reason.
- Report structured-output failures in one shape and stop repairing truncated replies. `createStructuredOutput().generate` answers `{ ok: true, value }` or `{ ok: false, errors }`, both with `raw`, `attempts`, `finishReason`, summed `usage` and per-attempt `calls`; every error record carries `stage` (`parse`, `schema`, `gate` or `truncated`), an always-present `code` and `path`, and `message`, beside the `instancePath`, `keyword` and `docPath` the repair prompt still carries byte for byte. A reply that stops at the token limit, or carries reasoning and no content, is reported as `truncated` instead of being sent for a repair; `onAttempt` reports a reply that is not JSON as `parse` (it said `schema`) and adds each attempt's finish reason and usage. A passing gate may return `data`, surfaced as `gateData`; `deadlineMs` bounds a whole generation as `AI0004`; `parse: 'lenient'` reads JSON wrapped in prose; `bundle: true` sends `bundleSchema(schema, refs)`, a self-contained schema, while validation stays local; `tier` overrides the structured-output tier. The chat client states its model's tier (`structured`, reported as `endpoint.structured`, so Anthropic models on OpenRouter can take the prompt-carried `null` they need, since they refuse `oneOf`), bounds each attempt with `timeoutMs` (a retryable `AI0002` with status 0), and asks a stream for its usage with `requestUsage` (`stream_options`, never in the replay key). `createRoutedClient` accepts a host's own purpose and types its `onRoute` events and `account`. New entries: `@tangleai/models/testing` exports `createScriptedFetch`, a scripted `fetch` for keyless tests (replies, truncation, HTTP and network failures, a hang that honours abort), and `@tangleai/models/replay-file` exports `createFileReplayCache`, a replay directory over an injected file system with `record`, `fresh` and a fail-closed `replay` mode. `ChatResult`, `ChatClient`, `StructuredError` and `StructuredResult` are exported types. The program runtime's `account` option takes typed `reserve` and `settle` functions.

## 0.44.0

No changes in this release.

## 0.43.1

No changes in this release.

## 0.43.0

No changes in this release.

## 0.42.1

No changes in this release.

## 0.42.0

### Minor Changes

- Move every package onto the Jaren 0.161.0 foundation, consumed as candidate tarballs rebuilt byte for byte from the pinned source because npm does not serve that release. Absorb its typed check outcomes, stage-discriminated guarded commits, strict retry options and typed migration plans; remove the two declaration bridges its corrected LINQ declarations make unnecessary; re-derive the paid memory policy report's interval statistics under its corrected nearest-rank quantile, which changes the default policy's provenance report id but no selection, decision or default value; and raise the program pen bundle ceiling to 29,000 bytes for the larger captured-expression module.

## 0.41.0

No changes in this release.

## 0.40.0

No changes in this release.

## 0.39.0

No changes in this release.

## 0.38.0

No changes in this release.

## 0.37.0

No changes in this release.

## 0.36.0

No changes in this release.

## 0.35.0

No changes in this release.

## 0.34.0

No changes in this release.

## 0.33.0

### Minor Changes

- 236b915: Add bounded forecasting execution, cutoff-audited evidence tools and six-section
  notes with shared budgets, retained failures and actual producer identities.
  Expose the chat client's effective credential-free request key without I/O.

## 0.32.0

No changes in this release.

## 0.31.0

No changes in this release.

## 0.30.1

No changes in this release.

## 0.30.0

No changes in this release.

## 0.29.8

No changes in this release.

## 0.29.7

No changes in this release.

## 0.29.6

No changes in this release.

## 0.29.5

No changes in this release.

## 0.29.4

No changes in this release.

## 0.29.3

No changes in this release.

## 0.29.2

No changes in this release.

## 0.29.1

No changes in this release.

## 0.29.0

No changes in this release.

## 0.28.0

No changes in this release.

## 0.27.3

No changes in this release.

## 0.27.2

No changes in this release.

## 0.27.1

No changes in this release.

## 0.27.0

No changes in this release.

## 0.26.3

No changes in this release.

## 0.26.2

No changes in this release.

## 0.26.1

No changes in this release.

## 0.26.0

No changes in this release.

## 0.25.1

### Patch Changes

- Consume the exact Jaren 0.87.0 registry packages and source pin. Qualify native SQLite schema changes, column references, JSON type inspection and per-call mutation semantics alongside Tangle records across Node, Bun and installed consumers. Preserve the existing document storage model and historical paid measurements.

## 0.25.0

No changes in this release.

## 0.24.1

No changes in this release.

## 0.24.0

No changes in this release.

## 0.23.0

No changes in this release.

## 0.22.0

### Patch Changes

- Convert the migrated source, tests, benchmarks and hosts to strict TypeScript,
  with JavaScript and declarations emitted through one release build. Move the
  program pen from `@tangleai/jaren/program` and the Jaren integration barrel to
  `@tangleai/linq/program`, preserving its JSON format and phantom binding types.
  The new `@tangleai/linq` root exposes the program namespace and shared build error.

  Match the embedder declarations to unknown widths before the first response,
  retain precise ledger result variants, and enforce the refinement-pressure
  instrument's stated 60-second deadline through the chat client's abort signal.

## 0.21.1

### Patch Changes

- Update the exact Jaren foundation dependencies and source pin to the published
  0.84.3 release after verifying its AI-free archives against source-built bytes.
  Retain Tangle's model, context and agent ownership and align the development
  Node pin with 24.20.0. Tangle publication remains a manual author action.
  Allow release preparation after an already committed local release while
  preserving its record and rejecting unprepared version edits.

## 0.21.0

### Minor Changes

- Add independent model transport, evidence-backed context, and bounded agent/program packages. Preserve the JavaScript/JSDoc APIs, strict result contracts and injected host services, with JavaScript distributions and checked declarations. Toolbox browser registration delegates to Jaren's shared WebMCP contract.

The source transfer is locally qualified before its first coordinated release.
