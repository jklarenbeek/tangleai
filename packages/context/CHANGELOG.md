# @tangleai/context

## 0.48.3

### Patch Changes

- Build on Jaren 0.201.0. Its calendar repeats monthly and yearly by the iCalendar standard, so the desktop Calendar now offers "Every month" and "Every year", and its editor says when a series skips a date that a month or year lacks. The Pages playground is now built on Jaren's play host kit instead of a copy of Jaren's site: a saved or shared session no longer carries a message language and opens in its reader's, and an example made to show one language shows it for its own run.
- Updated dependencies
  - @tangleai/models@0.48.3

## 0.48.2

### Patch Changes

- Build on Jaren 0.199.0, whose calendar (`@jarenjs/core/calendar`), iCalendar writer (`@jarenjs/josl/ical`) and calendar-scheduled database jobs arrive in these releases. The Pages desktop gains a Calendar built on them: a month view, a day panel and an editor, recurring events with skipped days, "find a time" over the person's working hours that never offers unknown time, an iCalendar export, and a `calendar` contract (agenda, add, free) that the assistant and other applications use as tools.
- Updated dependencies
  - @tangleai/models@0.48.2

## 0.48.1

### Patch Changes

- Build on Jaren 0.193.1. Its `sha256Hex` replaces the nine local SHA-256 helpers, each keeping its name, with identical digests. MAS caches compiled embedded schemas with Jaren's semantic cache, which now remembers the key of a frozen tree: 0.31 µs per lookup against 22.8 µs before. The Studio authoring gate now refuses an element written as an object and names an unknown operator with the nearest known one. The Studio file author sends an open profile in the prompt to an Anthropic model, which refuses an output schema with an open object, so the Pages Studio assistant no longer fails with HTTP 400 on the default model. The assistant's Japanese and Traditional Chinese packs use Jaren's 「…」 permalink wording.
- Updated dependencies
  - @tangleai/models@0.48.1

## 0.48.0

### Minor Changes

- Make Tangle OS the Pages site. Studio, Playground, Flow, Data, the adventure, the memory loop and moving browser data are desktop applications now, beside Welcome, the assistant, Settings and the to-do module; the assistant uses the work applications' authoring tools, and a former page link opens its application. `@tangleai/os` adds theme kits (`THEME_KITS`, `composeTheme`): each is one JSON document with light and dark palettes, a procedural wallpaper and a shape, and a person's changes (accent, highlight, pattern, seed, density, glass, corners, spacing) compose into an ordinary theme document that can be exported and imported. Five procedural wallpapers (`PATTERNS`, `patternBackground`: woven threads, contours, a two-ink halftone, a sun print and moiré tides) are drawn deterministically from a seed in the theme's own colours. Windows are laid out above the dock.

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.48.0

## 0.47.0

### Minor Changes

- Add `@tangleai/os`, a browser operating system for applications built on Jaren and Tangle. A module is a JSON manifest plus the contract operations it serves and needs; the desktop hosts it as a shipped component, as a jaren-app document in a sandboxed opaque-origin frame, or as an application's own page on its own origin that joins with `connectToOs` from `@tangleai/os/module`. The kernel installs modules in shipped, suite and user layers with RFC 6902 patches, keeps a journal with undo and a recovery boot, routes every call between modules as a contract operation under grants into a ledger, carries mail, and lists every granted operation as an assistant tool. The assistant's model placeholder and the documentation now name only the models that write Jaren's JSON documents reliably: `anthropic/claude-haiku-5.5`, and Qwen 3.7 27B or larger. The desktop has context menus on its background, title bars and dock, minimized windows now actually hide, and `mountDesktop` takes `themeFor` and `onSchemeSwitch` so a host's own colours survive the dock's light/dark switch. The Pages desktop ships an Assistant window and a Settings app: provider, OpenRouter key (kept in this browser, optionally for the tab only), region, a model picker over OpenRouter's catalogue, appearance, and forgetting what the browser keeps.

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.47.0

## 0.46.0

### Patch Changes

- Build on Jaren 0.188.0. Its validator keeps the text a schema's `errorMessage` wrote in every locale, a `$msgid` fallback included, and a validation error's `toJSON` carries that mark; `diffContracts` reports fewer false and more real breaking changes; `@jarenjs/db` reads a PostgreSQL `jsonb` null as SQL NULL and names unguarded number columns in `introspect()`. Every exact `@jarenjs/*` pin moves from 0.184.2 to 0.188.0, and the candidate tarballs are recaptured from the tagged source with an empty patch. Local copies of canonical cloning and RFC 6901 token escaping are replaced by `@jarenjs/json`'s `cloneJson` and pointer helpers, with identical output.
- Updated dependencies
  - @tangleai/models@0.46.0

## 0.45.2

### Patch Changes

- @tangleai/models@0.45.2

## 0.45.1

### Patch Changes

- @tangleai/models@0.45.1

## 0.45.0

### Minor Changes

