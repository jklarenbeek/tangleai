# @tangleai/store

## 0.63.0

### Patch Changes

- @tangleai/config@0.63.0
  - @tangleai/core@0.63.0
  - @tangleai/documents@0.63.0
  - @tangleai/evolve@0.63.0
  - @tangleai/experiential@0.63.0
  - @tangleai/forecast@0.63.0
  - @tangleai/grounding@0.63.0
  - @tangleai/hera@0.63.0
  - @tangleai/lightrag@0.63.0
  - @tangleai/mas@0.63.0
  - @tangleai/memory@0.63.0
  - @tangleai/outcomes@0.63.0
  - @tangleai/research@0.63.0
  - @tangleai/trace2skill@0.63.0
  - @tangleai/trading@0.63.0

## 0.62.6

### Patch Changes

- The release check refuses committed release digests built from other inputs, so a clean clone's release build leaves the tracked tree unchanged; this release's digests equal a fresh build's. The guides point to one architecture document, and the files the build reads live in `jaren/`.
- @tangleai/forecast@0.62.6
  - @tangleai/grounding@0.62.6
  - @tangleai/hera@0.62.6
  - @tangleai/lightrag@0.62.6
  - @tangleai/mas@0.62.6
  - @tangleai/outcomes@0.62.6
  - @tangleai/research@0.62.6
  - @tangleai/trace2skill@0.62.6
  - @tangleai/config@0.62.6
  - @tangleai/core@0.62.6
  - @tangleai/documents@0.62.6
  - @tangleai/evolve@0.62.6
  - @tangleai/memory@0.62.6
  - @tangleai/experiential@0.62.6
  - @tangleai/trading@0.62.6

## 0.62.5

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.62.5
  - @tangleai/documents@0.62.5
  - @tangleai/evolve@0.62.5
  - @tangleai/grounding@0.62.5
  - @tangleai/lightrag@0.62.5
  - @tangleai/memory@0.62.5
  - @tangleai/outcomes@0.62.5
  - @tangleai/experiential@0.62.5
  - @tangleai/forecast@0.62.5
  - @tangleai/hera@0.62.5
  - @tangleai/research@0.62.5
  - @tangleai/trace2skill@0.62.5
  - @tangleai/config@0.62.5
  - @tangleai/mas@0.62.5
  - @tangleai/trading@0.62.5

## 0.62.4

### Patch Changes

- a285816: A benchmark report records the Tangle release it was measured with, and no longer has to equal the current one: the trading and trace2skill rebuilds take the committed report's suite, and their checks require only that the Jaren foundation is this one; CGT compares its runtime without the release. Every source-bound benchmark artifact is regenerated once under the identity that leaves Tangle's version strings out, so a version-only release now regenerates none.
- Updated dependencies [a285816]
  - @tangleai/core@0.62.4
  - @tangleai/config@0.62.4
  - @tangleai/mas@0.62.4
  - @tangleai/documents@0.62.4
  - @tangleai/memory@0.62.4
  - @tangleai/outcomes@0.62.4
  - @tangleai/trace2skill@0.62.4
  - @tangleai/evolve@0.62.4
  - @tangleai/hera@0.62.4
  - @tangleai/forecast@0.62.4
  - @tangleai/grounding@0.62.4
  - @tangleai/lightrag@0.62.4
  - @tangleai/trading@0.62.4
  - @tangleai/research@0.62.4
  - @tangleai/experiential@0.62.4

## 0.62.3

### Patch Changes

- b4acfd5: Source receipts hash a package manifest and the lockfile without Tangle's own version strings (each package's `version` and every `@tangleai/*` pin), so a version-only release no longer re-identifies the benchmark artifacts that list them; every other byte, Jaren's pins included, still counts.
- Updated dependencies [b4acfd5]
  - @tangleai/core@0.62.3
  - @tangleai/config@0.62.3
  - @tangleai/mas@0.62.3
  - @tangleai/documents@0.62.3
  - @tangleai/memory@0.62.3
  - @tangleai/outcomes@0.62.3
  - @tangleai/trace2skill@0.62.3
  - @tangleai/evolve@0.62.3
  - @tangleai/hera@0.62.3
  - @tangleai/forecast@0.62.3
  - @tangleai/grounding@0.62.3
  - @tangleai/lightrag@0.62.3
  - @tangleai/trading@0.62.3
  - @tangleai/research@0.62.3
  - @tangleai/experiential@0.62.3

## 0.62.2

### Patch Changes

- 0548b16: A settle records a cleanup receipt, so a terminal experiment no longer stands for a cleaned workspace by itself. `settleExperiment` writes a `cleanup-intent` key before its swap (the revision and status the swap produces, the workspace's instance token, whether the branch goes) and `cleanup-done` once the workspace is gone; `reconcileCleanups({ store, host })` finishes every intent without completion, only while the experiment sits where the swap left it and only for the workspace instance the intent names, finishing each git step only if it is still needed. A workspace recreated at the same path is refused and left alone, and a completed cleanup is never reapplied. The worktree host gains `instance`, `pathOf` and an idempotent `finish`; `create` writes the instance token into the worktree's git administration directory, outside the tracked tree.
- Updated dependencies [0548b16]
  - @tangleai/core@0.62.2
  - @tangleai/config@0.62.2
  - @tangleai/mas@0.62.2
  - @tangleai/documents@0.62.2
  - @tangleai/memory@0.62.2
  - @tangleai/outcomes@0.62.2
  - @tangleai/trace2skill@0.62.2
  - @tangleai/evolve@0.62.2
  - @tangleai/hera@0.62.2
  - @tangleai/forecast@0.62.2
  - @tangleai/grounding@0.62.2
  - @tangleai/lightrag@0.62.2
  - @tangleai/trading@0.62.2
  - @tangleai/research@0.62.2
  - @tangleai/experiential@0.62.2

## 0.62.1

### Patch Changes

- 28b5d3c: Text bounds measure UTF-8 bytes with `utf8ByteLength` from `@jarenjs/core/string` instead of encoding the text with `TextEncoder`: forecast screening, classifier items, harness components, feedback items, guidance and skill instructions, the retrospective summary and `forecastBytes`; outcomes reflection and proposal text and `jsonBytes`; the research patch, artifact, lesson-proposal, workspace-path and CSV bounds; the trace2skill path and per-file bounds; the hera prompt byte cap; the run log's frame-body and replay-page bounds and the MAS trace budget; the temporal input ceiling; the context ledger's `jsonBytes`; an agent's default reservation estimate; and the experiential render budget. Every string measures as before, a lone surrogate as 3 bytes. Where a non-string can reach a bound, it is refused with that bound's own code rather than Jaren's TypeError: the volatile-fact classifier refuses a guidance item whose text is not a string with TFCT1001, and `validateFormat` refuses a file whose content is neither text nor null with TT2S1005 before `draftSize` measures it; the other raw-text bounds already refuse a non-string with their own code (TT2S1003 for a skill path, TRSH1006 for CSV input, the screening TypeError) or through the shape check that runs before them. The context ledger keeps counting a value JSON leaves out as 0 bytes, and the temporal ceiling keeps measuring a request body as its text.
- Updated dependencies [28b5d3c]
  - @tangleai/core@0.62.1
  - @tangleai/config@0.62.1
  - @tangleai/mas@0.62.1
  - @tangleai/documents@0.62.1
  - @tangleai/memory@0.62.1
  - @tangleai/outcomes@0.62.1
  - @tangleai/trace2skill@0.62.1
  - @tangleai/evolve@0.62.1
  - @tangleai/hera@0.62.1
  - @tangleai/forecast@0.62.1
  - @tangleai/grounding@0.62.1
  - @tangleai/lightrag@0.62.1
  - @tangleai/trading@0.62.1
  - @tangleai/research@0.62.1
  - @tangleai/experiential@0.62.1

## 0.62.0

### Minor Changes

- 59ee39c: `createStructuredOutput({ profile: 'strict' })` sends, on a `json_schema` tier, the schema's strict profile (`deriveStrictProfile` from `@jarenjs/validate/strict-profile`) with `strict: true`, maps each answer back and validates it against the original schema, which stays the authority. Measured with Claude Haiku 5.5: the provider refused 3 of 4 of the suite's schemas as they are and 1 of 4 as their profile (a grammar-size limit); every profile answer validated (docs/STRICT_PROFILE_BENCHMARK.md).

### Patch Changes

- 726d1ef: `bundleSchema` admits anchors: a reference to an `$anchor` or a fragment-only `$id` is resolved through `@jarenjs/validate/references`, as the validator resolves it, and bundled exactly as a pointer to the same schema would be, so every recorded request keeps its bytes. An anchor the resource does not declare is refused.
- Updated dependencies [726d1ef]
- Updated dependencies [59ee39c]
  - @tangleai/core@0.62.0
  - @tangleai/config@0.62.0
  - @tangleai/mas@0.62.0
  - @tangleai/documents@0.62.0
  - @tangleai/memory@0.62.0
  - @tangleai/outcomes@0.62.0
  - @tangleai/trace2skill@0.62.0
  - @tangleai/evolve@0.62.0
  - @tangleai/hera@0.62.0
  - @tangleai/forecast@0.62.0
  - @tangleai/grounding@0.62.0
  - @tangleai/lightrag@0.62.0
  - @tangleai/trading@0.62.0
  - @tangleai/research@0.62.0
  - @tangleai/experiential@0.62.0

## 0.61.1

### Patch Changes

- 0542a6b: A contradiction is resolved as one operation: `MemoryStore` gains an optional atomic `mutate({ put, delete })` (the in-memory store has it), which `resolveContradictions` uses to write the superseded loser and its synthesized resolution together; on a store without it the resolution is written first and taken back if the loser cannot be written. A loser already superseded, by the same winner in a replayed pass or by another in a concurrent one, is counted as an application skip and never written again, so a replay no longer stores a second resolution.
- a9a39ff: MAS head activation is fenced by revision as well as version: `activateWorkflow` and `activateTemplate` take an optional `expectedRevision`, an applied activation and `getActiveWorkflow` return the head's `revision`, and a token read before the head moved away and back to the same version (A→B→A) is refused (`TMAS2001` at `/revision`). Without the revision the version alone decides, as before.
- f92314c: A ledger recall by meaning through a storage adapter's `rank` counts a record the adapter ranked but that was deleted before the ledger read it: the result carries `missing` (when there is one) and counts it among the `skipped`, instead of dropping it silently.
- Updated dependencies [0542a6b]
- Updated dependencies [a9a39ff]
- Updated dependencies [f92314c]
  - @tangleai/core@0.61.1
  - @tangleai/config@0.61.1
  - @tangleai/mas@0.61.1
  - @tangleai/documents@0.61.1
  - @tangleai/memory@0.61.1
  - @tangleai/outcomes@0.61.1
  - @tangleai/trace2skill@0.61.1
  - @tangleai/evolve@0.61.1
  - @tangleai/hera@0.61.1
  - @tangleai/forecast@0.61.1
  - @tangleai/grounding@0.61.1
  - @tangleai/lightrag@0.61.1
  - @tangleai/trading@0.61.1
  - @tangleai/research@0.61.1
  - @tangleai/experiential@0.61.1

## 0.61.0

### Minor Changes

- d4629ba: The assistant can change an application it wrote for the person: `apps.read` gives it with a revision (refused with `OS0161` for any module not written for the person), and `apps.revise` offers a new version in the inbox against that revision, refused with `OS0112` when the application changed since, both when offered and when accepted. Accepted, the new version replaces the application, still asking for nothing, and its windows start again on it.

### Patch Changes

- Updated dependencies [d4629ba]
  - @tangleai/core@0.61.0
  - @tangleai/config@0.61.0
  - @tangleai/mas@0.61.0
  - @tangleai/documents@0.61.0
  - @tangleai/memory@0.61.0
  - @tangleai/outcomes@0.61.0
  - @tangleai/trace2skill@0.61.0
  - @tangleai/evolve@0.61.0
  - @tangleai/hera@0.61.0
  - @tangleai/forecast@0.61.0
  - @tangleai/grounding@0.61.0
  - @tangleai/lightrag@0.61.0
  - @tangleai/trading@0.61.0
  - @tangleai/research@0.61.0
  - @tangleai/experiential@0.61.0

## 0.60.1

### Patch Changes

- 248bf42: A table column a reply's Markdown aligns itself (`:---`, `---:`) now aligns to the reply's reading start and end, so it mirrors in a right-to-left reply: the assistant maps the `left` and `right` Jaren's renderer writes to `start` and `end`.
- Updated dependencies [248bf42]
  - @tangleai/core@0.60.1
  - @tangleai/config@0.60.1
  - @tangleai/mas@0.60.1
  - @tangleai/documents@0.60.1
  - @tangleai/memory@0.60.1
  - @tangleai/outcomes@0.60.1
  - @tangleai/trace2skill@0.60.1
  - @tangleai/evolve@0.60.1
  - @tangleai/hera@0.60.1
  - @tangleai/forecast@0.60.1
  - @tangleai/grounding@0.60.1
  - @tangleai/lightrag@0.60.1
  - @tangleai/trading@0.60.1
  - @tangleai/research@0.60.1
  - @tangleai/experiential@0.60.1

## 0.60.0

### Minor Changes

- 7f5cf01: The assistant can write an application for the person. The desktop's own contract `tangle_os_apps` gives it the crib (`apps.crib`), a check against the gate and its own probes (`apps.check`), and `apps.suggest`, which files the finished document in the person's inbox as the desktop's own proposal, refused (`OS0160`) when it does not pass the gate. The inbox says who wrote it and that it asks for nothing; when the person accepts, it joins their layer as a document module with no grants, opens, and runs in its sandboxed frame. The kernel loads the authoring code only when the assistant uses it, and the Pages assistant is told when and how to write one. Measured through that assistant (a headless desktop, its system prompt and the kernel's tools, one turn): every one of 32 plain requests, 16 in English and 16 in Dutch, ended with an application in the inbox that works when the person uses it (docs/AUTHORING_BENCHMARK.md).

