# @tangleai/evolve

## 0.64.1

### Patch Changes

- @tangleai/mas@0.64.1
  - @tangleai/outcomes@0.64.1
  - @tangleai/config@0.64.1
  - @tangleai/context@0.64.1
  - @tangleai/core@0.64.1
  - @tangleai/models@0.64.1

## 0.64.0

### Patch Changes

- @tangleai/config@0.64.0
  - @tangleai/context@0.64.0
  - @tangleai/core@0.64.0
  - @tangleai/mas@0.64.0
  - @tangleai/models@0.64.0
  - @tangleai/outcomes@0.64.0

## 0.63.2

### Patch Changes

- @tangleai/config@0.63.2
  - @tangleai/context@0.63.2
  - @tangleai/core@0.63.2
  - @tangleai/mas@0.63.2
  - @tangleai/models@0.63.2
  - @tangleai/outcomes@0.63.2

## 0.63.1

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.63.1
  - @tangleai/outcomes@0.63.1
  - @tangleai/config@0.63.1
  - @tangleai/context@0.63.1
  - @tangleai/mas@0.63.1
  - @tangleai/models@0.63.1

## 0.63.0

### Patch Changes

- @tangleai/config@0.63.0
  - @tangleai/context@0.63.0
  - @tangleai/core@0.63.0
  - @tangleai/mas@0.63.0
  - @tangleai/models@0.63.0
  - @tangleai/outcomes@0.63.0

## 0.62.6

### Patch Changes

- Updated dependencies
  - @tangleai/context@0.62.6
  - @tangleai/models@0.62.6
  - @tangleai/mas@0.62.6
  - @tangleai/outcomes@0.62.6
  - @tangleai/config@0.62.6
  - @tangleai/core@0.62.6

## 0.62.5

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.62.5
  - @tangleai/outcomes@0.62.5
  - @tangleai/config@0.62.5
  - @tangleai/context@0.62.5
  - @tangleai/mas@0.62.5
  - @tangleai/models@0.62.5

## 0.62.4

### Patch Changes

- a285816: A benchmark report records the Tangle release it was measured with, and no longer has to equal the current one: the trading and trace2skill rebuilds take the committed report's suite, and their checks require only that the Jaren foundation is this one; CGT compares its runtime without the release. Every source-bound benchmark artifact is regenerated once under the identity that leaves Tangle's version strings out, so a version-only release now regenerates none.
- Updated dependencies [a285816]
  - @tangleai/models@0.62.4
  - @tangleai/context@0.62.4
  - @tangleai/core@0.62.4
  - @tangleai/config@0.62.4
  - @tangleai/mas@0.62.4
  - @tangleai/outcomes@0.62.4

## 0.62.3

### Patch Changes

- b4acfd5: Source receipts hash a package manifest and the lockfile without Tangle's own version strings (each package's `version` and every `@tangleai/*` pin), so a version-only release no longer re-identifies the benchmark artifacts that list them; every other byte, Jaren's pins included, still counts.
- Updated dependencies [b4acfd5]
  - @tangleai/models@0.62.3
  - @tangleai/context@0.62.3
  - @tangleai/core@0.62.3
  - @tangleai/config@0.62.3
  - @tangleai/mas@0.62.3
  - @tangleai/outcomes@0.62.3

## 0.62.2

### Patch Changes

- 0548b16: A settle records a cleanup receipt, so a terminal experiment no longer stands for a cleaned workspace by itself. `settleExperiment` writes a `cleanup-intent` key before its swap (the revision and status the swap produces, the workspace's instance token, whether the branch goes) and `cleanup-done` once the workspace is gone; `reconcileCleanups({ store, host })` finishes every intent without completion, only while the experiment sits where the swap left it and only for the workspace instance the intent names, finishing each git step only if it is still needed. A workspace recreated at the same path is refused and left alone, and a completed cleanup is never reapplied. The worktree host gains `instance`, `pathOf` and an idempotent `finish`; `create` writes the instance token into the worktree's git administration directory, outside the tracked tree.
- Updated dependencies [0548b16]
  - @tangleai/models@0.62.2
  - @tangleai/context@0.62.2
  - @tangleai/core@0.62.2
  - @tangleai/config@0.62.2
  - @tangleai/mas@0.62.2
  - @tangleai/outcomes@0.62.2

## 0.62.1

### Patch Changes

- 28b5d3c: Text bounds measure UTF-8 bytes with `utf8ByteLength` from `@jarenjs/core/string` instead of encoding the text with `TextEncoder`: forecast screening, classifier items, harness components, feedback items, guidance and skill instructions, the retrospective summary and `forecastBytes`; outcomes reflection and proposal text and `jsonBytes`; the research patch, artifact, lesson-proposal, workspace-path and CSV bounds; the trace2skill path and per-file bounds; the hera prompt byte cap; the run log's frame-body and replay-page bounds and the MAS trace budget; the temporal input ceiling; the context ledger's `jsonBytes`; an agent's default reservation estimate; and the experiential render budget. Every string measures as before, a lone surrogate as 3 bytes. Where a non-string can reach a bound, it is refused with that bound's own code rather than Jaren's TypeError: the volatile-fact classifier refuses a guidance item whose text is not a string with TFCT1001, and `validateFormat` refuses a file whose content is neither text nor null with TT2S1005 before `draftSize` measures it; the other raw-text bounds already refuse a non-string with their own code (TT2S1003 for a skill path, TRSH1006 for CSV input, the screening TypeError) or through the shape check that runs before them. The context ledger keeps counting a value JSON leaves out as 0 bytes, and the temporal ceiling keeps measuring a request body as its text.
- Updated dependencies [28b5d3c]
  - @tangleai/models@0.62.1
  - @tangleai/context@0.62.1
  - @tangleai/core@0.62.1
  - @tangleai/config@0.62.1
  - @tangleai/mas@0.62.1
  - @tangleai/outcomes@0.62.1

## 0.62.0

### Minor Changes

- 59ee39c: `createStructuredOutput({ profile: 'strict' })` sends, on a `json_schema` tier, the schema's strict profile (`deriveStrictProfile` from `@jarenjs/validate/strict-profile`) with `strict: true`, maps each answer back and validates it against the original schema, which stays the authority. Measured with Claude Haiku 5.5: the provider refused 3 of 4 of the suite's schemas as they are and 1 of 4 as their profile (a grammar-size limit); every profile answer validated (docs/STRICT_PROFILE_BENCHMARK.md).

### Patch Changes

- 726d1ef: `bundleSchema` admits anchors: a reference to an `$anchor` or a fragment-only `$id` is resolved through `@jarenjs/validate/references`, as the validator resolves it, and bundled exactly as a pointer to the same schema would be, so every recorded request keeps its bytes. An anchor the resource does not declare is refused.
- Updated dependencies [726d1ef]
- Updated dependencies [59ee39c]
  - @tangleai/models@0.62.0
  - @tangleai/context@0.62.0
  - @tangleai/core@0.62.0
  - @tangleai/config@0.62.0
  - @tangleai/mas@0.62.0
  - @tangleai/outcomes@0.62.0

## 0.61.1

### Patch Changes

- 0542a6b: A contradiction is resolved as one operation: `MemoryStore` gains an optional atomic `mutate({ put, delete })` (the in-memory store has it), which `resolveContradictions` uses to write the superseded loser and its synthesized resolution together; on a store without it the resolution is written first and taken back if the loser cannot be written. A loser already superseded, by the same winner in a replayed pass or by another in a concurrent one, is counted as an application skip and never written again, so a replay no longer stores a second resolution.
- a9a39ff: MAS head activation is fenced by revision as well as version: `activateWorkflow` and `activateTemplate` take an optional `expectedRevision`, an applied activation and `getActiveWorkflow` return the head's `revision`, and a token read before the head moved away and back to the same version (A→B→A) is refused (`TMAS2001` at `/revision`). Without the revision the version alone decides, as before.
- f92314c: A ledger recall by meaning through a storage adapter's `rank` counts a record the adapter ranked but that was deleted before the ledger read it: the result carries `missing` (when there is one) and counts it among the `skipped`, instead of dropping it silently.
- Updated dependencies [0542a6b]
- Updated dependencies [a9a39ff]
- Updated dependencies [f92314c]
  - @tangleai/models@0.61.1
  - @tangleai/context@0.61.1
  - @tangleai/core@0.61.1
  - @tangleai/config@0.61.1
  - @tangleai/mas@0.61.1
  - @tangleai/outcomes@0.61.1

## 0.61.0

### Minor Changes

- d4629ba: The assistant can change an application it wrote for the person: `apps.read` gives it with a revision (refused with `OS0161` for any module not written for the person), and `apps.revise` offers a new version in the inbox against that revision, refused with `OS0112` when the application changed since, both when offered and when accepted. Accepted, the new version replaces the application, still asking for nothing, and its windows start again on it.

### Patch Changes

- Updated dependencies [d4629ba]
  - @tangleai/models@0.61.0
  - @tangleai/context@0.61.0
  - @tangleai/core@0.61.0
  - @tangleai/config@0.61.0
  - @tangleai/mas@0.61.0
  - @tangleai/outcomes@0.61.0

## 0.60.1

### Patch Changes

- 248bf42: A table column a reply's Markdown aligns itself (`:---`, `---:`) now aligns to the reply's reading start and end, so it mirrors in a right-to-left reply: the assistant maps the `left` and `right` Jaren's renderer writes to `start` and `end`.
- Updated dependencies [248bf42]
  - @tangleai/models@0.60.1
  - @tangleai/context@0.60.1
  - @tangleai/core@0.60.1
  - @tangleai/config@0.60.1
  - @tangleai/mas@0.60.1
  - @tangleai/outcomes@0.60.1

## 0.60.0

### Minor Changes

- 7f5cf01: The assistant can write an application for the person. The desktop's own contract `tangle_os_apps` gives it the crib (`apps.crib`), a check against the gate and its own probes (`apps.check`), and `apps.suggest`, which files the finished document in the person's inbox as the desktop's own proposal, refused (`OS0160`) when it does not pass the gate. The inbox says who wrote it and that it asks for nothing; when the person accepts, it joins their layer as a document module with no grants, opens, and runs in its sandboxed frame. The kernel loads the authoring code only when the assistant uses it, and the Pages assistant is told when and how to write one. Measured through that assistant (a headless desktop, its system prompt and the kernel's tools, one turn): every one of 32 plain requests, 16 in English and 16 in Dutch, ended with an application in the inbox that works when the person uses it (docs/AUTHORING_BENCHMARK.md).