- Let the host decide the agent loop's language, tools, context and spend. `createAgent({ messages })` replaces every sentence the loop writes into a request or a result (`AgentMessages`; the English `AGENT_MESSAGES` are byte for byte the earlier text), and passes `messages.goal`, `messages.recall`, `messages.environment` and `messages.toolbox` to the goal prompt, the `recall` and environment tools and its own toolboxes; `createLedger({ messages: { goal } })`, `goalPrompt(goal, messages)`, `createRecallTool(ledger, { messages })`, `environmentTools(environment, messages)` and `createToolbox({ messages })` take the same words. `recall` is now listed only when the agent can compact (a ledger and a `historyBudget`), or with `recall: true`; `recall: false` never lists it. Tools run as `execute(input, { signal, context })` with the send's abort signal and the host's `toolContext`, so a stopped run stops its tools (Jaren's contract tools read the same signal). A model call that rejects counts as a turn and carries `error.partial = { messages, steps, spent }`. `budget.cost` bounds a run priced by `prices(model)`, `spend()` reports `cost`, and `budget.reserve` with `maxOutputTokens` refuses any call whose worst case could cross the token or cost budget, booking the worst case when a provider reports no usage; `probePrices` in `@tangleai/models/providers` reads per-token prices from a provider's model listing. `toolbox.add` throws `AI0001` for a name it already holds unless `{ replace: true }`, and `toolboxFromContract(contract, client, { bind, mapOutcome, … })` registers a contract's operations with host-bound input members removed from the model's schema and injected on execution.

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangleai/models@0.45.0

## 0.44.0

### Patch Changes

- @tangleai/models@0.44.0

## 0.43.1

### Patch Changes

- @tangleai/models@0.43.1

## 0.43.0

### Patch Changes

- @tangleai/models@0.43.0

## 0.42.1

### Patch Changes

- @tangleai/models@0.42.1

## 0.42.0

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.42.0

## 0.41.0

### Patch Changes

- @tangleai/models@0.41.0

## 0.40.0

### Patch Changes

- @tangleai/models@0.40.0

## 0.39.0

### Patch Changes

- @tangleai/models@0.39.0

## 0.38.0

### Patch Changes

- @tangleai/models@0.38.0

## 0.37.0

### Patch Changes

- @tangleai/models@0.37.0

## 0.36.0

### Patch Changes

- @tangleai/models@0.36.0

## 0.35.0

### Patch Changes

- @tangleai/models@0.35.0

## 0.34.0

### Patch Changes

- @tangleai/models@0.34.0

## 0.33.0

### Patch Changes

- Updated dependencies [236b915]
  - @tangleai/models@0.33.0

## 0.32.0

### Patch Changes

- @tangleai/models@0.32.0

## 0.31.0

### Patch Changes

- @tangleai/models@0.31.0

## 0.30.1

### Patch Changes

- @tangleai/models@0.30.1

## 0.30.0

### Patch Changes

- @tangleai/models@0.30.0

## 0.29.8

### Patch Changes

- @tangleai/models@0.29.8

## 0.29.7

### Patch Changes

- @tangleai/models@0.29.7

## 0.29.6

### Patch Changes

- @tangleai/models@0.29.6

## 0.29.5

### Patch Changes

- @tangleai/models@0.29.5

## 0.29.4

### Patch Changes

- @tangleai/models@0.29.4

## 0.29.3

### Patch Changes

- @tangleai/models@0.29.3

## 0.29.2

### Patch Changes

- @tangleai/models@0.29.2

## 0.29.1

### Patch Changes

- @tangleai/models@0.29.1

## 0.29.0

### Patch Changes

- @tangleai/models@0.29.0

## 0.28.0

### Patch Changes

- @tangleai/models@0.28.0

## 0.27.3

### Patch Changes

- @tangleai/models@0.27.3

## 0.27.2

### Patch Changes

- @tangleai/models@0.27.2

## 0.27.1

### Patch Changes

- @tangleai/models@0.27.1

## 0.27.0

### Patch Changes

- 6dcfde9: Label archived sizes in UTF-16 characters and refuse contradiction comparisons across embedding identities. Add registered, source-delivery controls for measuring context consolidation.
- @tangleai/models@0.27.0

## 0.26.3

### Patch Changes

- @tangleai/models@0.26.3

## 0.26.2

### Patch Changes

- @tangleai/models@0.26.2

## 0.26.1

### Patch Changes

- @tangleai/models@0.26.1

## 0.26.0

### Patch Changes

- @tangleai/models@0.26.0

## 0.25.1

### Patch Changes

- Consume the exact Jaren 0.87.0 registry packages and source pin. Qualify native SQLite schema changes, column references, JSON type inspection and per-call mutation semantics alongside Tangle records across Node, Bun and installed consumers. Preserve the existing document storage model and historical paid measurements.
- Updated dependencies
  - @tangleai/models@0.25.1

## 0.25.0

### Patch Changes

- @tangleai/models@0.25.0

## 0.24.1

### Patch Changes

- @tangleai/models@0.24.1

## 0.24.0

### Patch Changes

- @tangleai/models@0.24.0

## 0.23.0

### Patch Changes

- @tangleai/models@0.23.0

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
- Updated dependencies
  - @tangleai/models@0.22.0

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

## 0.21.0

### Minor Changes

- Add independent model transport, evidence-backed context, and bounded agent/program packages. Preserve the JavaScript/JSDoc APIs, strict result contracts and injected host services, with JavaScript distributions and checked declarations. Toolbox browser registration delegates to Jaren's shared WebMCP contract.
- Receive the reusable assistant and injected slot ledger storage, preserving
  streaming, transcript and evidenced-memory behavior with owned cleanup.

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.21.0

The source transfer is locally qualified before its first coordinated release.