### Patch Changes

- Updated dependencies [7f5cf01]
  - @tangleai/core@0.60.0
  - @tangleai/config@0.60.0
  - @tangleai/mas@0.60.0
  - @tangleai/documents@0.60.0
  - @tangleai/memory@0.60.0
  - @tangleai/outcomes@0.60.0
  - @tangleai/trace2skill@0.60.0
  - @tangleai/evolve@0.60.0
  - @tangleai/hera@0.60.0
  - @tangleai/forecast@0.60.0
  - @tangleai/grounding@0.60.0
  - @tangleai/lightrag@0.60.0
  - @tangleai/trading@0.60.0
  - @tangleai/research@0.60.0
  - @tangleai/experiential@0.60.0

## 0.59.0

### Minor Changes

- e36af9d: `@tangleai/os/authoring` is the model-free half of the assistant writing an application: `authoringCrib()` (the grammar rules, Jaren's own operator names, each compiled by a test, and a working to-do list), `gateAuthoredApp` (lint, compile, first frame: what to send back for repair), `checkAuthoredApp` with probes that use an application as a person would (a field or button found by its label, placeholder or text), and `authoredManifest`, a document module that asks for nothing. A new instrument, `benchmark/authoring.ts`, measures how often a plain request becomes an application that works when a person uses it: 22 of 24 with Claude Haiku 5.5 (docs/AUTHORING_BENCHMARK.md).

### Patch Changes

- Updated dependencies [e36af9d]
  - @tangleai/core@0.59.0
  - @tangleai/config@0.59.0
  - @tangleai/mas@0.59.0
  - @tangleai/documents@0.59.0
  - @tangleai/memory@0.59.0
  - @tangleai/outcomes@0.59.0
  - @tangleai/trace2skill@0.59.0
  - @tangleai/evolve@0.59.0
  - @tangleai/hera@0.59.0
  - @tangleai/forecast@0.59.0
  - @tangleai/grounding@0.59.0
  - @tangleai/lightrag@0.59.0
  - @tangleai/trading@0.59.0
  - @tangleai/research@0.59.0
  - @tangleai/experiential@0.59.0

## 0.58.1

### Patch Changes

- bdf7736: Choosing a language in Settings now outranks a `?lang=` the link carried, so the desktop starts again in the chosen one. A browser check proves that the assistant and Jaren's applications follow the one language choice, and that a right-to-left assistant reply mirrors its lists, quotes and table cells; a column the Markdown aligns itself keeps the physical side Jaren's renderer writes, as the assistant's README now says.
- Updated dependencies [bdf7736]
  - @tangleai/core@0.58.1
  - @tangleai/config@0.58.1
  - @tangleai/mas@0.58.1
  - @tangleai/documents@0.58.1
  - @tangleai/memory@0.58.1
  - @tangleai/outcomes@0.58.1
  - @tangleai/trace2skill@0.58.1
  - @tangleai/evolve@0.58.1
  - @tangleai/hera@0.58.1
  - @tangleai/forecast@0.58.1
  - @tangleai/grounding@0.58.1
  - @tangleai/lightrag@0.58.1
  - @tangleai/trading@0.58.1
  - @tangleai/research@0.58.1
  - @tangleai/experiential@0.58.1

## 0.58.0

### Minor Changes

- 2beaaeb: The Pages desktop speaks the twelve languages: every sentence of its own applications (Welcome, Settings' Providers, Models, Appearance and Privacy sections, the Calendar, To do, About, the memory loop and the Assistant window) comes from one catalogue with a pack per language, in the formal register of the chrome's and the assistant's packs. One choice in Settings → Appearance (the browser's language by default) feeds the shell, Settings, Files, the assistant, Jaren's applications and `Intl`, and Arabic mirrors the desktop; `?lang=` overrides it for a link. The theme kits and the memory pipeline's diagram are named in the person's language too. A browser check renders a sentinel pack over the desktop's own windows and finds no sentence outside a catalogue, and renders every pack and finds no English sentence left.

### Patch Changes

- Updated dependencies [2beaaeb]
  - @tangleai/core@0.58.0
  - @tangleai/config@0.58.0
  - @tangleai/mas@0.58.0
  - @tangleai/documents@0.58.0
  - @tangleai/memory@0.58.0
  - @tangleai/outcomes@0.58.0
  - @tangleai/trace2skill@0.58.0
  - @tangleai/evolve@0.58.0
  - @tangleai/hera@0.58.0
  - @tangleai/forecast@0.58.0
  - @tangleai/grounding@0.58.0
  - @tangleai/lightrag@0.58.0
  - @tangleai/trading@0.58.0
  - @tangleai/research@0.58.0
  - @tangleai/experiential@0.58.0

## 0.57.0

### Minor Changes

- ea954a3: The desktop's chrome speaks the eleven languages `@jarenjs/locales` ships besides English: `@tangleai/os/messages/<lang>` (`ar`, `de`, `es`, `fr`, `ja`, `ko`, `nl`, `pt`, `ru`, `tr`, `zh-tw`) is a pack of every sentence the shell, Settings, Files, the install sheet and Applications and access write, in the formal register the assistant's packs use. A host passes one as `messages` to `mountDesktop`, `settingsModule` and `filesModule` (the last two also take `locale`, so Settings, Files and "This browser" carry their names in that language); with Arabic and `dir: 'rtl'` the desktop mirrors. A browser check renders a sentinel pack and finds no chrome text outside the catalogue, and renders every pack and finds no English sentence left.

### Patch Changes

- 27d5ccd: An application the person removes (or whose joining they undo, or that another device removed) now takes what it served along: its contracts, header bars and deciders leave the kernel and its windows close, so its window can no longer answer the assistant, which under `assistantGrants: 'all'` it could before. A contract whose module is no longer on the desktop is no one's to call. A kept application is never restored over a contract another module declares. The install sheet opens with Cancel focused, so a stray Enter never consents, and two suites named at once show their sheets one after the other.
- Updated dependencies [27d5ccd]
- Updated dependencies [ea954a3]
  - @tangleai/core@0.57.0
  - @tangleai/config@0.57.0
  - @tangleai/mas@0.57.0
  - @tangleai/documents@0.57.0
  - @tangleai/memory@0.57.0
  - @tangleai/outcomes@0.57.0
  - @tangleai/trace2skill@0.57.0
  - @tangleai/evolve@0.57.0
  - @tangleai/hera@0.57.0
  - @tangleai/forecast@0.57.0
  - @tangleai/grounding@0.57.0
  - @tangleai/lightrag@0.57.0
  - @tangleai/trading@0.57.0
  - @tangleai/research@0.57.0
  - @tangleai/experiential@0.57.0

## 0.56.0

### Minor Changes

- 5b7d8ee: A link to a suite installs nothing by itself: `desktop.join(suite, { source })` shows the person an install sheet with each application's origin, the contracts it offers, the scopes it asks for (each a choice) and the assistant's access (off), and installs only what they add, kept in their state. An application joined before is updated without asking unless it now comes from another origin or asks for more. An application on this device or the local network says that the browser may ask about it, and its window says how to recover when that was refused. Settings has a section of the desktop's own, Applications and access: every application's origin, grants and recent calls, with switches for the scopes and the assistant's access of the ones the person added, and Remove. The Pages desktop joins `?suite=` links this way.
- 42ec33b: Applications a person joins are installed with their consent. `kernel.join(manifest, { scopes, assistant, source })` installs one in the person's layer and grants exactly the scopes they allowed out of what its manifest asks for; what it provides, its header bar and its file location reach the assistant only when they said so, also on a desktop that grants the assistant everything. The joined applications, each with the origin, scopes and contracts the person was shown, are kept in the person's desktop state (`apps`), so they return on the next visit and on another device; `consentNeeded` says when to ask again (another origin, or a scope or contract they were not shown), `setConsent` changes it, and removing and undoing carry the consent along. `scopesOf`, `originOf` and `isLocalOrigin` give an install sheet what to show.
- 5b7d8ee: `@tangleai/os/testing` runs the desktop without a browser for an application's own CI: `checkSuite` reports what keeps a suite document from joining (not a suite, an id listed twice or reserved, a contract two applications provide, a page on the desktop's origin, an invalid manifest, capabilities that disagree) and warns about a required contract nothing provides; `createTestDesktop` joins the suite with consent as a person's link would (narrowed per application), serves its contracts with the test's handlers, and files and decides proposals through the inbox's own path.

### Patch Changes

- Updated dependencies [5b7d8ee]
- Updated dependencies [42ec33b]
- Updated dependencies [5b7d8ee]
  - @tangleai/core@0.56.0
  - @tangleai/config@0.56.0
  - @tangleai/mas@0.56.0
  - @tangleai/documents@0.56.0
  - @tangleai/memory@0.56.0
  - @tangleai/outcomes@0.56.0
  - @tangleai/trace2skill@0.56.0
  - @tangleai/evolve@0.56.0
  - @tangleai/hera@0.56.0
  - @tangleai/forecast@0.56.0
  - @tangleai/grounding@0.56.0
  - @tangleai/lightrag@0.56.0
  - @tangleai/trading@0.56.0
  - @tangleai/research@0.56.0
  - @tangleai/experiential@0.56.0

## 0.55.1

### Patch Changes

- 89f116e: A desktop loads Jaren's port transport when its first framed window opens instead of with the desktop. The shell waits for it before it hands a frame its ports, and a failed fetch fails that window, whose Retry fetches again. The kernel's `serveModule` and `connectProvider` stay synchronous for any other caller: until the transport arrives, what reaches a served port is held and handed over in order, and a client's calls wait for it. How much this saves depends on the host's bundler: with esbuild splitting chunks, a desktop of in-page modules loads about 25 KB less minified code up front (6 KB gzipped) and the 28 KB port chunk only with a framed window; a bundle built without splitting keeps it inline. `applyTheme` and `applyLocale` live in their own file, so the shell no longer imports the joining side.
- Updated dependencies [89f116e]
  - @tangleai/core@0.55.1
  - @tangleai/config@0.55.1
  - @tangleai/mas@0.55.1
  - @tangleai/documents@0.55.1
  - @tangleai/memory@0.55.1
  - @tangleai/outcomes@0.55.1
  - @tangleai/trace2skill@0.55.1
  - @tangleai/evolve@0.55.1
  - @tangleai/hera@0.55.1
  - @tangleai/forecast@0.55.1
  - @tangleai/grounding@0.55.1
  - @tangleai/lightrag@0.55.1
  - @tangleai/trading@0.55.1
  - @tangleai/research@0.55.1
  - @tangleai/experiential@0.55.1

## 0.55.0

### Minor Changes

- d2ee7f0: Capabilities declare a domain once: its contract documents, its context reads, the kinds of proposal it files with their review policy, and a prompt pack in the person's languages (`CAPABILITY_SCHEMA`). The host installs them (`kernel.installCapability`, never in the user layer, since a prompt pack becomes the assistant's system text), and a module's manifest names the capabilities it files for, so every module of a domain files its kinds without a list of its own. A kind's policy says which origins may file it, which the kernel enforces, and which roles may decide it, which the inbox shows and hands to the module with the decision. `composeCapabilities` gives an assistant its system text, tools and context reads from them, deterministically, and `checkCapabilities` reports a missing capability or a kind declared twice. An older desktop refuses a manifest with `capabilities` and a page on an older release refuses a decision carrying `roles`; the protocol stays 1. No model was run on the prompt packs.
- a92d85b: Paused runs wait in the desktop's inbox. A proposal says who it comes from (`origin`: human, rule, import or ai) and may ask the person something (`answer: { schema, label }`): the inbox draws a form from the schema, the kernel checks the answer before it reaches the module that filed it as `{ decision: 'answer', response }`, and nothing gives the assistant a way to answer. `@tangleai/mas/inbox` turns a run's waiting interactions into such proposals on the application's server and an answer back into the interaction's response with a derived response key (a rejection cancels it); `listWaitingInteractions` lists the waits by status, with no table change. An older desktop refuses a proposal with `origin` or `answer`, and an older page refuses an `answer` decision; the protocol stays 1.