### Patch Changes

- Updated dependencies [7f5cf01]
  - @tangleai/models@0.60.0
  - @tangleai/context@0.60.0
  - @tangleai/core@0.60.0
  - @tangleai/config@0.60.0
  - @tangleai/mas@0.60.0
  - @tangleai/outcomes@0.60.0

## 0.59.0

### Minor Changes

- e36af9d: `@tangleai/os/authoring` is the model-free half of the assistant writing an application: `authoringCrib()` (the grammar rules, Jaren's own operator names, each compiled by a test, and a working to-do list), `gateAuthoredApp` (lint, compile, first frame: what to send back for repair), `checkAuthoredApp` with probes that use an application as a person would (a field or button found by its label, placeholder or text), and `authoredManifest`, a document module that asks for nothing. A new instrument, `benchmark/authoring.ts`, measures how often a plain request becomes an application that works when a person uses it: 22 of 24 with Claude Haiku 5.5 (docs/AUTHORING_BENCHMARK.md).

### Patch Changes

- Updated dependencies [e36af9d]
  - @tangleai/models@0.59.0
  - @tangleai/context@0.59.0
  - @tangleai/core@0.59.0
  - @tangleai/config@0.59.0
  - @tangleai/mas@0.59.0
  - @tangleai/outcomes@0.59.0

## 0.58.1

### Patch Changes

- bdf7736: Choosing a language in Settings now outranks a `?lang=` the link carried, so the desktop starts again in the chosen one. A browser check proves that the assistant and Jaren's applications follow the one language choice, and that a right-to-left assistant reply mirrors its lists, quotes and table cells; a column the Markdown aligns itself keeps the physical side Jaren's renderer writes, as the assistant's README now says.
- Updated dependencies [bdf7736]
  - @tangleai/models@0.58.1
  - @tangleai/context@0.58.1
  - @tangleai/core@0.58.1
  - @tangleai/config@0.58.1
  - @tangleai/mas@0.58.1
  - @tangleai/outcomes@0.58.1

## 0.58.0

### Minor Changes

- 2beaaeb: The Pages desktop speaks the twelve languages: every sentence of its own applications (Welcome, Settings' Providers, Models, Appearance and Privacy sections, the Calendar, To do, About, the memory loop and the Assistant window) comes from one catalogue with a pack per language, in the formal register of the chrome's and the assistant's packs. One choice in Settings → Appearance (the browser's language by default) feeds the shell, Settings, Files, the assistant, Jaren's applications and `Intl`, and Arabic mirrors the desktop; `?lang=` overrides it for a link. The theme kits and the memory pipeline's diagram are named in the person's language too. A browser check renders a sentinel pack over the desktop's own windows and finds no sentence outside a catalogue, and renders every pack and finds no English sentence left.

### Patch Changes

- Updated dependencies [2beaaeb]
  - @tangleai/models@0.58.0
  - @tangleai/context@0.58.0
  - @tangleai/core@0.58.0
  - @tangleai/config@0.58.0
  - @tangleai/mas@0.58.0
  - @tangleai/outcomes@0.58.0

## 0.57.0

### Minor Changes

- ea954a3: The desktop's chrome speaks the eleven languages `@jarenjs/locales` ships besides English: `@tangleai/os/messages/<lang>` (`ar`, `de`, `es`, `fr`, `ja`, `ko`, `nl`, `pt`, `ru`, `tr`, `zh-tw`) is a pack of every sentence the shell, Settings, Files, the install sheet and Applications and access write, in the formal register the assistant's packs use. A host passes one as `messages` to `mountDesktop`, `settingsModule` and `filesModule` (the last two also take `locale`, so Settings, Files and "This browser" carry their names in that language); with Arabic and `dir: 'rtl'` the desktop mirrors. A browser check renders a sentinel pack and finds no chrome text outside the catalogue, and renders every pack and finds no English sentence left.

### Patch Changes

- 27d5ccd: An application the person removes (or whose joining they undo, or that another device removed) now takes what it served along: its contracts, header bars and deciders leave the kernel and its windows close, so its window can no longer answer the assistant, which under `assistantGrants: 'all'` it could before. A contract whose module is no longer on the desktop is no one's to call. A kept application is never restored over a contract another module declares. The install sheet opens with Cancel focused, so a stray Enter never consents, and two suites named at once show their sheets one after the other.
- Updated dependencies [27d5ccd]
- Updated dependencies [ea954a3]
  - @tangleai/models@0.57.0
  - @tangleai/context@0.57.0
  - @tangleai/core@0.57.0
  - @tangleai/config@0.57.0
  - @tangleai/mas@0.57.0
  - @tangleai/outcomes@0.57.0

## 0.56.0

### Minor Changes

- 5b7d8ee: A link to a suite installs nothing by itself: `desktop.join(suite, { source })` shows the person an install sheet with each application's origin, the contracts it offers, the scopes it asks for (each a choice) and the assistant's access (off), and installs only what they add, kept in their state. An application joined before is updated without asking unless it now comes from another origin or asks for more. An application on this device or the local network says that the browser may ask about it, and its window says how to recover when that was refused. Settings has a section of the desktop's own, Applications and access: every application's origin, grants and recent calls, with switches for the scopes and the assistant's access of the ones the person added, and Remove. The Pages desktop joins `?suite=` links this way.
- 42ec33b: Applications a person joins are installed with their consent. `kernel.join(manifest, { scopes, assistant, source })` installs one in the person's layer and grants exactly the scopes they allowed out of what its manifest asks for; what it provides, its header bar and its file location reach the assistant only when they said so, also on a desktop that grants the assistant everything. The joined applications, each with the origin, scopes and contracts the person was shown, are kept in the person's desktop state (`apps`), so they return on the next visit and on another device; `consentNeeded` says when to ask again (another origin, or a scope or contract they were not shown), `setConsent` changes it, and removing and undoing carry the consent along. `scopesOf`, `originOf` and `isLocalOrigin` give an install sheet what to show.
- 5b7d8ee: `@tangleai/os/testing` runs the desktop without a browser for an application's own CI: `checkSuite` reports what keeps a suite document from joining (not a suite, an id listed twice or reserved, a contract two applications provide, a page on the desktop's origin, an invalid manifest, capabilities that disagree) and warns about a required contract nothing provides; `createTestDesktop` joins the suite with consent as a person's link would (narrowed per application), serves its contracts with the test's handlers, and files and decides proposals through the inbox's own path.