### Patch Changes

- Updated dependencies [d2ee7f0]
- Updated dependencies [a92d85b]
  - @tangleai/core@0.55.0
  - @tangleai/config@0.55.0
  - @tangleai/mas@0.55.0
  - @tangleai/documents@0.55.0
  - @tangleai/memory@0.55.0
  - @tangleai/outcomes@0.55.0
  - @tangleai/trace2skill@0.55.0
  - @tangleai/evolve@0.55.0
  - @tangleai/hera@0.55.0
  - @tangleai/forecast@0.55.0
  - @tangleai/grounding@0.55.0
  - @tangleai/lightrag@0.55.0
  - @tangleai/trading@0.55.0
  - @tangleai/research@0.55.0
  - @tangleai/experiential@0.55.0

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
  - @tangleai/core@0.54.0
  - @tangleai/config@0.54.0
  - @tangleai/mas@0.54.0
  - @tangleai/documents@0.54.0
  - @tangleai/memory@0.54.0
  - @tangleai/outcomes@0.54.0
  - @tangleai/trace2skill@0.54.0
  - @tangleai/evolve@0.54.0
  - @tangleai/hera@0.54.0
  - @tangleai/forecast@0.54.0
  - @tangleai/grounding@0.54.0
  - @tangleai/lightrag@0.54.0
  - @tangleai/trading@0.54.0
  - @tangleai/research@0.54.0
  - @tangleai/experiential@0.54.0

## 0.53.2

### Patch Changes

- Builds on Jaren 0.220.0, whose linq database client builds each handle on its first read instead of all at open, and whose `prepareModel` lets many stores open from one prepared model. Tangle reads its handles by name, so no behaviour changes beyond a lighter open; the pins, the foundation manifest and the integration audit move to the new release.
- Updated dependencies
  - @tangleai/core@0.53.2
  - @tangleai/config@0.53.2
  - @tangleai/mas@0.53.2
  - @tangleai/documents@0.53.2
  - @tangleai/memory@0.53.2
  - @tangleai/outcomes@0.53.2
  - @tangleai/trace2skill@0.53.2
  - @tangleai/evolve@0.53.2
  - @tangleai/hera@0.53.2
  - @tangleai/forecast@0.53.2
  - @tangleai/grounding@0.53.2
  - @tangleai/lightrag@0.53.2
  - @tangleai/trading@0.53.2
  - @tangleai/research@0.53.2
  - @tangleai/experiential@0.53.2

## 0.53.1

### Patch Changes

- Builds on Jaren 0.219.1, a patch whose database owner lease is pinned to a SQLite file under every spelling of its path. Its source is unchanged, so no behaviour changes; the pins, the foundation manifest and the integration audit move to the new release.
- Updated dependencies
  - @tangleai/core@0.53.1
  - @tangleai/config@0.53.1
  - @tangleai/mas@0.53.1
  - @tangleai/documents@0.53.1
  - @tangleai/memory@0.53.1
  - @tangleai/outcomes@0.53.1
  - @tangleai/trace2skill@0.53.1
  - @tangleai/evolve@0.53.1
  - @tangleai/hera@0.53.1
  - @tangleai/forecast@0.53.1
  - @tangleai/grounding@0.53.1
  - @tangleai/lightrag@0.53.1
  - @tangleai/trading@0.53.1
  - @tangleai/research@0.53.1
  - @tangleai/experiential@0.53.1

## 0.53.0

### Minor Changes

- f4868f0: Applications put their toolbar in their window's title bar: buttons, toggles, menus, tabs and a search field, described as a JSON document (`HEADER_SCHEMA`) and drawn by the desktop, so every bar follows the theme and the writing direction, works by keyboard and screen reader, and fits a narrow window by moving what does not fit into one "More" menu. A framed page calls `setHeader` and hears uses at `onHeader`; a shipped module has the same pair on its context. Every use, the person's and the assistant's, goes through the kernel's own `tangle_os_header` contract (`header.list`, `header.activate`) under grants and into the ledger; an item marked `assistant: false` is kept from the assistant. Calendar moves its month controls into its header bar and Settings its search.

### Patch Changes

- Updated dependencies [f4868f0]
  - @tangleai/core@0.53.0
  - @tangleai/config@0.53.0
  - @tangleai/mas@0.53.0
  - @tangleai/documents@0.53.0
  - @tangleai/memory@0.53.0
  - @tangleai/outcomes@0.53.0
  - @tangleai/trace2skill@0.53.0
  - @tangleai/evolve@0.53.0
  - @tangleai/hera@0.53.0
  - @tangleai/forecast@0.53.0
  - @tangleai/grounding@0.53.0
  - @tangleai/lightrag@0.53.0
  - @tangleai/trading@0.53.0
  - @tangleai/research@0.53.0
  - @tangleai/experiential@0.53.0

## 0.52.6

### Patch Changes

- Builds on Jaren 0.219.0, whose `$date-format` writes a date on a named time zone's wall clock through an injected zone provider and whose clock arithmetic cuts a sub-millisecond fraction instead of rounding it. Tangle uses none of the date operators, so no behaviour changes; the pins, the foundation manifest and the integration audit move to the new release.
- Updated dependencies
  - @tangleai/core@0.52.6
  - @tangleai/config@0.52.6
  - @tangleai/mas@0.52.6
  - @tangleai/documents@0.52.6
  - @tangleai/memory@0.52.6
  - @tangleai/outcomes@0.52.6
  - @tangleai/trace2skill@0.52.6
  - @tangleai/evolve@0.52.6
  - @tangleai/hera@0.52.6
  - @tangleai/forecast@0.52.6
  - @tangleai/grounding@0.52.6
  - @tangleai/lightrag@0.52.6
  - @tangleai/trading@0.52.6
  - @tangleai/research@0.52.6
  - @tangleai/experiential@0.52.6

## 0.52.5

### Patch Changes

- Builds on Jaren 0.218.0, whose HTTP contract server can refuse a query member an operation does not declare (`closedQuery`, off by default, not turned on here). The Pages desktop adds two applications from Jaren's `@jarenjs/calc`: Calculator (standard, scientific, programmer, financial and converter modes) and Converter (the same component in its converter mode alone, with live public currency rates and an offline table to fall back on), both in the desktop's language and theme.
- Updated dependencies
  - @tangleai/core@0.52.5
  - @tangleai/config@0.52.5
  - @tangleai/mas@0.52.5
  - @tangleai/documents@0.52.5
  - @tangleai/memory@0.52.5
  - @tangleai/outcomes@0.52.5
  - @tangleai/trace2skill@0.52.5
  - @tangleai/evolve@0.52.5
  - @tangleai/hera@0.52.5
  - @tangleai/forecast@0.52.5
  - @tangleai/grounding@0.52.5
  - @tangleai/lightrag@0.52.5
  - @tangleai/trading@0.52.5
  - @tangleai/research@0.52.5
  - @tangleai/experiential@0.52.5

## 0.52.4

### Patch Changes

- An agent send no longer waits on the platform's digest before its first request. The run identity's SHA-256 values are now computed synchronously (equal to `sha256Hex` and `canonicalSha256` on the same input, so every identity keeps its value): a busy thread pool held each request back by an unbounded number of event-loop turns, and on a page without `crypto.subtle` (plain http other than localhost) every send was refused.
- Updated dependencies
  - @tangleai/core@0.52.4
  - @tangleai/config@0.52.4
  - @tangleai/mas@0.52.4
  - @tangleai/documents@0.52.4
  - @tangleai/memory@0.52.4
  - @tangleai/outcomes@0.52.4
  - @tangleai/trace2skill@0.52.4
  - @tangleai/evolve@0.52.4
  - @tangleai/hera@0.52.4
  - @tangleai/forecast@0.52.4
  - @tangleai/grounding@0.52.4
  - @tangleai/lightrag@0.52.4
  - @tangleai/trading@0.52.4
  - @tangleai/research@0.52.4
  - @tangleai/experiential@0.52.4

## 0.52.3

### Patch Changes

- 5593e2d: An agent run can be resumed after a restart without a tool acting twice. A tool's context carries `call: { id, round, attempt }` (the provider's tool-call id, the round, and how often this agent ran that id), so a tool with an effect keys it by the id; `onCheckpoint` on a send is called after each round's tool results with a copy of the messages, the steps, the round and the spend, the point a host persists and resumes from.
- b351c19: Every agent result, and the partial result a rejected call carries, says what produced it: `identity` holds the SHA-256 of the base system prompt, the canonical SHA-256 of the listed tool definitions sorted by name, the tool names, the configured provider and model, and every model the provider reported answering. A host stores it beside the run so an evaluation names the prompt and tool versions it measured, and a changed prompt or schema shows as a changed digest. `@tangleai/agents` now depends directly on `@jarenjs/json`, which was already in its closure.
- Updated dependencies [5593e2d]
- Updated dependencies [b351c19]
  - @tangleai/core@0.52.3
  - @tangleai/config@0.52.3
  - @tangleai/mas@0.52.3
  - @tangleai/documents@0.52.3
  - @tangleai/memory@0.52.3
  - @tangleai/outcomes@0.52.3
  - @tangleai/trace2skill@0.52.3
  - @tangleai/evolve@0.52.3
  - @tangleai/hera@0.52.3
  - @tangleai/forecast@0.52.3
  - @tangleai/grounding@0.52.3
  - @tangleai/lightrag@0.52.3
  - @tangleai/trading@0.52.3
  - @tangleai/research@0.52.3
  - @tangleai/experiential@0.52.3

## 0.52.2

### Patch Changes

- Builds on Jaren 0.217.0, whose database runs an existence test over a hop that pairs an equality with a comparison of two non-null columns as one native statement on SQLite and PostgreSQL. Tangle issues no such query, so no behaviour changes; the pins, the foundation manifest and the integration audit move to the new release.
- Updated dependencies
  - @tangleai/core@0.52.2
  - @tangleai/config@0.52.2
  - @tangleai/mas@0.52.2
  - @tangleai/documents@0.52.2
  - @tangleai/memory@0.52.2
  - @tangleai/outcomes@0.52.2
  - @tangleai/trace2skill@0.52.2
  - @tangleai/evolve@0.52.2
  - @tangleai/hera@0.52.2
  - @tangleai/forecast@0.52.2
  - @tangleai/grounding@0.52.2
  - @tangleai/lightrag@0.52.2
  - @tangleai/trading@0.52.2
  - @tangleai/research@0.52.2
  - @tangleai/experiential@0.52.2

## 0.52.1

### Patch Changes

- Builds on Jaren 0.216.0, whose josl CSV writers can quote every field, the header included, on request. Tangle writes no CSV, so no behaviour changes; the pins, the foundation manifest and the integration audit move to the new release.
- Updated dependencies
  - @tangleai/core@0.52.1
  - @tangleai/config@0.52.1
  - @tangleai/mas@0.52.1
  - @tangleai/documents@0.52.1
  - @tangleai/memory@0.52.1
  - @tangleai/outcomes@0.52.1
  - @tangleai/trace2skill@0.52.1
  - @tangleai/evolve@0.52.1
  - @tangleai/hera@0.52.1
  - @tangleai/forecast@0.52.1
  - @tangleai/grounding@0.52.1
  - @tangleai/lightrag@0.52.1
  - @tangleai/trading@0.52.1
  - @tangleai/research@0.52.1
  - @tangleai/experiential@0.52.1

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
  - @tangleai/core@0.52.0
  - @tangleai/config@0.52.0
  - @tangleai/mas@0.52.0
  - @tangleai/documents@0.52.0
  - @tangleai/memory@0.52.0
  - @tangleai/outcomes@0.52.0
  - @tangleai/trace2skill@0.52.0
  - @tangleai/evolve@0.52.0
  - @tangleai/hera@0.52.0
  - @tangleai/forecast@0.52.0
  - @tangleai/grounding@0.52.0
  - @tangleai/lightrag@0.52.0
  - @tangleai/trading@0.52.0
  - @tangleai/research@0.52.0
  - @tangleai/experiential@0.52.0

## 0.51.3

### Patch Changes