### Patch Changes

- Updated dependencies [5b7d8ee]
- Updated dependencies [42ec33b]
- Updated dependencies [5b7d8ee]
  - @tangleai/models@0.56.0
  - @tangleai/context@0.56.0
  - @tangleai/core@0.56.0
  - @tangleai/config@0.56.0
  - @tangleai/mas@0.56.0
  - @tangleai/outcomes@0.56.0

## 0.55.1

### Patch Changes

- 89f116e: A desktop loads Jaren's port transport when its first framed window opens instead of with the desktop. The shell waits for it before it hands a frame its ports, and a failed fetch fails that window, whose Retry fetches again. The kernel's `serveModule` and `connectProvider` stay synchronous for any other caller: until the transport arrives, what reaches a served port is held and handed over in order, and a client's calls wait for it. How much this saves depends on the host's bundler: with esbuild splitting chunks, a desktop of in-page modules loads about 25 KB less minified code up front (6 KB gzipped) and the 28 KB port chunk only with a framed window; a bundle built without splitting keeps it inline. `applyTheme` and `applyLocale` live in their own file, so the shell no longer imports the joining side.
- Updated dependencies [89f116e]
  - @tangleai/models@0.55.1
  - @tangleai/context@0.55.1
  - @tangleai/core@0.55.1
  - @tangleai/config@0.55.1
  - @tangleai/mas@0.55.1
  - @tangleai/outcomes@0.55.1

## 0.55.0

### Minor Changes

- d2ee7f0: Capabilities declare a domain once: its contract documents, its context reads, the kinds of proposal it files with their review policy, and a prompt pack in the person's languages (`CAPABILITY_SCHEMA`). The host installs them (`kernel.installCapability`, never in the user layer, since a prompt pack becomes the assistant's system text), and a module's manifest names the capabilities it files for, so every module of a domain files its kinds without a list of its own. A kind's policy says which origins may file it, which the kernel enforces, and which roles may decide it, which the inbox shows and hands to the module with the decision. `composeCapabilities` gives an assistant its system text, tools and context reads from them, deterministically, and `checkCapabilities` reports a missing capability or a kind declared twice. An older desktop refuses a manifest with `capabilities` and a page on an older release refuses a decision carrying `roles`; the protocol stays 1. No model was run on the prompt packs.
- a92d85b: Paused runs wait in the desktop's inbox. A proposal says who it comes from (`origin`: human, rule, import or ai) and may ask the person something (`answer: { schema, label }`): the inbox draws a form from the schema, the kernel checks the answer before it reaches the module that filed it as `{ decision: 'answer', response }`, and nothing gives the assistant a way to answer. `@tangleai/mas/inbox` turns a run's waiting interactions into such proposals on the application's server and an answer back into the interaction's response with a derived response key (a rejection cancels it); `listWaitingInteractions` lists the waits by status, with no table change. An older desktop refuses a proposal with `origin` or `answer`, and an older page refuses an `answer` decision; the protocol stays 1.

### Patch Changes

- Updated dependencies [d2ee7f0]
- Updated dependencies [a92d85b]
  - @tangleai/models@0.55.0
  - @tangleai/context@0.55.0
  - @tangleai/core@0.55.0
  - @tangleai/config@0.55.0
  - @tangleai/mas@0.55.0
  - @tangleai/outcomes@0.55.0

## 0.54.0

### Minor Changes

- 29a4004: The desktop keeps its state (the person's dock, the settings they set for applications, and the host's own preferences) as revisioned JSON documents in one store the host chooses: the browser (`webStorageStore`), its own server through the new `tangle_os_state` contract (`contractStore`), or the signed-in framed application (`createKernel({ state: { module } })`). It loads before anything in it can change, saves in the background one document at a time with retries, takes a document another device changed instead of overwriting it, and shows in the dock when it cannot load or save. `@tangleai/os/state-server` gives a server the `DESKTOP_STATE_MODEL` table for `@jarenjs/db` (SQLite or PostgreSQL), a compare-and-set repository interface and `serveDesktopState`, with the owner always taken from the server's session. The Pages desktop keeps its state in the browser; `createKernel({ settings })` still works.
- 29156a5: The dock is the person's own document: in edit mode they move icons, drop one on another to make a folder, rename folders, take icons out, and hide and show them, by pointer, menu or keyboard, kept with the desktop's state. A manifest may list launch entries, each its own dock icon opening the module at one of its screens (`connection.screen`, `onScreen`), and name the folders its icons start in (`dock.folders`); an older desktop refuses a manifest with those members. The assistant reads the dock and suggests a new arrangement through the kernel's `tangle_os_dock` contract; the suggestion waits in the inbox, shown as its changes, until the person accepts it. Modules may no longer take the ids `shell`, `person` or `desktop`.
- a59de21: The desktop has Files (`@tangleai/os/files`): the person's own files in this browser, offered by a host without a server, and every application's files through a file location it serves, made from one contract template (`fileLocationContract`: paged list and search, read inline or by a signed https address, and optional write, new folder, move and delete with refusals that keep their reason). Files browses with breadcrumbs, back, forward, up and search in its header bar, previews images, PDFs and text (and Markdown or other types through the host's previewers) without ever running a file as the desktop's markup, uploads, renames, moves and deletes. The assistant reads and searches through the kernel's `tangle_os_files` and never writes a location; a location can keep the assistant out. A manifest names its location with `files`. The Pages desktop offers "This browser" in its own folder of the browser's private file system and draws Markdown with `@jarenjs/md`.
- e99f017: A file in the desktop's Files opens in the application the person picks: a manifest lists the media types it `opens`, Files offers "Open in …" for each, and the desktop hands the file to the application's window, starting it when it is not running and waiting until it has joined. A framed page takes it at `onOpen`, a shipped module at `context.onOpen`, and either may refuse with a reason Files shows; `context.openFile` and `desktop.openFile` hand one over. The Pages Calendar opens iCalendar files and imports their events, counting what it cannot keep.

### Patch Changes

- Updated dependencies [29a4004]
- Updated dependencies [29156a5]
- Updated dependencies [a59de21]
- Updated dependencies [e99f017]
  - @tangleai/models@0.54.0
  - @tangleai/context@0.54.0
  - @tangleai/core@0.54.0
  - @tangleai/config@0.54.0
  - @tangleai/mas@0.54.0
  - @tangleai/outcomes@0.54.0

## 0.53.2

### Patch Changes

- Builds on Jaren 0.220.0, whose linq database client builds each handle on its first read instead of all at open, and whose `prepareModel` lets many stores open from one prepared model. Tangle reads its handles by name, so no behaviour changes beyond a lighter open; the pins, the foundation manifest and the integration audit move to the new release.
- Updated dependencies
  - @tangleai/models@0.53.2
  - @tangleai/context@0.53.2
  - @tangleai/core@0.53.2
  - @tangleai/config@0.53.2
  - @tangleai/mas@0.53.2
  - @tangleai/outcomes@0.53.2

## 0.53.1

### Patch Changes

- Builds on Jaren 0.219.1, a patch whose database owner lease is pinned to a SQLite file under every spelling of its path. Its source is unchanged, so no behaviour changes; the pins, the foundation manifest and the integration audit move to the new release.
- Updated dependencies
  - @tangleai/models@0.53.1
  - @tangleai/context@0.53.1
  - @tangleai/core@0.53.1
  - @tangleai/config@0.53.1
  - @tangleai/mas@0.53.1
  - @tangleai/outcomes@0.53.1

## 0.53.0

### Minor Changes

- f4868f0: Applications put their toolbar in their window's title bar: buttons, toggles, menus, tabs and a search field, described as a JSON document (`HEADER_SCHEMA`) and drawn by the desktop, so every bar follows the theme and the writing direction, works by keyboard and screen reader, and fits a narrow window by moving what does not fit into one "More" menu. A framed page calls `setHeader` and hears uses at `onHeader`; a shipped module has the same pair on its context. Every use, the person's and the assistant's, goes through the kernel's own `tangle_os_header` contract (`header.list`, `header.activate`) under grants and into the ledger; an item marked `assistant: false` is kept from the assistant. Calendar moves its month controls into its header bar and Settings its search.

### Patch Changes

- Updated dependencies [f4868f0]
  - @tangleai/models@0.53.0
  - @tangleai/context@0.53.0
  - @tangleai/core@0.53.0
  - @tangleai/config@0.53.0
  - @tangleai/mas@0.53.0
  - @tangleai/outcomes@0.53.0

## 0.52.6

### Patch Changes

- Builds on Jaren 0.219.0, whose `$date-format` writes a date on a named time zone's wall clock through an injected zone provider and whose clock arithmetic cuts a sub-millisecond fraction instead of rounding it. Tangle uses none of the date operators, so no behaviour changes; the pins, the foundation manifest and the integration audit move to the new release.
- Updated dependencies
  - @tangleai/models@0.52.6
  - @tangleai/context@0.52.6
  - @tangleai/core@0.52.6
  - @tangleai/config@0.52.6
  - @tangleai/mas@0.52.6
  - @tangleai/outcomes@0.52.6

## 0.52.5

### Patch Changes

- Builds on Jaren 0.218.0, whose HTTP contract server can refuse a query member an operation does not declare (`closedQuery`, off by default, not turned on here). The Pages desktop adds two applications from Jaren's `@jarenjs/calc`: Calculator (standard, scientific, programmer, financial and converter modes) and Converter (the same component in its converter mode alone, with live public currency rates and an offline table to fall back on), both in the desktop's language and theme.
- Updated dependencies
  - @tangleai/models@0.52.5
  - @tangleai/context@0.52.5
  - @tangleai/core@0.52.5
  - @tangleai/config@0.52.5
  - @tangleai/mas@0.52.5
  - @tangleai/outcomes@0.52.5

## 0.52.4

### Patch Changes

- An agent send no longer waits on the platform's digest before its first request. The run identity's SHA-256 values are now computed synchronously (equal to `sha256Hex` and `canonicalSha256` on the same input, so every identity keeps its value): a busy thread pool held each request back by an unbounded number of event-loop turns, and on a page without `crypto.subtle` (plain http other than localhost) every send was refused.
- Updated dependencies
  - @tangleai/models@0.52.4
  - @tangleai/context@0.52.4
  - @tangleai/core@0.52.4
  - @tangleai/config@0.52.4
  - @tangleai/mas@0.52.4
  - @tangleai/outcomes@0.52.4

## 0.52.3

### Patch Changes

- 5593e2d: An agent run can be resumed after a restart without a tool acting twice. A tool's context carries `call: { id, round, attempt }` (the provider's tool-call id, the round, and how often this agent ran that id), so a tool with an effect keys it by the id; `onCheckpoint` on a send is called after each round's tool results with a copy of the messages, the steps, the round and the spend, the point a host persists and resumes from.
- b351c19: Every agent result, and the partial result a rejected call carries, says what produced it: `identity` holds the SHA-256 of the base system prompt, the canonical SHA-256 of the listed tool definitions sorted by name, the tool names, the configured provider and model, and every model the provider reported answering. A host stores it beside the run so an evaluation names the prompt and tool versions it measured, and a changed prompt or schema shows as a changed digest. `@tangleai/agents` now depends directly on `@jarenjs/json`, which was already in its closure.
- Updated dependencies [5593e2d]
- Updated dependencies [b351c19]
  - @tangleai/models@0.52.3
  - @tangleai/context@0.52.3
  - @tangleai/core@0.52.3
  - @tangleai/config@0.52.3
  - @tangleai/mas@0.52.3
  - @tangleai/outcomes@0.52.3

## 0.52.2

### Patch Changes

- Builds on Jaren 0.217.0, whose database runs an existence test over a hop that pairs an equality with a comparison of two non-null columns as one native statement on SQLite and PostgreSQL. Tangle issues no such query, so no behaviour changes; the pins, the foundation manifest and the integration audit move to the new release.
- Updated dependencies
  - @tangleai/models@0.52.2
  - @tangleai/context@0.52.2
  - @tangleai/core@0.52.2
  - @tangleai/config@0.52.2
  - @tangleai/mas@0.52.2
  - @tangleai/outcomes@0.52.2

## 0.52.1

### Patch Changes

- Builds on Jaren 0.216.0, whose josl CSV writers can quote every field, the header included, on request. Tangle writes no CSV, so no behaviour changes; the pins, the foundation manifest and the integration audit move to the new release.
- Updated dependencies
  - @tangleai/models@0.52.1
  - @tangleai/context@0.52.1
  - @tangleai/core@0.52.1
  - @tangleai/config@0.52.1
  - @tangleai/mas@0.52.1
  - @tangleai/outcomes@0.52.1

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
  - @tangleai/context@0.52.0
  - @tangleai/core@0.52.0
  - @tangleai/config@0.52.0
  - @tangleai/mas@0.52.0
  - @tangleai/outcomes@0.52.0

## 0.51.3

### Patch Changes

- Build on Jaren 0.215.0, which compares a caller-written numeric key exactly on PostgreSQL.
- Updated dependencies
  - @tangleai/models@0.51.3
  - @tangleai/context@0.51.3
  - @tangleai/core@0.51.3
  - @tangleai/config@0.51.3
  - @tangleai/mas@0.51.3
  - @tangleai/outcomes@0.51.3

## 0.51.2

### Patch Changes

- Build on Jaren 0.214.0, which exports its host tokens as light and dark stylesheets and lets its component stylesheets follow the host's dark selection.
- Updated dependencies
  - @tangleai/models@0.51.2
  - @tangleai/context@0.51.2
  - @tangleai/core@0.51.2
  - @tangleai/config@0.51.2
  - @tangleai/mas@0.51.2
  - @tangleai/outcomes@0.51.2

## 0.51.1

### Patch Changes

- Build on Jaren 0.213.0, which renders an untrusted app document with its data bindings and granted widgets without a frame.
- Updated dependencies
  - @tangleai/models@0.51.1
  - @tangleai/context@0.51.1
  - @tangleai/core@0.51.1
  - @tangleai/config@0.51.1
  - @tangleai/mas@0.51.1
  - @tangleai/outcomes@0.51.1

## 0.51.0

### Patch Changes