- Build on Jaren 0.215.0, which compares a caller-written numeric key exactly on PostgreSQL.
- Updated dependencies
  - @tangleai/core@0.51.3
  - @tangleai/config@0.51.3
  - @tangleai/mas@0.51.3
  - @tangleai/documents@0.51.3
  - @tangleai/memory@0.51.3
  - @tangleai/outcomes@0.51.3
  - @tangleai/trace2skill@0.51.3
  - @tangleai/evolve@0.51.3
  - @tangleai/hera@0.51.3
  - @tangleai/forecast@0.51.3
  - @tangleai/grounding@0.51.3
  - @tangleai/lightrag@0.51.3
  - @tangleai/trading@0.51.3
  - @tangleai/research@0.51.3
  - @tangleai/experiential@0.51.3

## 0.51.2

### Patch Changes

- Build on Jaren 0.214.0, which exports its host tokens as light and dark stylesheets and lets its component stylesheets follow the host's dark selection.
- Updated dependencies
  - @tangleai/core@0.51.2
  - @tangleai/config@0.51.2
  - @tangleai/mas@0.51.2
  - @tangleai/documents@0.51.2
  - @tangleai/memory@0.51.2
  - @tangleai/outcomes@0.51.2
  - @tangleai/trace2skill@0.51.2
  - @tangleai/evolve@0.51.2
  - @tangleai/hera@0.51.2
  - @tangleai/forecast@0.51.2
  - @tangleai/grounding@0.51.2
  - @tangleai/lightrag@0.51.2
  - @tangleai/trading@0.51.2
  - @tangleai/research@0.51.2
  - @tangleai/experiential@0.51.2

## 0.51.1

### Patch Changes

- Build on Jaren 0.213.0, which renders an untrusted app document with its data bindings and granted widgets without a frame.
- Updated dependencies
  - @tangleai/core@0.51.1
  - @tangleai/config@0.51.1
  - @tangleai/mas@0.51.1
  - @tangleai/documents@0.51.1
  - @tangleai/memory@0.51.1
  - @tangleai/outcomes@0.51.1
  - @tangleai/trace2skill@0.51.1
  - @tangleai/evolve@0.51.1
  - @tangleai/hera@0.51.1
  - @tangleai/forecast@0.51.1
  - @tangleai/grounding@0.51.1
  - @tangleai/lightrag@0.51.1
  - @tangleai/trading@0.51.1
  - @tangleai/research@0.51.1
  - @tangleai/experiential@0.51.1

## 0.51.0

### Patch Changes