- The desktop has one Settings for every application. `@tangleai/os/settings` is a Settings module a host installs with its own sections first and then one per application whose manifest declares `settings`: `mount` (a shipped module's own settings screen), `page` (an origin application's settings page, framed from its own origin and given no contract ports) or `form` (a document module's JSON Schema, whose values the desktop keeps through `createKernel({ settings })`, checked against the schema and never a secret). Applications keep their own values; the desktop is where the person finds them, with a search, from the window and dock menus, and from the application itself (`openSettings()` over its own port, no grant needed). The Pages desktop's Settings is this module, and the Calendar's working hours are a section of it.
- Updated dependencies
  - @tangleai/models@0.51.0
  - @tangleai/context@0.51.0
  - @tangleai/core@0.51.0
  - @tangleai/config@0.51.0
  - @tangleai/mas@0.51.0
  - @tangleai/outcomes@0.51.0

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
  - @tangleai/config@0.50.0
  - @tangleai/mas@0.50.0
  - @tangleai/outcomes@0.50.0

## 0.49.2

### Patch Changes

- Build on Jaren 0.207.0, whose assignment scoring covers one resource on one local civil day through an injected zone.
- Updated dependencies
  - @tangleai/models@0.49.2
  - @tangleai/context@0.49.2
  - @tangleai/core@0.49.2
  - @tangleai/config@0.49.2
  - @tangleai/mas@0.49.2
  - @tangleai/outcomes@0.49.2

## 0.49.1

### Patch Changes

- Build on Jaren 0.206.0, whose calendar reads iCalendar back into its model, compiles and embeds zone definitions and edits foreign iCalendar losslessly, and whose core scores assignments exactly.
- Updated dependencies
  - @tangleai/models@0.49.1
  - @tangleai/context@0.49.1
  - @tangleai/core@0.49.1
  - @tangleai/config@0.49.1
  - @tangleai/mas@0.49.1
  - @tangleai/outcomes@0.49.1

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
  - @tangleai/config@0.49.0
  - @tangleai/mas@0.49.0
  - @tangleai/outcomes@0.49.0

## 0.48.3

### Patch Changes

- Build on Jaren 0.201.0. Its calendar repeats monthly and yearly by the iCalendar standard, so the desktop Calendar now offers "Every month" and "Every year", and its editor says when a series skips a date that a month or year lacks. The Pages playground is now built on Jaren's play host kit instead of a copy of Jaren's site: a saved or shared session no longer carries a message language and opens in its reader's, and an example made to show one language shows it for its own run.
- Updated dependencies
  - @tangleai/models@0.48.3
  - @tangleai/context@0.48.3
  - @tangleai/core@0.48.3
  - @tangleai/config@0.48.3
  - @tangleai/mas@0.48.3
  - @tangleai/outcomes@0.48.3

## 0.48.2

### Patch Changes

- Build on Jaren 0.199.0, whose calendar (`@jarenjs/core/calendar`), iCalendar writer (`@jarenjs/josl/ical`) and calendar-scheduled database jobs arrive in these releases. The Pages desktop gains a Calendar built on them: a month view, a day panel and an editor, recurring events with skipped days, "find a time" over the person's working hours that never offers unknown time, an iCalendar export, and a `calendar` contract (agenda, add, free) that the assistant and other applications use as tools.
- Updated dependencies
  - @tangleai/models@0.48.2
  - @tangleai/context@0.48.2
  - @tangleai/core@0.48.2
  - @tangleai/config@0.48.2
  - @tangleai/mas@0.48.2
  - @tangleai/outcomes@0.48.2

## 0.48.1

### Patch Changes

- Build on Jaren 0.193.1. Its `sha256Hex` replaces the nine local SHA-256 helpers, each keeping its name, with identical digests. MAS caches compiled embedded schemas with Jaren's semantic cache, which now remembers the key of a frozen tree: 0.31 µs per lookup against 22.8 µs before. The Studio authoring gate now refuses an element written as an object and names an unknown operator with the nearest known one. The Studio file author sends an open profile in the prompt to an Anthropic model, which refuses an output schema with an open object, so the Pages Studio assistant no longer fails with HTTP 400 on the default model. The assistant's Japanese and Traditional Chinese packs use Jaren's 「…」 permalink wording.
- Updated dependencies
  - @tangleai/models@0.48.1
  - @tangleai/context@0.48.1
  - @tangleai/core@0.48.1
  - @tangleai/config@0.48.1
  - @tangleai/mas@0.48.1
  - @tangleai/outcomes@0.48.1

## 0.48.0

### Minor Changes

- Make Tangle OS the Pages site. Studio, Playground, Flow, Data, the adventure, the memory loop and moving browser data are desktop applications now, beside Welcome, the assistant, Settings and the to-do module; the assistant uses the work applications' authoring tools, and a former page link opens its application. `@tangleai/os` adds theme kits (`THEME_KITS`, `composeTheme`): each is one JSON document with light and dark palettes, a procedural wallpaper and a shape, and a person's changes (accent, highlight, pattern, seed, density, glass, corners, spacing) compose into an ordinary theme document that can be exported and imported. Five procedural wallpapers (`PATTERNS`, `patternBackground`: woven threads, contours, a two-ink halftone, a sun print and moiré tides) are drawn deterministically from a seed in the theme's own colours. Windows are laid out above the dock.

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.48.0
  - @tangleai/context@0.48.0
  - @tangleai/core@0.48.0
  - @tangleai/config@0.48.0
  - @tangleai/mas@0.48.0
  - @tangleai/outcomes@0.48.0

## 0.47.0

### Minor Changes

- Add `@tangleai/os`, a browser operating system for applications built on Jaren and Tangle. A module is a JSON manifest plus the contract operations it serves and needs; the desktop hosts it as a shipped component, as a jaren-app document in a sandboxed opaque-origin frame, or as an application's own page on its own origin that joins with `connectToOs` from `@tangleai/os/module`. The kernel installs modules in shipped, suite and user layers with RFC 6902 patches, keeps a journal with undo and a recovery boot, routes every call between modules as a contract operation under grants into a ledger, carries mail, and lists every granted operation as an assistant tool. The assistant's model placeholder and the documentation now name only the models that write Jaren's JSON documents reliably: `anthropic/claude-haiku-5.5`, and Qwen 3.7 27B or larger. The desktop has context menus on its background, title bars and dock, minimized windows now actually hide, and `mountDesktop` takes `themeFor` and `onSchemeSwitch` so a host's own colours survive the dock's light/dark switch. The Pages desktop ships an Assistant window and a Settings app: provider, OpenRouter key (kept in this browser, optionally for the tab only), region, a model picker over OpenRouter's catalogue, appearance, and forgetting what the browser keeps.

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.47.0
  - @tangleai/context@0.47.0
  - @tangleai/core@0.47.0
  - @tangleai/config@0.47.0
  - @tangleai/mas@0.47.0
  - @tangleai/outcomes@0.47.0

## 0.46.0

### Patch Changes

- Build on Jaren 0.188.0. Its validator keeps the text a schema's `errorMessage` wrote in every locale, a `$msgid` fallback included, and a validation error's `toJSON` carries that mark; `diffContracts` reports fewer false and more real breaking changes; `@jarenjs/db` reads a PostgreSQL `jsonb` null as SQL NULL and names unguarded number columns in `introspect()`. Every exact `@jarenjs/*` pin moves from 0.184.2 to 0.188.0, and the candidate tarballs are recaptured from the tagged source with an empty patch. Local copies of canonical cloning and RFC 6901 token escaping are replaced by `@jarenjs/json`'s `cloneJson` and pointer helpers, with identical output.
- Updated dependencies
  - @tangleai/config@0.46.0
  - @tangleai/context@0.46.0
  - @tangleai/core@0.46.0
  - @tangleai/mas@0.46.0
  - @tangleai/models@0.46.0
  - @tangleai/outcomes@0.46.0

## 0.45.2

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.45.2
  - @tangleai/outcomes@0.45.2
  - @tangleai/config@0.45.2
  - @tangleai/context@0.45.2
  - @tangleai/mas@0.45.2
  - @tangleai/models@0.45.2

## 0.45.1

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.45.1
  - @tangleai/outcomes@0.45.1
  - @tangleai/config@0.45.1
  - @tangleai/context@0.45.1
  - @tangleai/mas@0.45.1
  - @tangleai/models@0.45.1

## 0.45.0

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangleai/context@0.45.0
  - @tangleai/models@0.45.0
  - @tangleai/core@0.45.0
  - @tangleai/mas@0.45.0
  - @tangleai/outcomes@0.45.0
  - @tangleai/config@0.45.0

## 0.44.0

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.44.0
  - @tangleai/config@0.44.0
  - @tangleai/context@0.44.0
  - @tangleai/mas@0.44.0
  - @tangleai/models@0.44.0
  - @tangleai/outcomes@0.44.0

## 0.43.1

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.43.1
  - @tangleai/config@0.43.1
  - @tangleai/context@0.43.1
  - @tangleai/mas@0.43.1
  - @tangleai/models@0.43.1
  - @tangleai/outcomes@0.43.1

## 0.43.0

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.43.0
  - @tangleai/outcomes@0.43.0
  - @tangleai/config@0.43.0
  - @tangleai/context@0.43.0
  - @tangleai/mas@0.43.0
  - @tangleai/models@0.43.0

## 0.42.1

### Patch Changes

- Updated dependencies
  - @tangleai/mas@0.42.1
  - @tangleai/config@0.42.1
  - @tangleai/context@0.42.1
  - @tangleai/core@0.42.1
  - @tangleai/models@0.42.1
  - @tangleai/outcomes@0.42.1

## 0.42.0

### Minor Changes

- Move every package onto the Jaren 0.161.0 foundation, consumed as candidate tarballs rebuilt byte for byte from the pinned source because npm does not serve that release. Absorb its typed check outcomes, stage-discriminated guarded commits, strict retry options and typed migration plans; remove the two declaration bridges its corrected LINQ declarations make unnecessary; re-derive the paid memory policy report's interval statistics under its corrected nearest-rank quantile, which changes the default policy's provenance report id but no selection, decision or default value; and raise the program pen bundle ceiling to 29,000 bytes for the larger captured-expression module.

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.42.0
  - @tangleai/mas@0.42.0
  - @tangleai/context@0.42.0
  - @tangleai/outcomes@0.42.0
  - @tangleai/config@0.42.0
  - @tangleai/core@0.42.0

## 0.41.0

### Patch Changes

- @tangleai/config@0.41.0
  - @tangleai/context@0.41.0
  - @tangleai/core@0.41.0
  - @tangleai/mas@0.41.0
  - @tangleai/models@0.41.0
  - @tangleai/outcomes@0.41.0

## 0.40.0

### Patch Changes

- Updated dependencies [a8765d5]
- Updated dependencies [1beddfc]
  - @tangleai/outcomes@0.40.0
  - @tangleai/config@0.40.0
  - @tangleai/context@0.40.0
  - @tangleai/core@0.40.0
  - @tangleai/mas@0.40.0
  - @tangleai/models@0.40.0

## 0.39.0

### Patch Changes

- @tangleai/config@0.39.0
  - @tangleai/context@0.39.0
  - @tangleai/core@0.39.0
  - @tangleai/mas@0.39.0
  - @tangleai/models@0.39.0
  - @tangleai/outcomes@0.39.0

## 0.38.0

### Patch Changes

- accf91e: Bind research experiments to immutable workspaces and execution manifests, independently reproduce registered metrics, and preserve replicate receipts through native workflow recovery. Expose bounded native process settlement evidence to injected hosts without changing existing runner outcomes.
- Updated dependencies [e6a6f5c]
- Updated dependencies [e229e63]
- Updated dependencies [8a5af48]
  - @tangleai/mas@0.38.0
  - @tangleai/core@0.38.0
  - @tangleai/outcomes@0.38.0
  - @tangleai/config@0.38.0
  - @tangleai/context@0.38.0
  - @tangleai/models@0.38.0

## 0.37.0

### Patch Changes

- Updated dependencies [364b336]
  - @tangleai/core@0.37.0
  - @tangleai/outcomes@0.37.0
  - @tangleai/config@0.37.0
  - @tangleai/context@0.37.0
  - @tangleai/mas@0.37.0
  - @tangleai/models@0.37.0

## 0.36.0

### Patch Changes

- Updated dependencies [43cfab8]
  - @tangleai/mas@0.36.0
  - @tangleai/config@0.36.0
  - @tangleai/context@0.36.0
  - @tangleai/core@0.36.0
  - @tangleai/models@0.36.0
  - @tangleai/outcomes@0.36.0

## 0.35.0

### Patch Changes

- @tangleai/config@0.35.0
  - @tangleai/context@0.35.0
  - @tangleai/core@0.35.0
  - @tangleai/mas@0.35.0
  - @tangleai/models@0.35.0
  - @tangleai/outcomes@0.35.0

## 0.34.0

### Patch Changes

- Updated dependencies [c643e1e]
- Updated dependencies [8e34634]
- Updated dependencies [2dce4bd]
- Updated dependencies [a542379]
  - @tangleai/mas@0.34.0
  - @tangleai/core@0.34.0
  - @tangleai/config@0.34.0
  - @tangleai/context@0.34.0
  - @tangleai/models@0.34.0
  - @tangleai/outcomes@0.34.0

## 0.33.0

### Patch Changes

- Updated dependencies [236b915]
- Updated dependencies [2d64db7]
  - @tangleai/models@0.33.0
  - @tangleai/outcomes@0.33.0
  - @tangleai/context@0.33.0
  - @tangleai/mas@0.33.0
  - @tangleai/config@0.33.0
  - @tangleai/core@0.33.0

## 0.32.0

### Patch Changes

- Updated dependencies [a2b9c9d]
  - @tangleai/mas@0.32.0
  - @tangleai/config@0.32.0
  - @tangleai/context@0.32.0
  - @tangleai/core@0.32.0
  - @tangleai/models@0.32.0
  - @tangleai/outcomes@0.32.0

## 0.31.0

### Minor Changes

- c3e72e6: Complete conditional experiment workflows over durable MAS jobs, preserve settled worker evidence across response loss, and match effect responses to their own stages. Registry consumers now await evolveRegistryDocument with the workflow profile and experiment ceiling to pin its embedded graph versions.

  Add deterministic strategy selectors and an injected, budgeted structured proposal seam. Publish the registered keyless selection comparison with an inconclusive result and retain the unranked default. Surface workspace census and effect-job lease failures.

  Semantic key kinds now reject empty values, whitespace and NUL with TEVO1001 in both evolve stores, preventing namespace collisions. Existing valid key encodings and opaque key values remain compatible.

### Patch Changes

- @tangleai/config@0.31.0
  - @tangleai/context@0.31.0
  - @tangleai/core@0.31.0
  - @tangleai/mas@0.31.0
  - @tangleai/models@0.31.0
  - @tangleai/outcomes@0.31.0

## 0.30.1

### Patch Changes

- @tangleai/config@0.30.1
  - @tangleai/context@0.30.1
  - @tangleai/core@0.30.1
  - @tangleai/mas@0.30.1
  - @tangleai/outcomes@0.30.1

## 0.30.0

### Minor Changes

- Move onto the Jaren 0.91.3 registry foundation and source pin, and consume what
  it delivers instead of keeping local copies. The paired bootstrap behind the
  policy, grounding and consolidation intervals is now the suite's
  `pairedBootstrap`, with the same intervals bit for bit. Consolidation's rank
  fusion is the suite's `reciprocalRankFusion`, so equal fused scores now order by
  code point id rather than by first appearance; the hybrid rows move by at most
  0.002 recall. The evolve host's process runner keeps its refusal codes but
  runs on the suite's named-process executor: a request whose signal is
  already aborted is refused before spawning, and a process group's remaining
  members are killed when its leader exits. A desktop run stream now opens on a
  snapshot whose event id is the last frame it holds, so a reconnect right after
  it repeats nothing, and the UI no longer de-duplicates frames or threads a
  resume cursor through its document. Emitted contract bundles end with a single
  newline. Every keyless benchmark document is requalified against the new
  foundation.

  Migration: `createProcessRunner` no longer accepts a `clock` option. The
  executor times each run, so drop the option; `durationMs` is the executor's
  figure. Callers of `fuseConsolidationRanks` that relied on first-appearance
  order for equal scores now get code point id order.

### Patch Changes

- @tangleai/outcomes@0.30.0
  - @tangleai/config@0.30.0
  - @tangleai/context@0.30.0
  - @tangleai/core@0.30.0
  - @tangleai/mas@0.30.0

## 0.29.8

### Patch Changes

- @tangleai/config@0.29.8
  - @tangleai/context@0.29.8
  - @tangleai/core@0.29.8
  - @tangleai/mas@0.29.8
  - @tangleai/outcomes@0.29.8

## 0.29.7

### Patch Changes

- Two experiments the durable lifecycle cannot finish are now driven and pinned rather than described, because the shapes turned out to differ and one of them was worse than suspected. A refused proposal parks on `await-isolate` and stays there: nothing was dispatched, so nothing will ever be enqueued, so no worker will ever be told to answer it — the refusal is still free, which is the one property the failure does not cost, but the run does not reach its record. A red-gate proposal does not park at all; it FAILS `TMAS2003`, "a 'interaction' node requires the control host", at `await-gate-rerun`, because the flake switch's branch owns that wait and a branch's members are executed as a dag subregion. The flake branch was therefore not merely unexercised but a live defect on every red-gate row. Together that is nine refused proposals of the sixteen registered plus every red-gate one, so the path completes only experiments that skip no stage — the clean end-to-end run passes because its proposal happens to run all of them. Both tests exist to be deleted: the fix is to make the effect middle a subgraph, which gets its own region walk, and when both of these become ordinary completed runs the restructure is done. No package source changed.
- @tangleai/config@0.29.7
  - @tangleai/context@0.29.7
  - @tangleai/core@0.29.7
  - @tangleai/mas@0.29.7
  - @tangleai/outcomes@0.29.7

## 0.29.6

### Patch Changes

- A crash matrix over the durable path — seven boundaries, each killed once and driven to convergence against a real repository and the real queue — found four things no unit test could. `createEffectDriver` closed the operation's job the moment the effect finished, which is right when the driver claimed that job and wrong when a worker supplied a lease: the worker still has to answer a wait, and a job closed first leaves that wait standing with nothing claimable behind it, so the documented "a crash between running and answering costs nothing" was false for want of a next pass; whoever claims the job now closes it, and the worker closes it only once the answer has landed. The worker also called an ordinary race unresolved — a dispatch writes the intent and its job in one transaction and the run parks on the paired wait a moment later, so a worker claiming in between finds nothing waiting — which escalated a routine timing overlap to a person; `WorkerPass` gained `deferred` for it, and such a job is simply left for its lease to lapse. A worker answering a base sample batch from a replay was re-sealing a batch it had not taken, spending processes to compare the base root to itself and report a seal that held about work done in another process; it now reports `sealHeld: null`, and the readback reads anything but `true` as uncertain, because nobody can say whether the base held while a batch somebody else ran was running, and reading a missing seal as fine would excuse exactly the failure a seal exists for. The fourth finding is not fixed and is named rather than implied: an interaction node waits once a run reaches it whether or not its dispatch wrote anything for a worker to answer, so a run that skips a stage parks forever — which is nine of the sixteen registered proposals, refused before anything runs, plus every red-gate one; a switch cannot guard it, because the partitioner carves branch members into a dag subregion and an interaction needs the control host, and a test now pins the exact six waits that carry the defect so the fix can be checked against a list. `EvolveEffectWorkerOptions.jobs` requires `complete`, and the sixteen registered rows are unchanged throughout.
- @tangleai/config@0.29.6
  - @tangleai/context@0.29.6
  - @tangleai/core@0.29.6
  - @tangleai/mas@0.29.6
  - @tangleai/outcomes@0.29.6

## 0.29.5

### Patch Changes

- The lifecycle version can now complete a run, which the released one could not. It authored a settle stage as a dispatch paired with a typed wait, but settling removes a worktree and deletes a branch — three spawns — so the dispatch did the work synchronously and nothing ever enqueued a job for the wait beside it; a run reached that wait and parked forever, and every unit test passed. Settling is a reconciler over stopped runs instead, `reconcileStoppedExperiments`, which is the conclusion cancellation had already reached for the same reason stated one way — a stopped run executes no further segment — and which is just as true of a completed one; `reconcileCancelledExperiments` is now its cancelled case. Two further defects only an end-to-end run could find: the envelope schema declared `decision`, `gate`, `rerun` and `fitness` non-nullable and so refused the very envelope every run is created with, failing in the first segment; and the handler registry declared the `json-schema` message adapter at a version no host binds, which validation accepts and runtime compilation refuses. The worker no longer expects a dispatch to hand it anything, because the fenced store owns the operation's job and writes its payload itself — it reads the plan out of the effect record and, through the new `createEffectAddressing`, answers the wait the run is actually parked on rather than one assembled from a stage name, which would address nothing for the rerun inside the flake branch, and refuses to answer at all when the run is parked on none or on more than one. A host built against the previous worker will not compile: `EvolveEffectWorkerOptions` gained required `effects` and `addressing`, `LifecycleJobQueue` is gone because preparing the intent is what enqueues, and `LifecycleContext` no longer takes a job queue, a settle duck or a run id. One experiment now runs end to end over a real repository, the real MAS runtime, the real queue and the real fenced store to a completed run with the registered verdict and the published leg census.
- @tangleai/config@0.29.5
  - @tangleai/context@0.29.5
  - @tangleai/core@0.29.5
  - @tangleai/mas@0.29.5
  - @tangleai/outcomes@0.29.5

## 0.29.4

### Patch Changes

- Pin the lifecycle version against a real store, and describe the capability where a stranger would look for it. The authored version stores under the identity the author computed, storing identical bytes twice is a read, a run binds the exact version it will run under, and no head is ever activated — an active head is a moving target, and experiments run under a moving target are not comparable with each other, which is the whole reason this package registers one immutable version instead. The resume path is the suite's own reconciler and this package adds no second one; with nothing pending it reports zeros twice over. The architecture document gains the section that says what never happens and why each of those is structural rather than guarded, the boundary document records that the worktree lifecycle and the bounded runner are Tangle-owned because the suite has neither, and names the upstream ask as a bounded process runner with nothing git-shaped above it, and the mutator surface policy is listed as something that must never migrate down: migrated into a general-purpose suite it would become a configurable file filter, which is the same mechanism with the argument removed. The roadmap entry is narrowed to what is actually still open, which corrects a claim that had spread to five separate files before anybody checked whether the round comparator had a caller: acceptance is still decided one experiment at a time, the comparator is published but nothing consults it, the instrument still drives the stages sequentially rather than through the workflow version, and nothing has been measured against a repository that was not the fixture.
- @tangleai/config@0.29.4
  - @tangleai/context@0.29.4
  - @tangleai/core@0.29.4
  - @tangleai/mas@0.29.4
  - @tangleai/outcomes@0.29.4

## 0.29.3

### Patch Changes

- Add the effect worker, cancellation and the read-only contract, and prove the durable path counts what the sequential one counts. The worker claims an experiment's effect job, runs it under the lease the workflow segment is deliberately not given, and answers the typed wait — using the effect record id as the response key, which is what makes a crash between running and answering cost nothing: the next pass prepares the same semantic plan id, finds every leg settled, replays without spawning and answers with the same key, so the store reads it as the same response rather than a conflict. The one case it will not answer is an unresolved leg; the wait stands and a person reconciles it, because inventing a settlement would turn "nobody can account for this" into a confident record. `cancelExperiment` is a host call rather than a wire operation, and the cleanup after it is a reconciler rather than a node, because a cancelled run executes no further segment and a cleanup node would simply never fire — the second reconciliation pass examines the same runs and settles none. The decision vocabulary is not widened for it: an operator cancel is `abandoned` / `command` / `TEVO1006` and an expiry is `abandoned` / `over-budget` / `TEVO1005`, while who asked lives in the run trace and never on the decision, which has no member for it. The published contract is three operations and all three are reads, with no operation that merges, promotes, approves, runs, cancels or stops an experiment — absent rather than guarded — and a frozen baseline the gate compares against, so adding one is a refused commit rather than a quiet change; a review bundle answers its diff digest and byte count and never the diff text or what the gate printed. The equivalence check earned its place immediately: settling an experiment is cleanup rather than evidence and contributes no leg, so a kept experiment publishes ten legs and not eleven, and counting it would have moved every measured row and broken the campaign's oracle at the end of a long regeneration with nothing to point at.
- @tangleai/config@0.29.3
  - @tangleai/context@0.29.3
  - @tangleai/core@0.29.3
  - @tangleai/mas@0.29.3
  - @tangleai/outcomes@0.29.3

## 0.29.2

### Patch Changes

- Split each experiment stage into the half that starts work and the half that reads what it settled, and author the lifecycle version those halves will run under. The effect driver now exposes `prepare` beside `run`, and `run` accepts a lease a caller already holds: the durable path writes an effect intent in one process and claims its job in another, and a driver that always claimed its own job would double-claim against a fence that asserts the lease belongs to the plan. `runGate` and `measureFitness` keep their signatures and their behaviour, and are now compositions of `readGateResult` and `readMeasurement` — readbacks that touch no job and spawn nothing, so a resumed experiment reproduces its measurement instead of taking it again. `sealBaseRoot` and `baseSealHolds` are separated for the same reason: sealing the base spawns git, and the seal has to bracket the base batch rather than sit inside a step that also measures.

  The lifecycle workflow version is authored, validated and lowered, with its own handler registry: every stage that reaches a process is a task paired with a typed wait, because a segment holds no job lease and so no node may spawn. The base seal is deliberately not a node for exactly that reason — it belongs to the worker that runs the base batch. Authoring twice yields the same version id, since nothing in it reads a clock or a random source.

  Nothing drives this yet. There is no worker, the instrument still runs the sequential path, and the sixteen registered rows are unchanged — so this release adds no capability a host can use, only the shape the next one will need.
- @tangleai/config@0.29.2
  - @tangleai/context@0.29.2
  - @tangleai/core@0.29.2
  - @tangleai/mas@0.29.2
  - @tangleai/outcomes@0.29.2

## 0.29.1

### Patch Changes

- Refuse to compare two rounds that answered a different number of experiments. `compareRounds` read the score alone, and the score is kept over attempted where an experiment that never ran is not an attempt — so the count moved the ratio on its own, in both directions. A candidate that broke on the fifteen hard proposals and kept the one easy one scored 1/1 against an incumbent's 1/16 and was accepted; a candidate that padded the round with ten trivial proposals scored 11/26 against the same incumbent and was accepted too. Neither had repaired anything. That is the goalpost move the surface policy refuses in a patch, arriving through the scoreboard instead, and it is now refused on the same grounds: a score is evidence only while it is still answering the same question. The registration an experiment round runs over is immutable, so two legitimate rounds always attempt the same count, and an inequality means something changed that the score cannot see — the incumbent stands. The published prose that said failures aggregate before anything is accepted is corrected in the same pass: the round score is evidence published beside the per-experiment decisions, nothing calls the comparator yet, and `planExperimentDecision` still owns every acceptance.
- Make the experiment runner's deadline reach the whole process tree. `child.kill()` signals one process, and a gate command is rarely one process — `node --test` runs each test file in its own worker. So a gate that outran its deadline had its root killed and its workers left alive, reparented to init, each holding a CPU for as long as the machine stayed up, while the runner reported a tidy `SIGKILL` and a correct `TEVO1005`: the leak was invisible precisely where the deadline was supposed to be the proof that nothing escaped. The registered experiment pool contains a proposal whose whole purpose is to make the gate hang, so every run of the instrument leaked workers. The child is now spawned as its own process-group leader and the deadline signals the group by negative pid, with the single-process kill kept as the fallback and as the only option on Windows. A regression test spawns a grandchild that would outlive its parent and asserts it is gone after the deadline fires.
- @tangleai/config@0.29.1
  - @tangleai/context@0.29.1
  - @tangleai/core@0.29.1
  - @tangleai/outcomes@0.29.1

## 0.29.0

### Minor Changes

- c9fbe66: Add the contracts an isolated repository experiment is made of, as a zero-I/O package that cannot merge anything. Every record is closed and content-addressed — its id is the canonical hash of its own bytes without the id, and no clock enters that hash, so the same experiment re-derived later has the same address and a replay can prove it read what it claims to have read. The lifecycle is one pure exhaustive table: every status and command pair is either the single legal target or a refusal pointing at `/status`, and the four terminal statuses accept nothing, so a stopped experiment cannot be nudged back into motion by a second command. A principal carries `propose`, `execute` and `approve` and the schema refuses a `merge`, `push` or `promote` member: the authority to land a change is absent from the vocabulary rather than defended at a call site, and keeping a change produces a branch and a review bundle for a person to merge. Budgets name every bound an experiment can reach, with `attemptsPerLeg` pinned at one, because a process boundary that was lost is not evidence the effect did not happen. `EvolveStore` keeps immutable records apart from the one revision-fenced experiment row: writing the same bytes twice is a read, writing different bytes under an existing id is refused, and a status moves only under compare-and-swap — with an in-memory reference and a SQLite adapter whose answers are asserted identical over one recorded scenario. Strategies are written through the owners that already exist, one skill in the context ledger and one memory carrier in the outcome store, and a refusal from either is carried back with its own reason intact. The `evolve-experiment/v1` outcome adapter scores a kept change as success and an equal one as partial, and counts a refusal as a strategy failure rather than a neutral event.
- 97e0ae8: Close the loop: a committed candidate is now gated, measured, decided, settled and recorded, and the instrument reproduces its registered oracle exactly — sixteen of sixteen adversarial proposals landing on the decision written down before any of them could run. The gate reads its exit code and nothing else, because a child that can print can print a convincing success; what it printed is kept beside the record for a reviewer and hashed into no identity. A gate that FAILED and a gate that never finished are kept apart, which is what the whole flake policy rests on: a clean non-zero exit is red and earns exactly one rerun, while a run killed at its deadline, drowned in output, or over its workspace budget reached no verdict at all and earns none — calling it red would credit it with an opinion it never formed and spend the rerun on running out of budget again. Red then red is red, red then green is ambiguous, and both abandon; there is no third attempt. Fitness runs only behind a green gate, over the registered instrument, and a sample that cannot be read is a counted refusal rather than a retry, because re-running a sample until it parses is how a measurement quietly becomes a search for the answer somebody wanted. The base median must still equal the registered truth or every number in the run is unverifiable, flattering ones included — a candidate number is only evidence while the base still measures what it claims to. The base side runs in the repository root under its own allow-list name, bracketed before and after by a revision, cleanliness and byte-digest seal, so an instrument that writes into the base invalidates the run instead of the run publishing a comparison against a moving target. One pure planner decides, total over its input and without a default branch, with two orderings that are not arbitrary: an unresolved effect outranks everything, because deriving a tidy abandon from evidence nobody can account for would be the most dangerous available convenience; and over budget outranks red, for the reason above. Only a strict improvement is kept, and keeping one removes the worktree and leaves the branch unmerged with a review bundle addressed to a person — every other outcome leaves nothing but records, and an uncertain one is left exactly as it is for somebody to look at. What an experiment meant is recorded through the outcome lifecycle and nowhere else: the sealed decision is pinned evidence a trusted resolver supplies, an unresolvable citation is a refusal rather than empty evidence, confidence moves only inside the outcome service's own transaction, and a cited carrier that is missing is reported and refused rather than created on the way past. Promotion is not taken at all — the selection artifact keeps empty weights, and the automation principal is refused if it asks to approve.
- 3a58abf: Add the guarded patch path, and with it the first refusals this campaign can measure rather than describe. A proposal is an RFC 6902 patch over a file map and nothing else: `move` and `copy` are absent because a rename written as one operation would be invisible to every rename detection here, and `test` is absent because a patch that can assert can branch. The immutable surface is compiled from the repository record rather than the worktree, so nothing a patch writes can reach the rules that judge it — a mutator cannot move goalposts that are not in the tree it edits. Five detections run in order, each naming its rule: a path that does not normalize or that case-folds onto another, a direct edit of a protected or generated file, a rename caught by identical content or a reappearing basename, a symlink among the changes, and a budget in bytes or files. The rename check runs a second time over git's own staged view, because the first is structurally blind to a rename made between reading the file map and writing it. The patch itself is applied on a copy through the suite's guarded editor — the one consumer of it in this package — whose failure keeps the engine's own code and pointer as the cause, and whose commit refuses outright, because preparation never writes: the host applies the plan as a recorded effect instead.
- c9fbe66: Add the Node-only host that runs an experiment without ever holding the authority to land one. A command is selected by name from a table the host wrote, so nothing that crossed a trust boundary can become an executable, an argument a validator did not accept, a working directory outside the declared root — checked after resolving both ends, so a symlink cannot walk out — or an environment variable the allow-list does not carry. The git vocabulary is an allow-list of whole argument vectors: `push`, `merge`, `switch`, `checkout`, `reset`, `rebase`, `remote` and `config` are not refused, they are absent, and so are the global options that would let git run something else or somewhere else. A ref is either an experiment branch or a pinned commit; every other spelling fails before a spawn. The worktree host refuses a root inside the repository, a dirty base, a second experiment on an existing branch, a write that traverses out through `..` or a symlinked parent, and a commit whose HEAD is read at the moment of committing rather than assumed. A removal that does not succeed is uncertain rather than failed, because a workspace that may still exist is a question for a person. Every effect is one leg of a fenced operation over the suite's external-effect store on the Tangle database: the intent is written before anything reaches the world, the outcome is classified from exit codes and never from what the child printed, a single-send leg is never retried, and a plan id is semantic — so a resumed experiment reads what happened instead of making it happen again. The instrument's four host probes now execute rather than declaring themselves missing.
- 81c14e4: Add the layer that reads failures as evidence rather than as instructions. Deciding one experiment at a time is the whole of what this package did, and a mechanism built only on that would be optimizing against the wrong thing: any single failure has two possible causes and no way to tell them apart, so treating each one as a direct instruction to change bends the mechanism around whatever it happened to see, narrows what it will accept, and makes it worse at cases nobody showed it. What separates evidence about the mechanism from evidence about one instance is recurrence across distinct instances, so failures are grouped into patterns and a pattern is called systematic only when at least two unrelated instances produced it — an inductive bias, stated as one named threshold rather than buried, with single-instance patterns kept as evidence rather than discarded. Groups form at two levels that disagree on purpose: read by reason a lone escape or a lone red looks like a one-off, and rolled up by the stage that produced it the same stage turns out to be indicted by unrelated instances wearing different names. The share of failures that recur is published as the evidence that would license a mechanism-level repair at all; the share of changes that merely accommodate one model's quirks is deliberately not computed, because that number needs modification decisions to exist and nothing here modifies itself yet. Beside it, a round now reduces to one scalar, and a candidate is accepted only on a strict improvement of that scalar — per-instance acceptance cannot see a change that fixes the case in front of it while quietly breaking two others, and a tie is rejected because equal evidence is not a reason to move and keeping the incumbent is the cheaper error. Every part of it is pure and total: it reads decided rows and answers counts, runs no process, reads no file, and decides nothing about any individual experiment.

### Patch Changes

- @tangleai/config@0.29.0
  - @tangleai/context@0.29.0
  - @tangleai/core@0.29.0
  - @tangleai/outcomes@0.29.0