- The desktop has one Settings for every application. `@tangleai/os/settings` is a Settings module a host installs with its own sections first and then one per application whose manifest declares `settings`: `mount` (a shipped module's own settings screen), `page` (an origin application's settings page, framed from its own origin and given no contract ports) or `form` (a document module's JSON Schema, whose values the desktop keeps through `createKernel({ settings })`, checked against the schema and never a secret). Applications keep their own values; the desktop is where the person finds them, with a search, from the window and dock menus, and from the application itself (`openSettings()` over its own port, no grant needed). The Pages desktop's Settings is this module, and the Calendar's working hours are a section of it.
- Updated dependencies
  - @tangleai/core@0.51.0
  - @tangleai/config@0.51.0
  - @tangleai/mas@0.51.0
  - @tangleai/documents@0.51.0
  - @tangleai/memory@0.51.0
  - @tangleai/outcomes@0.51.0
  - @tangleai/trace2skill@0.51.0
  - @tangleai/evolve@0.51.0
  - @tangleai/hera@0.51.0
  - @tangleai/forecast@0.51.0
  - @tangleai/grounding@0.51.0
  - @tangleai/lightrag@0.51.0
  - @tangleai/trading@0.51.0
  - @tangleai/research@0.51.0
  - @tangleai/experiential@0.51.0

## 0.50.0

### Patch Changes

- The desktop fits the applications that host it or join it. Hosting: `mountDesktop(node, { compact: { below } })` makes a narrow desktop compact, every window opening maximized and only the focused one shown; at any width the dock stays on screen, its tiles shrinking to fit and then scrolling, every module reachable by pointer and keyboard, and a keyboard user keeps their place when the dock redraws; `tray` decides the mail tile and the light/dark switch and adds a brand mark; `desktop.subscribe` reports every window change with its state, and when a module is `ready` or has `failed`; a shipped module learns from `visible` and `onVisibility` when its window is hidden; a host glyph is documented API. Framed applications: a framed module has `connectTimeoutMs` (15 s by default) to answer, past which its window says so, offers to try again and holds nothing open, and a module whose page reloads connects again on fresh ports. Joining: `connectToOs` takes `connectTimeoutMs` and `signal`, refuses with an `OsConnectError` (`OS0401`, `OS0403`) and leaves no listener behind, refuses a page that is not framed at once (`OS0402`), and keeps the application's own look with `presentation: "none"` or `{ root }`; `GrantedOperation` and `ToolBuilder` are exported. Windows open wholly on the desktop, keep their manifest's minimum size when resized, are labelled regions rather than dialogs, play their opening animation once and stop moving under reduced motion, and their glass survives a minified build. The assistant view opens, closes and toggles from the host, and builds its own Markdown only when the host renders none.
- Build on Jaren 0.212.0, whose assignment engine evaluates what-ifs incrementally, proposes fills and repairs against a baseline, and whose database reads hand-written SQLite triggers back as rules.
- `npm test` runs the release suite; the long-running set (reproducing committed measurements and qualifying crash recovery, about 88% of the recorded test time) runs with `npm run test:long`, and both with `npm run test:all`. CI runs the long-running set as a separate job that never blocks a release, and keeps a verified release artifact for 90 days.
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangleai/core@0.50.0
  - @tangleai/config@0.50.0
  - @tangleai/mas@0.50.0
  - @tangleai/documents@0.50.0
  - @tangleai/memory@0.50.0
  - @tangleai/outcomes@0.50.0
  - @tangleai/trace2skill@0.50.0
  - @tangleai/evolve@0.50.0
  - @tangleai/hera@0.50.0
  - @tangleai/forecast@0.50.0
  - @tangleai/grounding@0.50.0
  - @tangleai/lightrag@0.50.0
  - @tangleai/trading@0.50.0
  - @tangleai/research@0.50.0
  - @tangleai/experiential@0.50.0

## 0.49.2

### Patch Changes

- Build on Jaren 0.207.0, whose assignment scoring covers one resource on one local civil day through an injected zone.
- Updated dependencies
  - @tangleai/core@0.49.2
  - @tangleai/config@0.49.2
  - @tangleai/mas@0.49.2
  - @tangleai/documents@0.49.2
  - @tangleai/memory@0.49.2
  - @tangleai/outcomes@0.49.2
  - @tangleai/trace2skill@0.49.2
  - @tangleai/evolve@0.49.2
  - @tangleai/hera@0.49.2
  - @tangleai/forecast@0.49.2
  - @tangleai/grounding@0.49.2
  - @tangleai/lightrag@0.49.2
  - @tangleai/trading@0.49.2
  - @tangleai/research@0.49.2
  - @tangleai/experiential@0.49.2

## 0.49.1

### Patch Changes

- Build on Jaren 0.206.0, whose calendar reads iCalendar back into its model, compiles and embeds zone definitions and edits foreign iCalendar losslessly, and whose core scores assignments exactly.
- Updated dependencies
  - @tangleai/core@0.49.1
  - @tangleai/config@0.49.1
  - @tangleai/mas@0.49.1
  - @tangleai/documents@0.49.1
  - @tangleai/memory@0.49.1
  - @tangleai/outcomes@0.49.1
  - @tangleai/trace2skill@0.49.1
  - @tangleai/evolve@0.49.1
  - @tangleai/hera@0.49.1
  - @tangleai/forecast@0.49.1
  - @tangleai/grounding@0.49.1
  - @tangleai/lightrag@0.49.1
  - @tangleai/trading@0.49.1
  - @tangleai/research@0.49.1
  - @tangleai/experiential@0.49.1

## 0.49.0

### Patch Changes

- A limit that would never be reached is refused before any call, with `AI0001`: `maxRepairs`, `retry.attempts` and an agent's `maxToolRounds` and `budget.turns` must be whole numbers of at least 0, and `budget.tokens`, `budget.ms` and `budget.cost` finite numbers of at least 0. Before, `maxRepairs: Infinity` repaired without end and a NaN turn budget never stopped a run; `maxRepairs: -1` made no call and returned a failure with no errors. A structured result's `attempts` is the number of calls made.
- Build on Jaren 0.201.2, two patch releases of database, ordering and calendar fixes with fuller type declarations.
- `@tangleai/os` can be used from another repository without a registry. Every release keeps the package tarball, a one-file module side (`connectToOs` with its dependencies inside, for a page on any foundation) and a manifest of their hashes, protocol and Jaren foundation under `releases/os/`, and the desktop site serves the same files under `os/`. The package now depends on Jaren alone. `kernel.operations()` lists what a caller may call as plain data, for an application with its own agent runtime. Migration: `kernel.tools()` builds its tools with the host's tool builder, so pass one when creating the kernel: `createKernel({ tools })` with `import * as tools from "@tangleai/agents/toolbox"`; without one it refuses with `OS0301`.
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangleai/core@0.49.0
  - @tangleai/config@0.49.0
  - @tangleai/mas@0.49.0
  - @tangleai/documents@0.49.0
  - @tangleai/memory@0.49.0
  - @tangleai/outcomes@0.49.0
  - @tangleai/trace2skill@0.49.0
  - @tangleai/evolve@0.49.0
  - @tangleai/hera@0.49.0
  - @tangleai/forecast@0.49.0
  - @tangleai/grounding@0.49.0
  - @tangleai/lightrag@0.49.0
  - @tangleai/trading@0.49.0
  - @tangleai/research@0.49.0
  - @tangleai/experiential@0.49.0

## 0.48.3

### Patch Changes

- Build on Jaren 0.201.0. Its calendar repeats monthly and yearly by the iCalendar standard, so the desktop Calendar now offers "Every month" and "Every year", and its editor says when a series skips a date that a month or year lacks. The Pages playground is now built on Jaren's play host kit instead of a copy of Jaren's site: a saved or shared session no longer carries a message language and opens in its reader's, and an example made to show one language shows it for its own run.
- Updated dependencies
  - @tangleai/core@0.48.3
  - @tangleai/config@0.48.3
  - @tangleai/mas@0.48.3
  - @tangleai/documents@0.48.3
  - @tangleai/memory@0.48.3
  - @tangleai/outcomes@0.48.3
  - @tangleai/trace2skill@0.48.3
  - @tangleai/evolve@0.48.3
  - @tangleai/hera@0.48.3
  - @tangleai/forecast@0.48.3
  - @tangleai/grounding@0.48.3
  - @tangleai/lightrag@0.48.3
  - @tangleai/trading@0.48.3
  - @tangleai/research@0.48.3
  - @tangleai/experiential@0.48.3

## 0.48.2

### Patch Changes

- Build on Jaren 0.199.0, whose calendar (`@jarenjs/core/calendar`), iCalendar writer (`@jarenjs/josl/ical`) and calendar-scheduled database jobs arrive in these releases. The Pages desktop gains a Calendar built on them: a month view, a day panel and an editor, recurring events with skipped days, "find a time" over the person's working hours that never offers unknown time, an iCalendar export, and a `calendar` contract (agenda, add, free) that the assistant and other applications use as tools.
- Updated dependencies
  - @tangleai/core@0.48.2
  - @tangleai/config@0.48.2
  - @tangleai/mas@0.48.2
  - @tangleai/documents@0.48.2
  - @tangleai/memory@0.48.2
  - @tangleai/outcomes@0.48.2
  - @tangleai/trace2skill@0.48.2
  - @tangleai/evolve@0.48.2
  - @tangleai/hera@0.48.2
  - @tangleai/forecast@0.48.2
  - @tangleai/grounding@0.48.2
  - @tangleai/lightrag@0.48.2
  - @tangleai/trading@0.48.2
  - @tangleai/research@0.48.2
  - @tangleai/experiential@0.48.2

## 0.48.1

### Patch Changes

- Build on Jaren 0.193.1. Its `sha256Hex` replaces the nine local SHA-256 helpers, each keeping its name, with identical digests. MAS caches compiled embedded schemas with Jaren's semantic cache, which now remembers the key of a frozen tree: 0.31 µs per lookup against 22.8 µs before. The Studio authoring gate now refuses an element written as an object and names an unknown operator with the nearest known one. The Studio file author sends an open profile in the prompt to an Anthropic model, which refuses an output schema with an open object, so the Pages Studio assistant no longer fails with HTTP 400 on the default model. The assistant's Japanese and Traditional Chinese packs use Jaren's 「…」 permalink wording.
- Updated dependencies
  - @tangleai/core@0.48.1
  - @tangleai/config@0.48.1
  - @tangleai/mas@0.48.1
  - @tangleai/documents@0.48.1
  - @tangleai/memory@0.48.1
  - @tangleai/outcomes@0.48.1
  - @tangleai/trace2skill@0.48.1
  - @tangleai/evolve@0.48.1
  - @tangleai/hera@0.48.1
  - @tangleai/forecast@0.48.1
  - @tangleai/grounding@0.48.1
  - @tangleai/lightrag@0.48.1
  - @tangleai/trading@0.48.1
  - @tangleai/research@0.48.1
  - @tangleai/experiential@0.48.1

## 0.48.0

### Minor Changes

- Make Tangle OS the Pages site. Studio, Playground, Flow, Data, the adventure, the memory loop and moving browser data are desktop applications now, beside Welcome, the assistant, Settings and the to-do module; the assistant uses the work applications' authoring tools, and a former page link opens its application. `@tangleai/os` adds theme kits (`THEME_KITS`, `composeTheme`): each is one JSON document with light and dark palettes, a procedural wallpaper and a shape, and a person's changes (accent, highlight, pattern, seed, density, glass, corners, spacing) compose into an ordinary theme document that can be exported and imported. Five procedural wallpapers (`PATTERNS`, `patternBackground`: woven threads, contours, a two-ink halftone, a sun print and moiré tides) are drawn deterministically from a seed in the theme's own colours. Windows are laid out above the dock.

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.48.0
  - @tangleai/config@0.48.0
  - @tangleai/mas@0.48.0
  - @tangleai/documents@0.48.0
  - @tangleai/memory@0.48.0
  - @tangleai/outcomes@0.48.0
  - @tangleai/trace2skill@0.48.0
  - @tangleai/evolve@0.48.0
  - @tangleai/hera@0.48.0
  - @tangleai/forecast@0.48.0
  - @tangleai/grounding@0.48.0
  - @tangleai/lightrag@0.48.0
  - @tangleai/trading@0.48.0
  - @tangleai/research@0.48.0
  - @tangleai/experiential@0.48.0

## 0.47.0

### Minor Changes

- Add `@tangleai/os`, a browser operating system for applications built on Jaren and Tangle. A module is a JSON manifest plus the contract operations it serves and needs; the desktop hosts it as a shipped component, as a jaren-app document in a sandboxed opaque-origin frame, or as an application's own page on its own origin that joins with `connectToOs` from `@tangleai/os/module`. The kernel installs modules in shipped, suite and user layers with RFC 6902 patches, keeps a journal with undo and a recovery boot, routes every call between modules as a contract operation under grants into a ledger, carries mail, and lists every granted operation as an assistant tool. The assistant's model placeholder and the documentation now name only the models that write Jaren's JSON documents reliably: `anthropic/claude-haiku-5.5`, and Qwen 3.7 27B or larger. The desktop has context menus on its background, title bars and dock, minimized windows now actually hide, and `mountDesktop` takes `themeFor` and `onSchemeSwitch` so a host's own colours survive the dock's light/dark switch. The Pages desktop ships an Assistant window and a Settings app: provider, OpenRouter key (kept in this browser, optionally for the tab only), region, a model picker over OpenRouter's catalogue, appearance, and forgetting what the browser keeps.

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.47.0
  - @tangleai/config@0.47.0
  - @tangleai/mas@0.47.0
  - @tangleai/documents@0.47.0
  - @tangleai/memory@0.47.0
  - @tangleai/outcomes@0.47.0
  - @tangleai/trace2skill@0.47.0
  - @tangleai/evolve@0.47.0
  - @tangleai/hera@0.47.0
  - @tangleai/forecast@0.47.0
  - @tangleai/grounding@0.47.0
  - @tangleai/lightrag@0.47.0
  - @tangleai/trading@0.47.0
  - @tangleai/research@0.47.0
  - @tangleai/experiential@0.47.0

## 0.46.0

### Patch Changes

- Build on Jaren 0.188.0. Its validator keeps the text a schema's `errorMessage` wrote in every locale, a `$msgid` fallback included, and a validation error's `toJSON` carries that mark; `diffContracts` reports fewer false and more real breaking changes; `@jarenjs/db` reads a PostgreSQL `jsonb` null as SQL NULL and names unguarded number columns in `introspect()`. Every exact `@jarenjs/*` pin moves from 0.184.2 to 0.188.0, and the candidate tarballs are recaptured from the tagged source with an empty patch. Local copies of canonical cloning and RFC 6901 token escaping are replaced by `@jarenjs/json`'s `cloneJson` and pointer helpers, with identical output.
- Updated dependencies
  - @tangleai/config@0.46.0
  - @tangleai/core@0.46.0
  - @tangleai/documents@0.46.0
  - @tangleai/evolve@0.46.0
  - @tangleai/experiential@0.46.0
  - @tangleai/forecast@0.46.0
  - @tangleai/grounding@0.46.0
  - @tangleai/hera@0.46.0
  - @tangleai/lightrag@0.46.0
  - @tangleai/mas@0.46.0
  - @tangleai/memory@0.46.0
  - @tangleai/outcomes@0.46.0
  - @tangleai/research@0.46.0
  - @tangleai/trace2skill@0.46.0
  - @tangleai/trading@0.46.0

## 0.45.2

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.45.2
  - @tangleai/documents@0.45.2
  - @tangleai/evolve@0.45.2
  - @tangleai/grounding@0.45.2
  - @tangleai/lightrag@0.45.2
  - @tangleai/memory@0.45.2
  - @tangleai/outcomes@0.45.2
  - @tangleai/experiential@0.45.2
  - @tangleai/forecast@0.45.2
  - @tangleai/hera@0.45.2
  - @tangleai/research@0.45.2
  - @tangleai/trace2skill@0.45.2
  - @tangleai/config@0.45.2
  - @tangleai/mas@0.45.2
  - @tangleai/trading@0.45.2

## 0.45.1

### Patch Changes

- Move every package onto the Jaren 0.183.1 foundation, still consumed as candidate tarballs rebuilt byte for byte from the pinned source because npm does not serve that release. Its job worker refuses `start()` until its `stop()` has resolved, and a settling call is idempotent only over its own attempt's row in the state it writes: a completion behind the attempt's own cancellation is reported cancelled, and a failure behind the attempt's own completion is refused. A MAS segment completes its job in the transaction that records its outcome, so a host error raised after that commit would have reached the host as Jaren's `JD2065` refusal; `createMasSegmentDriver` and `createGroundingClarificationHost` now read the job store's fence refusals as Jaren's worker does, as a lost settlement, and still rethrow the host's own error, leaving the completed job and run as they are. The grounding host already creates a fresh worker for every segment and awaits its stop. Jaren refuses a captured expression that reads a method's own function members, a misspelt run store page option and a `sql.call` option named like the call's own name or arguments, where each answered wrong before; Tangle passes none of them. Its play option switches bring the source their new choice runs, its Mermaid pie draws `showData`, and a column upgrade's default link is named past the ids the migration history holds. No Tangle interface changes.

  Tooling: the Jaren bootstrap reconstructs the recorded tarballs on Windows. npm there packs a declared bin without the executable bit git records, because NTFS has none to keep; the bootstrap restores the bit on the files git records as executable and rewrites only an archive whose header changed, so a Linux pack keeps npm's bytes and the recorded SHA-256 still decides. It reads the tarballs in Node instead of running `tar`, so cmd.exe, PowerShell and Git Bash reconstruct the same bytes. The README notes `core.longpaths` for a deep clone path on Windows, and the integration documents name the current foundation.
- Updated dependencies
  - @tangleai/core@0.45.1
  - @tangleai/documents@0.45.1
  - @tangleai/evolve@0.45.1
  - @tangleai/grounding@0.45.1
  - @tangleai/lightrag@0.45.1
  - @tangleai/memory@0.45.1
  - @tangleai/outcomes@0.45.1
  - @tangleai/experiential@0.45.1
  - @tangleai/forecast@0.45.1
  - @tangleai/hera@0.45.1
  - @tangleai/research@0.45.1
  - @tangleai/trace2skill@0.45.1
  - @tangleai/config@0.45.1
  - @tangleai/mas@0.45.1
  - @tangleai/trading@0.45.1

## 0.45.0

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @tangleai/documents@0.45.0
  - @tangleai/core@0.45.0
  - @tangleai/forecast@0.45.0
  - @tangleai/grounding@0.45.0
  - @tangleai/hera@0.45.0
  - @tangleai/lightrag@0.45.0
  - @tangleai/mas@0.45.0
  - @tangleai/outcomes@0.45.0
  - @tangleai/research@0.45.0
  - @tangleai/trace2skill@0.45.0
  - @tangleai/config@0.45.0
  - @tangleai/evolve@0.45.0
  - @tangleai/memory@0.45.0
  - @tangleai/experiential@0.45.0
  - @tangleai/trading@0.45.0

## 0.44.0

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.44.0
  - @tangleai/config@0.44.0
  - @tangleai/documents@0.44.0
  - @tangleai/evolve@0.44.0
  - @tangleai/experiential@0.44.0
  - @tangleai/forecast@0.44.0
  - @tangleai/grounding@0.44.0
  - @tangleai/hera@0.44.0
  - @tangleai/lightrag@0.44.0
  - @tangleai/mas@0.44.0
  - @tangleai/memory@0.44.0
  - @tangleai/outcomes@0.44.0
  - @tangleai/research@0.44.0
  - @tangleai/trace2skill@0.44.0
  - @tangleai/trading@0.44.0

## 0.43.1

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.43.1
  - @tangleai/config@0.43.1
  - @tangleai/documents@0.43.1
  - @tangleai/evolve@0.43.1
  - @tangleai/experiential@0.43.1
  - @tangleai/forecast@0.43.1
  - @tangleai/grounding@0.43.1
  - @tangleai/hera@0.43.1
  - @tangleai/lightrag@0.43.1
  - @tangleai/mas@0.43.1
  - @tangleai/memory@0.43.1
  - @tangleai/outcomes@0.43.1
  - @tangleai/research@0.43.1
  - @tangleai/trace2skill@0.43.1
  - @tangleai/trading@0.43.1

## 0.43.0

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @tangleai/documents@0.43.0
  - @tangleai/core@0.43.0
  - @tangleai/evolve@0.43.0
  - @tangleai/grounding@0.43.0
  - @tangleai/lightrag@0.43.0
  - @tangleai/memory@0.43.0
  - @tangleai/outcomes@0.43.0
  - @tangleai/config@0.43.0
  - @tangleai/experiential@0.43.0
  - @tangleai/forecast@0.43.0
  - @tangleai/hera@0.43.0
  - @tangleai/mas@0.43.0
  - @tangleai/research@0.43.0
  - @tangleai/trace2skill@0.43.0
  - @tangleai/trading@0.43.0

## 0.42.1

### Patch Changes

- Updated dependencies
  - @tangleai/mas@0.42.1
  - @tangleai/config@0.42.1
  - @tangleai/core@0.42.1
  - @tangleai/documents@0.42.1
  - @tangleai/evolve@0.42.1
  - @tangleai/experiential@0.42.1
  - @tangleai/forecast@0.42.1
  - @tangleai/grounding@0.42.1
  - @tangleai/hera@0.42.1
  - @tangleai/lightrag@0.42.1
  - @tangleai/memory@0.42.1
  - @tangleai/outcomes@0.42.1
  - @tangleai/research@0.42.1
  - @tangleai/trace2skill@0.42.1
  - @tangleai/trading@0.42.1

## 0.42.0

### Minor Changes

- Move every package onto the Jaren 0.161.0 foundation, consumed as candidate tarballs rebuilt byte for byte from the pinned source because npm does not serve that release. Absorb its typed check outcomes, stage-discriminated guarded commits, strict retry options and typed migration plans; remove the two declaration bridges its corrected LINQ declarations make unnecessary; re-derive the paid memory policy report's interval statistics under its corrected nearest-rank quantile, which changes the default policy's provenance report id but no selection, decision or default value; and raise the program pen bundle ceiling to 29,000 bytes for the larger captured-expression module.

### Patch Changes

- Updated dependencies
  - @tangleai/mas@0.42.0
  - @tangleai/memory@0.42.0
  - @tangleai/evolve@0.42.0
  - @tangleai/grounding@0.42.0
  - @tangleai/research@0.42.0
  - @tangleai/documents@0.42.0
  - @tangleai/experiential@0.42.0
  - @tangleai/forecast@0.42.0
  - @tangleai/hera@0.42.0
  - @tangleai/lightrag@0.42.0
  - @tangleai/outcomes@0.42.0
  - @tangleai/trace2skill@0.42.0
  - @tangleai/trading@0.42.0
  - @tangleai/config@0.42.0
  - @tangleai/core@0.42.0

## 0.41.0

### Minor Changes

- Add explicit native graph vector declarations and guarded migrations for canonical
  entities and relations. Complete document and graph identity changes stage in a
  separate store, swap atomically, and retain exact zero-embedding rollback with
  revision-fenced disposal and column-removal guards.

  Expose an optional native graph candidate seam with plan verification, physical
  statistics, complete trace parity and counted sweep fallback. Default graph
  retrieval continues to use the sweep; the registered scale instrument measures
  native performance and operational costs before any production adoption.

### Patch Changes

- Updated dependencies
  - @tangleai/lightrag@0.41.0
  - @tangleai/config@0.41.0
  - @tangleai/core@0.41.0
  - @tangleai/documents@0.41.0
  - @tangleai/evolve@0.41.0
  - @tangleai/experiential@0.41.0
  - @tangleai/forecast@0.41.0
  - @tangleai/grounding@0.41.0
  - @tangleai/hera@0.41.0
  - @tangleai/mas@0.41.0
  - @tangleai/memory@0.41.0
  - @tangleai/outcomes@0.41.0
  - @tangleai/research@0.41.0
  - @tangleai/trace2skill@0.41.0
  - @tangleai/trading@0.41.0

## 0.40.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [dcfaf59]
- Updated dependencies [5d6ee92]
- Updated dependencies [4259b10]
- Updated dependencies [c092814]
- Updated dependencies [4259b10]
- Updated dependencies [4ce4158]
- Updated dependencies [a8765d5]
- Updated dependencies [460156f]
- Updated dependencies [1beddfc]
- Updated dependencies [8d246e0]
- Updated dependencies [c092814]
  - @tangleai/experiential@0.40.0
  - @tangleai/outcomes@0.40.0
  - @tangleai/evolve@0.40.0
  - @tangleai/forecast@0.40.0
  - @tangleai/hera@0.40.0
  - @tangleai/lightrag@0.40.0
  - @tangleai/research@0.40.0
  - @tangleai/trace2skill@0.40.0
  - @tangleai/config@0.40.0
  - @tangleai/core@0.40.0
  - @tangleai/documents@0.40.0
  - @tangleai/grounding@0.40.0
  - @tangleai/mas@0.40.0
  - @tangleai/memory@0.40.0
  - @tangleai/trading@0.40.0

## 0.39.0

### Patch Changes

- aa45527: Retain origin-bound research lessons and stage held-out-validated procedure
  candidates through the native guarded compiler and atomic research transaction.
  Expose the native candidate diff calculation for shared compiler receipts.
  Generate bounded source-class proposals, qualify immutable sets through native
  outcome promotion and rollback, and freeze their procedures into workflow and
  export provenance. Retain actual lesson measurements and refusals with writeback
  disabled by default.
- Updated dependencies [aa45527]
- Updated dependencies [c804d7f]
- Updated dependencies [cd819a1]
- Updated dependencies [6e5c582]
  - @tangleai/research@0.39.0
  - @tangleai/trace2skill@0.39.0
  - @tangleai/config@0.39.0
  - @tangleai/core@0.39.0
  - @tangleai/documents@0.39.0
  - @tangleai/evolve@0.39.0
  - @tangleai/forecast@0.39.0
  - @tangleai/grounding@0.39.0
  - @tangleai/hera@0.39.0
  - @tangleai/lightrag@0.39.0
  - @tangleai/mas@0.39.0
  - @tangleai/memory@0.39.0
  - @tangleai/outcomes@0.39.0
  - @tangleai/trading@0.39.0

## 0.38.0

### Minor Changes

- 8a5af48: Add attributable research commands, guarded immutable proposal edits and bounded
  human retries. Record cancellation responses atomically, disclose experimental
  automatic gate tasks, and export exact intervention counts with the measured
  core research handoff.

### Patch Changes

- e6a6f5c: Run the research lifecycle through one durable MAS workflow with bounded refinement, pivot and review, manifest-bound gates, exact stage replay and counted overdue policy. Preserve task-refusal causes and atomically fence terminal interaction, run and attempt writes in the native store.
- 32cba1d: Introduce closed research records, content-addressed artifact provenance and atomic lifecycle persistence. Preserve run-log identities across recreated writers and compose frame writes inside caller transactions.
- Updated dependencies [accf91e]
- Updated dependencies [e6a6f5c]
- Updated dependencies [de8a412]
- Updated dependencies [802642f]
- Updated dependencies [32cba1d]
- Updated dependencies [dc083d7]
- Updated dependencies [e229e63]
- Updated dependencies [8a5af48]
- Updated dependencies [8d988df]
  - @tangleai/research@0.38.0
  - @tangleai/evolve@0.38.0
  - @tangleai/mas@0.38.0
  - @tangleai/documents@0.38.0
  - @tangleai/core@0.38.0
  - @tangleai/forecast@0.38.0
  - @tangleai/grounding@0.38.0
  - @tangleai/hera@0.38.0
  - @tangleai/trace2skill@0.38.0
  - @tangleai/trading@0.38.0
  - @tangleai/lightrag@0.38.0
  - @tangleai/memory@0.38.0
  - @tangleai/outcomes@0.38.0
  - @tangleai/config@0.38.0

## 0.37.0

### Minor Changes

- 364b336: Add closed sourced-place contracts, exact cited alias matching, temporal location claims and atomic gazetteer persistence with verified zero-write replay. Support explicit spatial intent and recognize location, residence and proximity questions in the existing authoring gates.

### Patch Changes

- Updated dependencies [364b336]
  - @tangleai/core@0.37.0
  - @tangleai/memory@0.37.0
  - @tangleai/documents@0.37.0
  - @tangleai/evolve@0.37.0
  - @tangleai/grounding@0.37.0
  - @tangleai/lightrag@0.37.0
  - @tangleai/outcomes@0.37.0
  - @tangleai/hera@0.37.0
  - @tangleai/config@0.37.0
  - @tangleai/forecast@0.37.0
  - @tangleai/mas@0.37.0
  - @tangleai/trace2skill@0.37.0
  - @tangleai/trading@0.37.0

## 0.36.0

### Minor Changes

- 43cfab8: Compose resumable native trading decisions and causal backtests through one
  financial path, retain immutable decision receipts, and settle pre-aborted runs
  and recovered terminal segment jobs before exposing financial output.
  Preserve identical loop output provenance across restarts under the next native
  checkpoint identity, and count refusals from the retained provider snapshots.

### Patch Changes

- eeb6d77: Index MAS trace collections by run so durable workflow commits do not scan
  unrelated historical traces. Existing databases require an explicitly reviewed
  native model migration; trace records, queued jobs and replay semantics are
  preserved.
- 2a1f1d0: Add immutable point-in-time trading contracts and atomic simulated portfolio persistence with repeatable decision commits. No external order transport is provided.
- Updated dependencies [ac6f698]
- Updated dependencies [43cfab8]
- Updated dependencies [eeb6d77]
- Updated dependencies [2a1f1d0]
- Updated dependencies [a9255aa]
- Updated dependencies [78b00ba]
- Updated dependencies [f078031]
- Updated dependencies [f4926cf]
  - @tangleai/trading@0.36.0
  - @tangleai/mas@0.36.0
  - @tangleai/config@0.36.0
  - @tangleai/core@0.36.0
  - @tangleai/documents@0.36.0
  - @tangleai/evolve@0.36.0
  - @tangleai/forecast@0.36.0
  - @tangleai/grounding@0.36.0
  - @tangleai/hera@0.36.0
  - @tangleai/lightrag@0.36.0
  - @tangleai/memory@0.36.0
  - @tangleai/outcomes@0.36.0
  - @tangleai/trace2skill@0.36.0

## 0.35.0

### Minor Changes

- 44c24f8: Prepare document and graph evidence outside storage, then activate both under one checked source fence and atomic transaction. Preserve identity across incremental replacement, retract obsolete support, reuse retained contributions without new model or embedding calls, and collect only explicitly unreferenced historical document evidence. Ordinary document updates to indexed sources now require joint promotion; use createCorpusPromotion to preserve document and graph consistency.
- 9564a6a: Add evidence-bound graph claims, canonical identity and support validation, checked source-head transitions, pure contribution plans, and identical atomic memory and SQLite lifecycle behavior. Retain superseded evidence and merged identities, reject stale or forged plans before writes, and make exact replay a zero-write operation. These contracts remain experimental and make no graph retrieval quality claim.

### Patch Changes

- 8df35fd: Measure graph coverage, incremental replacement and the registered SQLite scale ladder. Add separately authorized paired-answer and order-swapped judge instruments with retained attempts, request ceilings, control drift and explicit unrun licensed parity. Graph retrieval remains experimental.

  Bound large SQLite graph membership filters while preserving transaction consistency, intersections, distinct rows and deterministic ordering.

  Reuse contribution-scoped claim, endpoint and profile lookups while retaining the complete canonical validation and co-reference review rules.

  Keep retained preparation bound once in graph write-plan snapshots and restore its exact bytes at the atomic storage boundary. This prevents large source promotion from exceeding the runtime's JSON string limit through duplicated projection payloads. Recompute older serialized write plans before applying them; stored projections and contributions remain compatible.
- Updated dependencies [44c24f8]
- Updated dependencies [0e81abc]
- Updated dependencies [9529ecd]
- Updated dependencies [9564a6a]
- Updated dependencies [8df35fd]
- Updated dependencies [6117dd1]
  - @tangleai/documents@0.35.0
  - @tangleai/lightrag@0.35.0
  - @tangleai/forecast@0.35.0
  - @tangleai/grounding@0.35.0
  - @tangleai/hera@0.35.0
  - @tangleai/config@0.35.0
  - @tangleai/core@0.35.0
  - @tangleai/evolve@0.35.0
  - @tangleai/mas@0.35.0
  - @tangleai/memory@0.35.0
  - @tangleai/outcomes@0.35.0
  - @tangleai/trace2skill@0.35.0

## 0.34.0

### Minor Changes

- 8e34634: Add rules-first intent triage, durable one-question clarification and pinned atomic
  query plans with host-response fact projection. Compile grounding prompt packs,
  share enclosing call budgets with MAS, expose intent-only GMPL clarification and
  bind the existing SQLite queue to the optimizer. Retain native response fencing,
  replay, turn limits and explicit budget failure accounting.

### Patch Changes

- c643e1e: Compose durable grounded sessions through the native MAS workflow and SQLite
  worker, with typed clarification, bounded retrieval and validated claim ledgers.
  Register revision-pinned agent components under native physical-call accounting.
  Checkpoint ABI 7 excludes unused branch outputs from downstream input identities
  while preserving strict provenance checks. Add retained session readers and
  native queue recovery.
- d66c899: Add closed grounding profiles and evidence contracts with deterministic rule evaluation, revisioned session transitions and atomic memory/SQLite persistence.
- 2dce4bd: Add retained parent and child document evidence, shared bounded lexical retrieval,
  and governed hybrid local selection with atomic curator promotion. Preserve the
  flat defaults and consolidation scoring while fixing heading expansion and
  retaining superseded evidence addresses.
- a542379: Add bounded governed web retrieval with exact HTTP replay, cumulative plan budgets, atomic evidence traces and optional shared-budget model reranking. Enforce per-hop admission and protected mapped IPv6 addresses in the existing document fetcher. Share browser-safe HTML/text extraction and canonical HTTP capture identities with existing document and benchmark owners.
- Updated dependencies [c643e1e]
- Updated dependencies [8e34634]
- Updated dependencies [1c79b6a]
- Updated dependencies [d66c899]
- Updated dependencies [2dce4bd]
- Updated dependencies [8b85ba6]
- Updated dependencies [a542379]
  - @tangleai/grounding@0.34.0
  - @tangleai/mas@0.34.0
  - @tangleai/core@0.34.0
  - @tangleai/memory@0.34.0
  - @tangleai/documents@0.34.0
  - @tangleai/evolve@0.34.0
  - @tangleai/forecast@0.34.0
  - @tangleai/hera@0.34.0
  - @tangleai/trace2skill@0.34.0
  - @tangleai/config@0.34.0
  - @tangleai/outcomes@0.34.0

## 0.33.0

### Minor Changes

- a693543: Add closed forecasting records, atomic lifecycle commands and SQLite persistence
  with question-local provisional harnesses and cutoff-aware checkpoint identities.

### Patch Changes

- Updated dependencies [236b915]
- Updated dependencies [0ce15cb]
- Updated dependencies [a693543]
- Updated dependencies [c77869c]
- Updated dependencies [2d64db7]
- Updated dependencies [ebf85ec]
- Updated dependencies [77493ea]
  - @tangleai/forecast@0.33.0
  - @tangleai/outcomes@0.33.0
  - @tangleai/documents@0.33.0
  - @tangleai/evolve@0.33.0
  - @tangleai/hera@0.33.0
  - @tangleai/mas@0.33.0
  - @tangleai/memory@0.33.0
  - @tangleai/trace2skill@0.33.0
  - @tangleai/config@0.33.0
  - @tangleai/core@0.33.0

## 0.32.0

### Minor Changes

- 30e2ada: Execute mixed-group reflection and empirical experience learning with durable
  control receipts, bounded consolidation, atomic library and snapshot activation,
  and replay across SQLite reopen. Publish the scripted experience-only benchmark
  with training costs, held-out scores, operation counts and explicit refusals.
- 9ca82cd: Introduce evaluated orchestration contracts, immutable role artifacts and scope-bound learning state with version-and-revision activation fences. GMPL prompt artifacts accept namespaced pattern identifiers while its six executable recipe families remain closed.
- 52e3d5a: Generate validated query-specific candidate groups from frozen experience and prompt state, retain durable control-call receipts, and rank evaluated trajectories by task score before provider cost.
- 3612a48: Evaluate bounded registered-role topology mutations after persistent failure,
  retain measured outcomes and activate improving hints with the learning snapshot.
  Expose pure structural diagnostics and durable scoped mutation records.
- da00db9: Add scoped failure buffers, source-backed prompt proposals, whole-topology paired replay, guarded block integration and fenced activation or rollback. Retain trial decisions and complete purchase receipts, including failures and restart replay, with explicit refinement budgets. Measure prompt-only and combined learning rows with per-role churn, replay costs and a declared held-out loss.

### Patch Changes

- Updated dependencies [a2b9c9d]
- Updated dependencies [30e2ada]
- Updated dependencies [9ca82cd]
- Updated dependencies [52e3d5a]
- Updated dependencies [3612a48]
- Updated dependencies [da00db9]
- Updated dependencies [93058e4]
- Updated dependencies [cd88cec]
  - @tangleai/hera@0.32.0
  - @tangleai/mas@0.32.0
  - @tangleai/config@0.32.0
  - @tangleai/core@0.32.0
  - @tangleai/documents@0.32.0
  - @tangleai/evolve@0.32.0
  - @tangleai/memory@0.32.0
  - @tangleai/outcomes@0.32.0
  - @tangleai/trace2skill@0.32.0

## 0.31.0

### Patch Changes

- c3e72e6: Complete conditional experiment workflows over durable MAS jobs, preserve settled worker evidence across response loss, and match effect responses to their own stages. Registry consumers now await evolveRegistryDocument with the workflow profile and experiment ceiling to pin its embedded graph versions.

  Add deterministic strategy selectors and an injected, budgeted structured proposal seam. Publish the registered keyless selection comparison with an inconclusive result and retain the unranked default. Surface workspace census and effect-job lease failures.

  Semantic key kinds now reject empty values, whitespace and NUL with TEVO1001 in both evolve stores, preventing namespace collisions. Existing valid key encodings and opaque key values remain compatible.
- Updated dependencies [d6bc2fd]
- Updated dependencies [c3e72e6]
  - @tangleai/documents@0.31.0
  - @tangleai/evolve@0.31.0
  - @tangleai/config@0.31.0
  - @tangleai/core@0.31.0
  - @tangleai/mas@0.31.0
  - @tangleai/memory@0.31.0
  - @tangleai/outcomes@0.31.0
  - @tangleai/trace2skill@0.31.0

## 0.30.1

### Patch Changes

- Move the store onto the Jaren 0.91.4 registry foundation and source pin. The new foundation fixes four quirks of the native store's relational entity path: a declared index on a foreign-key column is the key's own index, a set-null foreign key reopens, session capture decodes a table that gained a column by `ADD COLUMN`, and an additive migration on a table with a foreign key or an enum check is accepted. They are evaluated and have nothing to change in Tangle: its database model declares document collections only, with no entity, relation or foreign key, so no Tangle path reached the defects and there was no local workaround to remove. Every keyless benchmark document is requalified against the new foundation.
- @tangleai/config@0.30.1
  - @tangleai/core@0.30.1
  - @tangleai/documents@0.30.1
  - @tangleai/evolve@0.30.1
  - @tangleai/mas@0.30.1
  - @tangleai/memory@0.30.1
  - @tangleai/outcomes@0.30.1
  - @tangleai/trace2skill@0.30.1

## 0.30.0

### Patch Changes

- Updated dependencies
  - @tangleai/memory@0.30.0
  - @tangleai/evolve@0.30.0
  - @tangleai/outcomes@0.30.0
  - @tangleai/config@0.30.0
  - @tangleai/core@0.30.0
  - @tangleai/documents@0.30.0
  - @tangleai/mas@0.30.0
  - @tangleai/trace2skill@0.30.0

## 0.29.8

### Patch Changes

- Move the store onto the Jaren 0.91.2 registry foundation and source pin. The
  underlying native store's relational, jobs, live-query and migration modules are
  refactored around the new PostgreSQL parity work; Tangle reads them through the
  existing `openStore`, `db.jobs` and `planPhysicalMigration` seams with no API
  change. The PostgreSQL Store, its notifications and the asynchronous `asyncLive`
  resnapshot mode are evaluated and not adopted: Tangle stays on local SQLite with
  the synchronous incremental live-query engine. The desktop folder watcher now
  serializes its passes through Jaren's `createLatestDelivery`, so a change window
  that closes during the start scan runs right after it. Every keyless benchmark
  document is requalified against the new foundation, and checkpoints written
  under the previous foundation are refused rather than silently resumed.
- @tangleai/config@0.29.8
  - @tangleai/core@0.29.8
  - @tangleai/documents@0.29.8
  - @tangleai/evolve@0.29.8
  - @tangleai/mas@0.29.8
  - @tangleai/memory@0.29.8
  - @tangleai/outcomes@0.29.8
  - @tangleai/trace2skill@0.29.8

## 0.29.7

### Patch Changes

- Updated dependencies
  - @tangleai/evolve@0.29.7
  - @tangleai/config@0.29.7
  - @tangleai/core@0.29.7
  - @tangleai/documents@0.29.7
  - @tangleai/mas@0.29.7
  - @tangleai/memory@0.29.7
  - @tangleai/outcomes@0.29.7
  - @tangleai/trace2skill@0.29.7

## 0.29.6

### Patch Changes

- Updated dependencies
  - @tangleai/evolve@0.29.6
  - @tangleai/config@0.29.6
  - @tangleai/core@0.29.6
  - @tangleai/documents@0.29.6
  - @tangleai/mas@0.29.6
  - @tangleai/memory@0.29.6
  - @tangleai/outcomes@0.29.6
  - @tangleai/trace2skill@0.29.6

## 0.29.5

### Patch Changes

- Updated dependencies
  - @tangleai/evolve@0.29.5
  - @tangleai/config@0.29.5
  - @tangleai/core@0.29.5
  - @tangleai/documents@0.29.5
  - @tangleai/mas@0.29.5
  - @tangleai/memory@0.29.5
  - @tangleai/outcomes@0.29.5
  - @tangleai/trace2skill@0.29.5

## 0.29.4

### Patch Changes

- Updated dependencies
  - @tangleai/evolve@0.29.4
  - @tangleai/config@0.29.4
  - @tangleai/core@0.29.4
  - @tangleai/documents@0.29.4
  - @tangleai/mas@0.29.4
  - @tangleai/memory@0.29.4
  - @tangleai/outcomes@0.29.4
  - @tangleai/trace2skill@0.29.4

## 0.29.3

### Patch Changes

- Updated dependencies
  - @tangleai/evolve@0.29.3
  - @tangleai/config@0.29.3
  - @tangleai/core@0.29.3
  - @tangleai/documents@0.29.3
  - @tangleai/mas@0.29.3
  - @tangleai/memory@0.29.3
  - @tangleai/outcomes@0.29.3
  - @tangleai/trace2skill@0.29.3

## 0.29.2

### Patch Changes

- Updated dependencies
  - @tangleai/evolve@0.29.2
  - @tangleai/config@0.29.2
  - @tangleai/core@0.29.2
  - @tangleai/documents@0.29.2
  - @tangleai/mas@0.29.2
  - @tangleai/memory@0.29.2
  - @tangleai/outcomes@0.29.2
  - @tangleai/trace2skill@0.29.2

## 0.29.1

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @tangleai/evolve@0.29.1
  - @tangleai/config@0.29.1
  - @tangleai/core@0.29.1
  - @tangleai/documents@0.29.1
  - @tangleai/mas@0.29.1
  - @tangleai/memory@0.29.1
  - @tangleai/outcomes@0.29.1
  - @tangleai/trace2skill@0.29.1

## 0.29.0

### Patch Changes

- c9fbe66: Add the contracts an isolated repository experiment is made of, as a zero-I/O package that cannot merge anything. Every record is closed and content-addressed — its id is the canonical hash of its own bytes without the id, and no clock enters that hash, so the same experiment re-derived later has the same address and a replay can prove it read what it claims to have read. The lifecycle is one pure exhaustive table: every status and command pair is either the single legal target or a refusal pointing at `/status`, and the four terminal statuses accept nothing, so a stopped experiment cannot be nudged back into motion by a second command. A principal carries `propose`, `execute` and `approve` and the schema refuses a `merge`, `push` or `promote` member: the authority to land a change is absent from the vocabulary rather than defended at a call site, and keeping a change produces a branch and a review bundle for a person to merge. Budgets name every bound an experiment can reach, with `attemptsPerLeg` pinned at one, because a process boundary that was lost is not evidence the effect did not happen. `EvolveStore` keeps immutable records apart from the one revision-fenced experiment row: writing the same bytes twice is a read, writing different bytes under an existing id is refused, and a status moves only under compare-and-swap — with an in-memory reference and a SQLite adapter whose answers are asserted identical over one recorded scenario. Strategies are written through the owners that already exist, one skill in the context ledger and one memory carrier in the outcome store, and a refusal from either is carried back with its own reason intact. The `evolve-experiment/v1` outcome adapter scores a kept change as success and an equal one as partial, and counts a refusal as a strategy failure rather than a neutral event.
- c9fbe66: Add the Node-only host that runs an experiment without ever holding the authority to land one. A command is selected by name from a table the host wrote, so nothing that crossed a trust boundary can become an executable, an argument a validator did not accept, a working directory outside the declared root — checked after resolving both ends, so a symlink cannot walk out — or an environment variable the allow-list does not carry. The git vocabulary is an allow-list of whole argument vectors: `push`, `merge`, `switch`, `checkout`, `reset`, `rebase`, `remote` and `config` are not refused, they are absent, and so are the global options that would let git run something else or somewhere else. A ref is either an experiment branch or a pinned commit; every other spelling fails before a spawn. The worktree host refuses a root inside the repository, a dirty base, a second experiment on an existing branch, a write that traverses out through `..` or a symlinked parent, and a commit whose HEAD is read at the moment of committing rather than assumed. A removal that does not succeed is uncertain rather than failed, because a workspace that may still exist is a question for a person. Every effect is one leg of a fenced operation over the suite's external-effect store on the Tangle database: the intent is written before anything reaches the world, the outcome is classified from exit codes and never from what the child printed, a single-send leg is never retried, and a plan id is semantic — so a resumed experiment reads what happened instead of making it happen again. The instrument's four host probes now execute rather than declaring themselves missing.
- Updated dependencies [c9fbe66]
- Updated dependencies [97e0ae8]
- Updated dependencies [3a58abf]
- Updated dependencies [c9fbe66]
- Updated dependencies [81c14e4]
  - @tangleai/evolve@0.29.0
  - @tangleai/config@0.29.0
  - @tangleai/core@0.29.0
  - @tangleai/documents@0.29.0
  - @tangleai/mas@0.29.0
  - @tangleai/memory@0.29.0
  - @tangleai/outcomes@0.29.0
  - @tangleai/trace2skill@0.29.0

## 0.28.0

### Minor Changes

- f2eb14d: Keep the evidence an accepted verdict was recorded against. The model gains `feedback_notes` — one row per evidence source, addressed by the source id the resolution names and indexed by the message it is about, holding the sealed snapshot with the digest that snapshot hashes to. A trusted evidence resolver reads that row back rather than rebuilding it, so a snapshot that is gone or whose bytes have moved is refused by the outcome lifecycle instead of quietly re-agreeing with itself. The transcript rows gain the decision a reply is and the verdict recorded against it, so a surface can show what was recorded without re-deriving it.
- f2eb14d: Give every run a persisted, append-only frame stream addressed by `(runId, seq)`. The model gains `run_frames` — one row per thing a run did, its body closed per kind by a validator at the write and its sequence read from the store inside the appending transaction, so a restart, a second process or two concurrent appends can never mint the same address twice — and `runs.status` gains `cancelled`, a terminal state distinct from both success and failure. `createRunLog` adds `appendFrame`, `frames`, `replayPage`, `subscribeRun` and `subscribeRuns`: a subscriber names the run it watches and resumes by the sequence it reached, a replay page carries exactly the frames above a cursor and never asks for a reset, and the live emission's store-wide capture sequence is re-emitted under the appended frame's own, so a resume cursor means the same thing live and replayed. `finishRun` writes the run row and the run's single terminal frame in one transaction — including a refused finish — and `recordEvent` keeps its signature over the new stream. The existing `events` collection stays declared and is read-only: a run has rows in exactly one of the two, and `getRun` answers their union plus the run's frame count. Folder passes record what they counted: the `sync` frame kind carries the trigger that asked for a pass and the scanned, ingested, skipped, removed, truncated and orphaned-unit numbers it produced, closed like every other body so a member nobody declared is refused at the write.
- f2eb14d: Add immutable skill directories, the anchored directory-patch compiler and revision-fenced activation, with in-memory and SQLite storage, plus starting-directory import, a trajectory-blind draft, a bounded executor that uses a directory directly, a resumable labeled-rollout fan-out, and one independent analyst per rollout whose failure path may propose a patch only after the host evaluator passes over a repair made in an in-memory sandbox, and hierarchical conflict-free consolidation of the whole patch population into one patch applied exactly once through a guarded editor into a staged immutable candidate. Role prompts ship as five versioned TOML packs compiled into an immutable artifact set published at `./artifacts`, whose revisions are the prompt versions a run's idempotency keys name, and a host can use an active directory directly — its root page composed into the request as data and one read-only tool over the rest — with no retrieval index between the directory and the task.
- f2eb14d: Keep a produced measurement document under the identity its own instrument computed. The model gains `reports` — one row per document, keyed by that identity and indexed by instrument and instant, holding the document, its byte size, the run that produced it and the source manifest the document itself declares — so a host can address a report by identity, re-derive that identity from the stored bytes, and answer honestly when they no longer agree instead of repairing a row nobody is allowed to repair. Because an instrument re-run over an unchanged tree recomputes the same identity, the second write is a read: the row is already there, and the run that stored it keeps its name. Runs gain the two frame kinds a measurement needs: `progress`, a bounded batch of output lines from one stream with the number a producer had to drop rather than grow the stream without limit, and `report`, the identity, instrument, schema, byte size, file count and whether this run stored the document or found it already held. Both bodies are closed like every other frame body, so a member nobody declared is refused at the write.

### Patch Changes

- f2eb14d: Move the store onto the Jaren 0.90.6 registry foundation and source pin. The
  underlying native store now retries a classified busy failure of its idempotent
  open sequence, yielding between bounded attempts so a competing opener can
  finish, and closes capture's first-open transaction before the collection cores
  are constructed. Bun connections drain their native statements on close. Tangle
  reads these through the existing `openStore` seam: no Tangle API changes, and
  the synchronous live-query engine the memory store depends on is retained
  rather than traded for the new asynchronous worker, pool and process hosts.
  Every keyless benchmark document is requalified against the new foundation; the
  executable identity a run records moves with the installed suite version, so
  checkpoints written under the previous foundation are refused rather than
  silently resumed.
- Updated dependencies [f2eb14d]
- Updated dependencies [f2eb14d]
  - @tangleai/outcomes@0.28.0
  - @tangleai/trace2skill@0.28.0
  - @tangleai/config@0.28.0
  - @tangleai/core@0.28.0
  - @tangleai/documents@0.28.0
  - @tangleai/mas@0.28.0
  - @tangleai/memory@0.28.0

## 0.27.3

### Patch Changes

- Updated dependencies [9f7d8c8]
  - @tangleai/core@0.27.3
  - @tangleai/config@0.27.3
  - @tangleai/documents@0.27.3
  - @tangleai/mas@0.27.3
  - @tangleai/memory@0.27.3
  - @tangleai/outcomes@0.27.3

## 0.27.2

### Patch Changes

- 1a1cf01: Integrate the Jaren 0.89.0 registry foundation and source pin. Qualify guarded host migrations with preserved Tangle evidence, durable replay and failure isolation, and native Markdown page breaks through the existing assistant renderer. Preserve the selected memory policy and requalify current benchmark evidence.
- @tangleai/config@0.27.2
  - @tangleai/core@0.27.2
  - @tangleai/documents@0.27.2
  - @tangleai/mas@0.27.2
  - @tangleai/memory@0.27.2
  - @tangleai/outcomes@0.27.2

## 0.27.1

### Patch Changes

- Updated dependencies [422afcd]
  - @tangleai/memory@0.27.1
  - @tangleai/config@0.27.1
  - @tangleai/core@0.27.1
  - @tangleai/documents@0.27.1
  - @tangleai/mas@0.27.1
  - @tangleai/outcomes@0.27.1

## 0.27.0

### Minor Changes

- d4d8d0b: Add immutable consolidation source snapshots, artifacts, bounded pending buffers and atomic pass/operation receipts with memory and Node/Bun SQLite parity. Preserve source evidence and qualify replay, rollback, concurrent activation and installed consumers.

### Patch Changes

- Updated dependencies [84fe0a2]
- Updated dependencies [6dcfde9]
- Updated dependencies [a6fa7f3]
- Updated dependencies [d4d8d0b]
- Updated dependencies [63504f3]
- Updated dependencies [7f2e26f]
  - @tangleai/memory@0.27.0
  - @tangleai/core@0.27.0
  - @tangleai/outcomes@0.27.0
  - @tangleai/documents@0.27.0
  - @tangleai/config@0.27.0
  - @tangleai/mas@0.27.0

## 0.26.3

### Patch Changes

- 9cc91c1: Keep SQLite verification scratch owned by the Node parent until each tested runtime exits, preserving close/reopen checks and failing persistent cleanup errors.
- Updated dependencies [36b6a1d]
- Updated dependencies [9cc91c1]
  - @tangleai/outcomes@0.26.3
  - @tangleai/memory@0.26.3
  - @tangleai/config@0.26.3
  - @tangleai/core@0.26.3
  - @tangleai/documents@0.26.3
  - @tangleai/mas@0.26.3

## 0.26.2

### Patch Changes

- b03ca31: Correct package ownership checks for native and escaped filesystem paths. Let the backup probe parent clean its temporary directory after the Node or Bun child exits, retaining every WAL snapshot, integrity, cancellation and zero-effect replay assertion and failing on persistent cleanup errors.
- Updated dependencies [4c42ba1]
  - @tangleai/memory@0.26.2
  - @tangleai/config@0.26.2
  - @tangleai/core@0.26.2
  - @tangleai/documents@0.26.2
  - @tangleai/mas@0.26.2
  - @tangleai/outcomes@0.26.2

## 0.26.1

### Patch Changes

- @tangleai/config@0.26.1
  - @tangleai/core@0.26.1
  - @tangleai/documents@0.26.1
  - @tangleai/mas@0.26.1
  - @tangleai/memory@0.26.1
  - @tangleai/outcomes@0.26.1

## 0.26.0

### Minor Changes

- 6e0f5be: Add opt-in evidenced temporal memory with distinct occurrence, observation, knowledge and validity semantics, bounded structured preparation, immutable SQLite projections and cited calendar answers. Qualify public Node, Bun and browser consumers, strict temporal fixtures and both full LongMemEval source profiles. Preserve ordinary recall defaults; live temporal QA gains and deployment costs remain unmeasured.

### Patch Changes

- Updated dependencies [6e0f5be]
  - @tangleai/core@0.26.0
  - @tangleai/memory@0.26.0
  - @tangleai/documents@0.26.0
  - @tangleai/outcomes@0.26.0
  - @tangleai/config@0.26.0
  - @tangleai/mas@0.26.0

## 0.25.1

### Patch Changes

- Consume the exact Jaren 0.87.0 registry packages and source pin. Qualify native SQLite schema changes, column references, JSON type inspection and per-call mutation semantics alongside Tangle records across Node, Bun and installed consumers. Preserve the existing document storage model and historical paid measurements.
- Updated dependencies
  - @tangleai/core@0.25.1
  - @tangleai/config@0.25.1
  - @tangleai/mas@0.25.1
  - @tangleai/documents@0.25.1
  - @tangleai/memory@0.25.1
  - @tangleai/outcomes@0.25.1

## 0.25.0

### Patch Changes

- Enforce semantic template binding targets, monotone caps and tool subsets at admission and instantiation. Pin and capture host message adapter versions, check child graph bindings, and preserve optional no-change instantiation.

  Enforce workflow concurrency through Jaren scheduling, retain failed physical request costs in durable receipts, restore switch outputs from committed branches, and preserve hierarchical message paths. Advance the runtime checkpoint ABI for the changed execution semantics.

  Compose durable human waits through nested graphs, switches and loop iterations.
  Derive interaction ids from full paths, reconcile the current reserved resume
  segment, and reject conflicting response bytes under an existing key. Drain
  started host lifetimes before reporting failure or suspension.

  Enforce physical-request context and retained trace quotas, retain the shared
  account's provider-total or estimated token charge, and claim-fence cumulative
  active-time settlement across resumable segments. Quota refusals roll back the
  attempted payload while retaining actual failure costs.
- Updated dependencies
  - @tangleai/mas@0.25.0
  - @tangleai/config@0.25.0
  - @tangleai/core@0.25.0
  - @tangleai/documents@0.25.0
  - @tangleai/memory@0.25.0
  - @tangleai/outcomes@0.25.0

## 0.24.1

### Patch Changes

- Update the Jaren foundation to 0.86.0 with exact registry and source pins. Qualify supervised Node SQLite execution, outcome replay after native backups, and physical-model authoring through the shared Data editor. Document the available relational, migration, cursor and collection-drag mechanisms and their host boundaries.
- @tangleai/config@0.24.1
  - @tangleai/core@0.24.1
  - @tangleai/documents@0.24.1
  - @tangleai/mas@0.24.1
  - @tangleai/memory@0.24.1
  - @tangleai/outcomes@0.24.1

## 0.24.0

### Minor Changes

- Add the outcomes package for independently evidenced decisions, deterministic scoring, atomic confidence projection, bounded artifact refinement and explicitly approved promotion and rollback. The public operation contract, two-domain adapter kit and keyless example share the same scoped request receipts, one-use held-out gates, full head revision checks and interruption recovery.

  The store adapter owns outcome records and memory changes in one SQLite transaction. The new pure confidence helper preserves fact fields; existing applyOutcome calls retain their original duplicate-citation and timestamp behavior and do not acquire a durable replay guarantee. No existing persisted memory format changes. Hosts opt into the new lifecycle, provide evidence and approval authority, and use a new artifact key for schema or policy changes. Scripted paired measurements and Node/Bun packed consumers qualify the mechanism; downstream domain integrations and automatic promotion remain separate work.

### Patch Changes

- Updated dependencies
  - @tangleai/outcomes@0.24.0
  - @tangleai/memory@0.24.0
  - @tangleai/config@0.24.0
  - @tangleai/core@0.24.0
  - @tangleai/documents@0.24.0
  - @tangleai/mas@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies
  - @tangleai/memory@0.23.0
  - @tangleai/config@0.23.0
  - @tangleai/core@0.23.0
  - @tangleai/documents@0.23.0
  - @tangleai/mas@0.23.0

## 0.22.0

### Patch Changes

- @tangleai/config@0.22.0
  - @tangleai/core@0.22.0
  - @tangleai/documents@0.22.0
  - @tangleai/mas@0.22.0
  - @tangleai/memory@0.22.0

## 0.21.1

### Patch Changes

- Update the exact Jaren foundation dependencies and source pin to the published
  0.84.3 release after verifying its AI-free archives against source-built bytes.
  Retain Tangle's model, context and agent ownership and align the development
  Node pin with 24.20.0. Tangle publication remains a manual author action.
  Allow release preparation after an already committed local release while
  preserving its record and rejecting unprepared version edits.
- Updated dependencies
  - @tangleai/core@0.21.1
  - @tangleai/config@0.21.1
  - @tangleai/mas@0.21.1
  - @tangleai/documents@0.21.1
  - @tangleai/memory@0.21.1

## 0.21.0

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.21.0
  - @tangleai/config@0.21.0
  - @tangleai/mas@0.21.0
  - @tangleai/documents@0.21.0
  - @tangleai/memory@0.21.0

## 0.20.1

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.20.1
  - @tangleai/config@0.20.1
  - @tangleai/documents@0.20.1
  - @tangleai/mas@0.20.1
  - @tangleai/memory@0.20.1

## 0.20.0

### Minor Changes

- Establish the coordinated 0.20.0 release with JavaScript and TypeScript declaration distributions, preserved public subpaths and JSON schemas, and verified Node and Bun consumers. Use published JarenJS 0.83.3 fixes without a consumer installation patch. Prepare versions before release commits, verify locally, push directly to main and publish CI-verified tarballs. Deploy the website independently from local Tangle workspace source with JarenJS packages from npm, verifying dependency sources and the live commit.

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.20.0
  - @tangleai/config@0.20.0
  - @tangleai/mas@0.20.0
  - @tangleai/documents@0.20.0
  - @tangleai/memory@0.20.0
