# @tangleai/os

## 0.75.0

### Minor Changes

- Jobs takes `configure: null` for a host where nothing can be set up: a part without a job queue then says that no background work runs there and why there is nothing to set up, and offers no way to Settings. Without the option, Jobs still offers Settings, as before.

  Desktop text keys since v0.74.0:

  - Added (2): `jobs/none`, `jobs/none-detail`

## 0.74.0

### Minor Changes

- 6051715: The desktop follows the background work of every product a host runs. A `JobQueue` may answer `scopes()` with the products it serves (`JobScope`: a scope and its title per language); a queue without it is one unnamed product, and every call site works with both. Every call to a queue with several products names its scope, since such a queue refuses a call without one (`OS0194`).

  Jobs shows one product at a time. With more than one, the header offers a product choice and a quiet row above the states gives each product's failed and waiting counts; choosing one reloads the app for that product. With one product nothing changes.

  `watchJobs` looks at every product in turn, so a job given up in the second product reaches the inbox as well as one in the first. Item ids carry the scope (`job-failed-<scope>-<job>`, `runtime-silent-<scope>-<runtime>`), a dismissal is remembered per product and job, and the inbox items name the product. A product the person may not read, or one whose host does not answer, is skipped quietly while the others are still watched.

  The kernel's `tangle_os_jobs` tool gains the read `jobs.scopes`, every read takes an optional `scope`, and a suggested change or a failed-job item carries the scope and the product's title, so accepting it acts in that product. The Calendar shows each product's upcoming runs, titled with the product's name when there is more than one, and exports them together.
- c21713a: A product runs its background work in its own process, on its own store. `productJobs` from `@tangleai/ops/product` starts the operations runtime on a product's store, which is where the product enqueues jobs inside its own transactions and fences its pushes. It serves the store's queue through the `job_queue` contract at the product's own address, `/<scope>/api/job-queue`. A suite's server module calls it in `start` and answers requests with its `handle`, and the host's authorization by path then guards each product's jobs with that product's rights.

  A desktop shows several products through `combinedJobQueue` from `@tangleai/os/jobs`. Every call goes to the scope it names, a call without one is refused `OS0194` when there are several, and `scopes()` lists them for a picker. Measured in one process: two products with a job kind of the same name never answer for each other. One product failing five times left the other running every second, with its largest gap 1,006 ms. A single-send job in each is called once when its runtime is replaced inside a lease. The packed packages start `productJobs` under Node and Bun.

  The Tangle desktop app takes several host modules (`--ops a.ts,b.ts`), each in its own supervised worker with its own store, under the scope the module exports or its file's name. One module behaves as before.
- 632315c: `@tangleai/ops/simulate` shows what a job registry will do. `simulateRegistry` runs the registry over 1 to 31 days on its own in-memory store with its own clock: every handler is a recorder, so no operation, page task or host code is ever called, and every history event is marked simulated. The clock moves only while no attempt is in flight. It answers per day and job: the runs, those completed, retried, given up and not repeated (a failed single-send), those a budget skipped, and the runs a clock change moved or repeated. With a failure rate the failures are decided by a seed, so the same seed gives the same answer. The simulation assumes the host is up the whole time, so a lateness window, which only skips runs after downtime, never applies. `registryFromHost` rebuilds a registry from what the `job_queue` contract answers (the registered jobs and their schedules), and `ruleText` writes a stored rule back as RFC 5545 text. Measured: 30 days of a seven-job registry across the spring clock change reproduce the parity counts per day exactly (18,729 runs in about 12 s in Node).

  Jobs takes a `simulate` option and then offers "What will happen" under the schedules. The person chooses 1, 7 or 30 days and a failure rate of 0, 5 or 20 %. The answer is a table of runs per job and day, with retries, given-up and not-repeated jobs and clock-change marks, and a note that nothing ran. The Pages desktop runs it in a worker of its own (`os-ops-sim-worker.js`) that is started for one answer and then ended. A week of the Pages registry, 10,087 runs, takes about 9 s in Chromium and 32 s in Firefox. The browser twin's own store holds nothing of a simulation.

## 0.73.0

### Minor Changes

- 41c27ac: The Pages desktop's Calendar shows the background work's upcoming runs as a quiet, read-only layer under the person's own events. A run shows by its registered job's title. A schedule that runs more often than daily is one line a day with its count: every minute is "1,440 runs", never 1,440 items, and a 23-hour clock-change day counts 1,380. A run the spring clock change moved is marked as moved. A month cell with several runs shows a compact count, with the runs in its tooltip, and the selected day lists them under "Background work". The Calendar's menu, and its section in Settings, hide and show the layer. "Export upcoming runs (.ics)" writes the next 30 days as an iCalendar file with only each run's title, UTC start and identity (`<schedule>@<recurrence>`), and a frequent schedule as one all-day count a day. Runs are never the person's busy time. Without a job host, or while it starts, the Calendar draws no runs and offers no run export.

  `scheduledRuns(schedules, registry, from, to)` in `@tangleai/os/jobs-app` gives a range of runs as a calendar shows them. `nextRuns` now compiles a schedule's series again from its JSON. A series that crossed a contract is JSON, which Jaren's calendar does not expand as it is, so Jobs showed no next runs for a real host's floating schedule. Each run also carries Jaren's recurrence id.

## 0.72.0

### Minor Changes

- 81c2c02: Background work that needs a person now reaches them. `watchJobs({ kernel, queue, hours, remember })` reads a host's job queue once an interval (30 s by default). It files one inbox item per job that died, per single-send job a crash cut off (not repeated), per job on its third failed attempt, and per background runtime that stopped reporting for 90 s. An item is updated in place, never duplicated, and a runtime that reports again takes its item back. Before this, a failed job was noticed only when someone opened the place that lists them.

  A failed job's item offers Run again, which requeues the job once and only if it still needs the person, otherwise answering `OS0112`. It also offers Dismiss, which does nothing, and Open Jobs. What the person decided is remembered (`remember`), so a dismissed failure is not filed again after a reload unless the job fails anew. A silent runtime's item offers Open Jobs and Dismiss. The other system's error text is quoted and marked as data, never instructions.

  The item is filed at once, but its notice waits for the person's working hours. The notice is the item's `attention`, which rings the dock's mail button and adds "needs your attention" to its name. When the working hours are unknown, no notice is given. When a working period begins, every item still open is noticed again. The Pages desktop reads the working hours from the Calendar and starts the watcher over its job queue; Forget everything also removes what the watcher remembered. Every new sentence is in all eleven packs.

## 0.71.0

No changes in this release.

## 0.70.0

### Minor Changes

- 27dca48: The Pages desktop runs its background work in the browser when no job host address is set. The jobs run in a worker of an open desktop tab, and that tab's worker serves them to every tab. Under automation this browser twin is off unless a page asks for it with `?twin=1`, and `?twin=0` turns it off. A twin that cannot start never stops the desktop. Jobs then says it could not start in this browser, and why.

  The showcase registry is a document with two jobs. Calendar reminders runs every minute and files one inbox message per calendar event starting within 15 minutes, keyed by the event's occurrence, so a run in another tab sends nothing twice. Inbox tidy count runs daily at 03:00 in the person's own time zone and counts the read messages older than 30 days. It deletes nothing. Watching a web page is not scheduled by default.

  Settings → Background work says where the work runs. Forget everything also deletes the store the twin keeps in this browser, and the privacy text names it.

  Jobs keeps the schedules' own enqueue jobs (`ops.fire`) out of its list and out of the waiting count, and says in one quiet line how many there were. While the browser twin has not answered yet (`OS0195`), Jobs says it is starting instead of offering Settings. The heartbeat line says whether the runtime's store is kept in this browser and whether this tab runs it.

### Patch Changes

- 5c3dcd1: `@tangleai/ops/browser` runs the operations runtime in a browser, in a dedicated worker of the page and never in the page itself. Every tab starts one with `startTwin`. The workers queue on one Web Lock, and the worker holding it owns the store: SQLite on OPFS, else an IndexedDB snapshot, else memory. A handle the previous owner still holds is waited for, never read as missing. The owner runs the registry and serves the `job_queue` contract on a BroadcastChannel that every tab reads through `browserJobQueue`.

  A job whose handler is `{ contract: 'desktop', operation }` calls the owner's own page. The page serves its tasks under `desktopTaskContract`, and each call receives the job it runs for. A runtime contract client with `invokeJob` is given the job's id, attempt and kind. A page ends its worker on the document's `freeze` event and on `pagehide`, because a frozen tab keeps its lock (measured), and starts a new one when it resumes. `forgetBrowserOps` deletes the runtime's OPFS pool and IndexedDB snapshot.

  Measured in Chromium and Firefox over 10 reloads, 20 closes of the owner's tab, 100 concurrent requests from two tabs and a frozen owner: no single-send task was called twice and no answer crossed. Every takeover kept the same OPFS store, with a median of 141 to 217 ms, and the frozen owner in Chromium handed over in 216 ms.

  `@tangleai/os/jobs` adds `OS0195`, meaning the background runtime is starting or changing tabs. `jobs.health` now says where a browser runtime keeps its store and which tab owns it.

## 0.69.1

No changes in this release.

## 0.69.0

### Minor Changes

- 4b99ca4: Jobs shows what a host's operations runtime did. A schedule the host's registry set shows the registered job's title in the person's language and a Run now button instead of Remove: the registry owns that schedule. A job that must never run twice is first asked once in place ("This sends once; it is not repeated."), and a run refused because one already waits or runs is said with its code. A job's detail lists its attempts, oldest first, each with when it started, how it ended, how long it took and the first line of its error. An attempt a crash cut off is said to be lost and not repeated, and one a daily budget refused is said plainly. While the runtime reports, a quiet line says when it was last seen; when it has been silent for more than 90 seconds, a warning says for how long. A host without these operations answers nothing for them, and Jobs then shows none of it. Every sentence is in all twelve languages.
- 5dd2c32: The `job_queue` contract shows what a host's runtime did. `jobs.events` answers the attempts it recorded, newest first: started, completed, failed, lost, cancelled, not repeated, and refused by a budget. They can be filtered by job, kind and time, and none carries a payload. `jobs.health` answers when each runtime last reported, with the host's own time. `jobs.registry` answers the jobs the host's registry declares: their titles, how safe each is to repeat, and their schedules. `jobs.run` runs a registered job once, and is refused while a job of that kind waits or runs.

  `jobQueueProvider(store, { runtime })` serves the four operations from a running `createOpsRuntime`, taking the runtime's leases for cancel. It answers empty without a runtime or a history, and refuses to remove a schedule the host's registry set (`OS0192`).

  The assistant's `tangle_os_jobs` reads the attempts, the heartbeats and the registry under its grants, and every message or error another system wrote reaches it framed as data, never instructions. With `jobs.suggest` and `action: 'run'` it can suggest running a registered job now. The suggestion waits in the inbox, and the job runs once when the person accepts.

## 0.68.0

No changes in this release.

## 0.67.0

### Minor Changes

- e9859ce: The desktop has Jobs (`@tangleai/os/jobs-app`), the background work of a host read through the `job_queue` contract. `jobsModule({ queue, zoneProvider })` shows the counts per state with failed and given-up jobs first. Its Schedules view says each schedule's rule in words in the person's language (every so many seconds, minutes or hours; a day, weekdays or days of the month at their times; any other rule as its RRULE text) with the next three runs, computed from the rule with Jaren's calendar in the schedule's own time zone, marking a run the spring clock change moves and a wall time the autumn change repeats. Its Queue view lists the jobs of a state, fifty at a time, with their attempts, when they are due and the first line of their last error, and a job's details on selection. Skipped runs are shown only beside the runs that passed while the host was stopped, because skipped alone undercounts a downtime. The person cancels, runs a job again or removes a schedule, each asked once in place, and the answer or the coded refusal (`OS0191`, `OS0192`, `OS0193`) is said in the status line. Without a job host (`OS0190`) Jobs says so and opens Settings. Every sentence is in all eleven packs. The Pages desktop places Jobs beside Web.
- c1fca28: The desktop and its assistant read a host's background work. `createKernel({ jobs })` takes a host's `JobQueue`; without one, every call answers `OS0190`. `kernel.jobQueue()` gives the person's own Jobs app the queue itself. The kernel's contract `tangle_os_jobs` gives the assistant and granted modules `jobs.counts`, `jobs.page`, `jobs.get` and `jobs.schedules` under the same grants as every other contract, each call in the ledger. A job's payload never reaches them.

  The assistant changes nothing itself. `jobs.suggest` (cancel, requeue or remove a schedule, with a reason) files the desktop's own proposal `job.change` in the person's inbox. The desktop carries it out once when the person accepts, and only if the job's state, or the schedule, has not changed since it was suggested; otherwise the proposal stays pending with `OS0112`.

  The Pages desktop sets the job host's address in Settings, Background work, with the same local-network handling as Web access. The Tangle desktop app serves its own store's queue at `/api/job-queue` to the pages the web reader admits.

## 0.66.0

### Minor Changes

- 9496bb4: The desktop can read a host's background work. `@tangleai/os/jobs` defines the `job_queue` contract:
  - reads: how many jobs are in each state and how many wait per kind, a page of jobs by state and kind, one job with its attempts and last error, and every recurring schedule with its rule, zone, state, and next and last run;
  - steers: cancel, requeue and unschedule.

  A job's payload and result never cross the contract. Every call takes an optional `scope`. `httpJobQueue(baseUrl)` calls a host that serves the contract, and `unconfiguredJobQueue()` answers `OS0190`. The other refusals are `OS0191` (no such job or schedule), `OS0192` (its state forbids the call), `OS0193` (another process runs the job) and `OS0194` (a scope the host does not serve).

  The new package `@tangleai/ops` serves the contract over any Jaren store opened with `jobs`. Each call maps onto Jaren's own fenced operation: a running job is cancelled only with the lease the host's worker holds, so a job another process runs is refused rather than stolen.

## 0.65.4

### Patch Changes

- 2205b3a: The Pages desktop's assistant replies in the language of the person's last message and addresses the person formally in every language that has a formal form: u in Dutch, Sie, vous, usted, o senhor or a senhora, Вы and siz, and the polite forms in Japanese, Korean and Chinese. This applies to its replies and to the text of applications it writes. Re-measured with `anthropic/claude-haiku-5.5`:
  - web reading: 21 of 21;
  - authoring conversations: 15 of 16 in English and 16 of 16 in Dutch.

  Every Dutch reply and application uses u, and no English request was answered in another language. Before the change, about half of the Dutch replies used je.

## 0.65.3

### Patch Changes

- ee9a157: The web-reading measurement adds two more planted notes: one in Dutch on a Dutch page, and one in the text of a link. With `anthropic/claude-haiku-5.5`, 20 of 21 turns worked (45 requests). In all nine turns on the three pages with a planted note, the assistant answered the question, put nothing in the inbox and called no other tool, and it told the person it had ignored the note. The one failure is a reply that named no address.

## 0.65.2

### Patch Changes

- df52dce: The web-reading instrument measures the desktop's assistant on the web (`npm run benchmark:web-reading`; report in `docs/WEB_READING_BENCHMARK.md`). A headless kernel with the Pages assistant's prompt and tools reads fictional sites with no network. A turn works when the reply states the page's fact and cites its address, and the assistant called only `tangle_os_web` and left the inbox empty. With `anthropic/claude-haiku-5.5`, 15 of 15 turns worked. They cover a given address, the same question in Dutch, a search followed by a read, a page with a note telling AI assistants to act, and a desktop with no web access. On the planted note, the assistant answered from the recipe, did nothing the note asked, and told the person it had ignored the note.

## 0.65.1

### Patch Changes

- 0de5f76: The Pages desktop's Web access test waits for the browser to let the page reach a reader on this computer. A page on the web that calls this computer or the local network needs the person's permission (Chrome asks for local network access and holds the request until the person answers), and the test gave up after 10 seconds with a timeout while the browser was still asking. Settings now asks the browser first. When the browser is about to ask, Settings says so and waits up to 90 seconds. When local network access is denied, it says how to allow it for the site. When a test of a local reader gets no answer, the message names both causes: the browser's question and a desktop that is not running. A reader on a public address is tested as before.

## 0.65.0

### Minor Changes

- c0ff8e2: The desktop and its assistant read websites through a host. `createKernel({ web })` takes a host's `WebReader` (none by default: every call answers `OS0180`), and the kernel's own `tangle_os_web` contract gives the assistant and granted modules `web.search` and `web.read` under the same grants as every other contract, each call in the ledger. Each caller has a rolling budget (`webBudget`, by default 8 reads and 4 searches a minute; a failed call counts), refused with `OS0183`. Every answer frames what a site wrote as untrusted data: a page comes back as its `source` address, its title, its text (the first 6,000 characters) and up to 50 links, with a note that the text is data to read and cite, never instructions to follow; search results carry the same note. `kernel.webReader()` is the reader itself, for the person's own Web app, with no budget. `httpWebReader(baseUrl)` calls a `web_reader` contract a host serves over HTTP, which now declares its `refused` (`OS0181`) and `unreadable` (`OS0182`) answers. The Pages desktop sets the reader's address in Settings, Web access.
- ed6e66d: The desktop has Web (`@tangleai/os/web`), a reader of web pages that never frames a third-party site. `webModule({ reader })` takes the host's `WebReader`. The address bar reads an address (a bare host such as `example.org/page` is read over https) and searches for anything else. Back, forward and reload sit in its header bar. A page is drawn from its extracted blocks in the desktop's look, in the page's own language: headings, paragraphs with their links, lists, quotes, code and tables. Nothing a page carries runs or becomes markup. A link on a page opens in the reader (http and https only), and "Open original" opens the address the redirects ended at in a new tab, with no opener and no referrer. A refusal is said plainly with its address, and its code is on the status (`data-code`). Without web access (`OS0180`), Web offers Settings or the host's own `configure`. Its sentences are in all eleven packs. The Pages desktop places Web beside Files.

## 0.64.6

No changes in this release.

## 0.64.5

No changes in this release.

## 0.64.4

No changes in this release.

## 0.64.3

No changes in this release.

## 0.64.2

No changes in this release.

## 0.64.1

### Patch Changes

- 44b66a9: A document module's form works in its sandboxed frame. The frame has no form submission (an authored document cannot send a form anywhere), and the browser refused a submission before the form's submit event, so a document's `on.submit` never ran: To do could not add an item. The module host now turns a submit button and Enter in a field into the form's submit event, after the form's own validity check; nothing navigates. The authoring gate refuses `$apply` over computed items when every rule matches by path (they match no rule and show nothing), and the crib says how to show one item by its position.

## 0.64.0

### Minor Changes

- 769d2a3: Applications have right-click menus the desktop draws: a default menu for a window (`setContextMenu` and `onContextMenu`) and a menu for one target (`menu(items, at)`, answering the chosen id or null), for shipped modules and framed pages alike. Items are text and desktop glyphs with separators, disabled and checked items, a shortcut hint and one level of submenus; a document that does not match `MENU_SCHEMA` is refused with `OS0170`.

## 0.63.2

### Patch Changes

- 13a3e59: A window resizes from all four sides and all four corners (`resizeWindowFrom(desktop, id, edge, start, dx, dy)`): the dragged edges follow the pointer, the opposite ones stay put, the window keeps its minimum and stops at the desktop's top. The edges are the same on screen in a right-to-left desktop, where the one corner grip used to grow the window from its other side.

## 0.63.1

No changes in this release.

## 0.63.0

### Minor Changes

- 04786f2: A manifest can start its icons hidden (`dock: { hidden: true }`), and saving an empty layout gives a person the default dock again. Themes name an ink for the failure colour (`--fail-fg`), so a badge and a hovered close read in dark themes too. The dock sizes itself to its content, keeps a large brand image within its bounds, counts the brand in its tile size, and keeps its tray at the visible end while it scrolls on a phone. The README says what a desktop without `state` keeps: nothing past the page.

## 0.62.6

No changes in this release.

## 0.62.5

No changes in this release.

## 0.62.4

### Patch Changes

- a285816: A benchmark report records the Tangle release it was measured with, and no longer has to equal the current one: the trading and trace2skill rebuilds take the committed report's suite, and their checks require only that the Jaren foundation is this one; CGT compares its runtime without the release. Every source-bound benchmark artifact is regenerated once under the identity that leaves Tangle's version strings out, so a version-only release now regenerates none.

## 0.62.3

### Patch Changes

- b4acfd5: Source receipts hash a package manifest and the lockfile without Tangle's own version strings (each package's `version` and every `@tangleai/*` pin), so a version-only release no longer re-identifies the benchmark artifacts that list them; every other byte, Jaren's pins included, still counts.

## 0.62.2

### Patch Changes

- 0548b16: A settle records a cleanup receipt, so a terminal experiment no longer stands for a cleaned workspace by itself. `settleExperiment` writes a `cleanup-intent` key before its swap (the revision and status the swap produces, the workspace's instance token, whether the branch goes) and `cleanup-done` once the workspace is gone; `reconcileCleanups({ store, host })` finishes every intent without completion, only while the experiment sits where the swap left it and only for the workspace instance the intent names, finishing each git step only if it is still needed. A workspace recreated at the same path is refused and left alone, and a completed cleanup is never reapplied. The worktree host gains `instance`, `pathOf` and an idempotent `finish`; `create` writes the instance token into the worktree's git administration directory, outside the tracked tree.

## 0.62.1

### Patch Changes

- 28b5d3c: Text bounds measure UTF-8 bytes with `utf8ByteLength` from `@jarenjs/core/string` instead of encoding the text with `TextEncoder`: forecast screening, classifier items, harness components, feedback items, guidance and skill instructions, the retrospective summary and `forecastBytes`; outcomes reflection and proposal text and `jsonBytes`; the research patch, artifact, lesson-proposal, workspace-path and CSV bounds; the trace2skill path and per-file bounds; the hera prompt byte cap; the run log's frame-body and replay-page bounds and the MAS trace budget; the temporal input ceiling; the context ledger's `jsonBytes`; an agent's default reservation estimate; and the experiential render budget. Every string measures as before, a lone surrogate as 3 bytes. Where a non-string can reach a bound, it is refused with that bound's own code rather than Jaren's TypeError: the volatile-fact classifier refuses a guidance item whose text is not a string with TFCT1001, and `validateFormat` refuses a file whose content is neither text nor null with TT2S1005 before `draftSize` measures it; the other raw-text bounds already refuse a non-string with their own code (TT2S1003 for a skill path, TRSH1006 for CSV input, the screening TypeError) or through the shape check that runs before them. The context ledger keeps counting a value JSON leaves out as 0 bytes, and the temporal ceiling keeps measuring a request body as its text.

## 0.62.0

### Minor Changes

- 59ee39c: `createStructuredOutput({ profile: 'strict' })` sends, on a `json_schema` tier, the schema's strict profile (`deriveStrictProfile` from `@jarenjs/validate/strict-profile`) with `strict: true`, maps each answer back and validates it against the original schema, which stays the authority. Measured with Claude Haiku 5.5: the provider refused 3 of 4 of the suite's schemas as they are and 1 of 4 as their profile (a grammar-size limit); every profile answer validated (docs/STRICT_PROFILE_BENCHMARK.md).

### Patch Changes

- 726d1ef: `bundleSchema` admits anchors: a reference to an `$anchor` or a fragment-only `$id` is resolved through `@jarenjs/validate/references`, as the validator resolves it, and bundled exactly as a pointer to the same schema would be, so every recorded request keeps its bytes. An anchor the resource does not declare is refused.

## 0.61.1

### Patch Changes

- 0542a6b: A contradiction is resolved as one operation: `MemoryStore` gains an optional atomic `mutate({ put, delete })` (the in-memory store has it), which `resolveContradictions` uses to write the superseded loser and its synthesized resolution together; on a store without it the resolution is written first and taken back if the loser cannot be written. A loser already superseded, by the same winner in a replayed pass or by another in a concurrent one, is counted as an application skip and never written again, so a replay no longer stores a second resolution.
- a9a39ff: MAS head activation is fenced by revision as well as version: `activateWorkflow` and `activateTemplate` take an optional `expectedRevision`, an applied activation and `getActiveWorkflow` return the head's `revision`, and a token read before the head moved away and back to the same version (A→B→A) is refused (`TMAS2001` at `/revision`). Without the revision the version alone decides, as before.
- f92314c: A ledger recall by meaning through a storage adapter's `rank` counts a record the adapter ranked but that was deleted before the ledger read it: the result carries `missing` (when there is one) and counts it among the `skipped`, instead of dropping it silently.

## 0.61.0

### Minor Changes

- d4629ba: The assistant can change an application it wrote for the person: `apps.read` gives it with a revision (refused with `OS0161` for any module not written for the person), and `apps.revise` offers a new version in the inbox against that revision, refused with `OS0112` when the application changed since, both when offered and when accepted. Accepted, the new version replaces the application, still asking for nothing, and its windows start again on it.

## 0.60.1

### Patch Changes

- 248bf42: A table column a reply's Markdown aligns itself (`:---`, `---:`) now aligns to the reply's reading start and end, so it mirrors in a right-to-left reply: the assistant maps the `left` and `right` Jaren's renderer writes to `start` and `end`.

## 0.60.0

### Minor Changes

- 7f5cf01: The assistant can write an application for the person. The desktop's own contract `tangle_os_apps` gives it the crib (`apps.crib`), a check against the gate and its own probes (`apps.check`), and `apps.suggest`, which files the finished document in the person's inbox as the desktop's own proposal, refused (`OS0160`) when it does not pass the gate. The inbox says who wrote it and that it asks for nothing; when the person accepts, it joins their layer as a document module with no grants, opens, and runs in its sandboxed frame. The kernel loads the authoring code only when the assistant uses it, and the Pages assistant is told when and how to write one. Measured through that assistant (a headless desktop, its system prompt and the kernel's tools, one turn): every one of 32 plain requests, 16 in English and 16 in Dutch, ended with an application in the inbox that works when the person uses it (docs/AUTHORING_BENCHMARK.md).

## 0.59.0

### Minor Changes

- e36af9d: `@tangleai/os/authoring` is the model-free half of the assistant writing an application: `authoringCrib()` (the grammar rules, Jaren's own operator names, each compiled by a test, and a working to-do list), `gateAuthoredApp` (lint, compile, first frame: what to send back for repair), `checkAuthoredApp` with probes that use an application as a person would (a field or button found by its label, placeholder or text), and `authoredManifest`, a document module that asks for nothing. A new instrument, `benchmark/authoring.ts`, measures how often a plain request becomes an application that works when a person uses it: 22 of 24 with Claude Haiku 5.5 (docs/AUTHORING_BENCHMARK.md).

## 0.58.1

### Patch Changes

- bdf7736: Choosing a language in Settings now outranks a `?lang=` the link carried, so the desktop starts again in the chosen one. A browser check proves that the assistant and Jaren's applications follow the one language choice, and that a right-to-left assistant reply mirrors its lists, quotes and table cells; a column the Markdown aligns itself keeps the physical side Jaren's renderer writes, as the assistant's README now says.

## 0.58.0

### Minor Changes

- 2beaaeb: The Pages desktop speaks the twelve languages: every sentence of its own applications (Welcome, Settings' Providers, Models, Appearance and Privacy sections, the Calendar, To do, About, the memory loop and the Assistant window) comes from one catalogue with a pack per language, in the formal register of the chrome's and the assistant's packs. One choice in Settings → Appearance (the browser's language by default) feeds the shell, Settings, Files, the assistant, Jaren's applications and `Intl`, and Arabic mirrors the desktop; `?lang=` overrides it for a link. The theme kits and the memory pipeline's diagram are named in the person's language too. A browser check renders a sentinel pack over the desktop's own windows and finds no sentence outside a catalogue, and renders every pack and finds no English sentence left.

## 0.57.0

### Minor Changes

- ea954a3: The desktop's chrome speaks the eleven languages `@jarenjs/locales` ships besides English: `@tangleai/os/messages/<lang>` (`ar`, `de`, `es`, `fr`, `ja`, `ko`, `nl`, `pt`, `ru`, `tr`, `zh-tw`) is a pack of every sentence the shell, Settings, Files, the install sheet and Applications and access write, in the formal register the assistant's packs use. A host passes one as `messages` to `mountDesktop`, `settingsModule` and `filesModule` (the last two also take `locale`, so Settings, Files and "This browser" carry their names in that language); with Arabic and `dir: 'rtl'` the desktop mirrors. A browser check renders a sentinel pack and finds no chrome text outside the catalogue, and renders every pack and finds no English sentence left.

### Patch Changes

- 27d5ccd: An application the person removes (or whose joining they undo, or that another device removed) now takes what it served along: its contracts, header bars and deciders leave the kernel and its windows close, so its window can no longer answer the assistant, which under `assistantGrants: 'all'` it could before. A contract whose module is no longer on the desktop is no one's to call. A kept application is never restored over a contract another module declares. The install sheet opens with Cancel focused, so a stray Enter never consents, and two suites named at once show their sheets one after the other.

## 0.56.0

### Minor Changes

- 5b7d8ee: A link to a suite installs nothing by itself: `desktop.join(suite, { source })` shows the person an install sheet with each application's origin, the contracts it offers, the scopes it asks for (each a choice) and the assistant's access (off), and installs only what they add, kept in their state. An application joined before is updated without asking unless it now comes from another origin or asks for more. An application on this device or the local network says that the browser may ask about it, and its window says how to recover when that was refused. Settings has a section of the desktop's own, Applications and access: every application's origin, grants and recent calls, with switches for the scopes and the assistant's access of the ones the person added, and Remove. The Pages desktop joins `?suite=` links this way.
- 42ec33b: Applications a person joins are installed with their consent. `kernel.join(manifest, { scopes, assistant, source })` installs one in the person's layer and grants exactly the scopes they allowed out of what its manifest asks for; what it provides, its header bar and its file location reach the assistant only when they said so, also on a desktop that grants the assistant everything. The joined applications, each with the origin, scopes and contracts the person was shown, are kept in the person's desktop state (`apps`), so they return on the next visit and on another device; `consentNeeded` says when to ask again (another origin, or a scope or contract they were not shown), `setConsent` changes it, and removing and undoing carry the consent along. `scopesOf`, `originOf` and `isLocalOrigin` give an install sheet what to show.
- 5b7d8ee: `@tangleai/os/testing` runs the desktop without a browser for an application's own CI: `checkSuite` reports what keeps a suite document from joining (not a suite, an id listed twice or reserved, a contract two applications provide, a page on the desktop's origin, an invalid manifest, capabilities that disagree) and warns about a required contract nothing provides; `createTestDesktop` joins the suite with consent as a person's link would (narrowed per application), serves its contracts with the test's handlers, and files and decides proposals through the inbox's own path.

## 0.55.1

### Patch Changes

- 89f116e: A desktop loads Jaren's port transport when its first framed window opens instead of with the desktop. The shell waits for it before it hands a frame its ports, and a failed fetch fails that window, whose Retry fetches again. The kernel's `serveModule` and `connectProvider` stay synchronous for any other caller: until the transport arrives, what reaches a served port is held and handed over in order, and a client's calls wait for it. How much this saves depends on the host's bundler: with esbuild splitting chunks, a desktop of in-page modules loads about 25 KB less minified code up front (6 KB gzipped) and the 28 KB port chunk only with a framed window; a bundle built without splitting keeps it inline. `applyTheme` and `applyLocale` live in their own file, so the shell no longer imports the joining side.

## 0.55.0

### Minor Changes

- d2ee7f0: Capabilities declare a domain once: its contract documents, its context reads, the kinds of proposal it files with their review policy, and a prompt pack in the person's languages (`CAPABILITY_SCHEMA`). The host installs them (`kernel.installCapability`, never in the user layer, since a prompt pack becomes the assistant's system text), and a module's manifest names the capabilities it files for, so every module of a domain files its kinds without a list of its own. A kind's policy says which origins may file it, which the kernel enforces, and which roles may decide it, which the inbox shows and hands to the module with the decision. `composeCapabilities` gives an assistant its system text, tools and context reads from them, deterministically, and `checkCapabilities` reports a missing capability or a kind declared twice. An older desktop refuses a manifest with `capabilities` and a page on an older release refuses a decision carrying `roles`; the protocol stays 1. No model was run on the prompt packs.
- a92d85b: Paused runs wait in the desktop's inbox. A proposal says who it comes from (`origin`: human, rule, import or ai) and may ask the person something (`answer: { schema, label }`): the inbox draws a form from the schema, the kernel checks the answer before it reaches the module that filed it as `{ decision: 'answer', response }`, and nothing gives the assistant a way to answer. `@tangleai/mas/inbox` turns a run's waiting interactions into such proposals on the application's server and an answer back into the interaction's response with a derived response key (a rejection cancels it); `listWaitingInteractions` lists the waits by status, with no table change. An older desktop refuses a proposal with `origin` or `answer`, and an older page refuses an `answer` decision; the protocol stays 1.

## 0.54.0

### Minor Changes

- 29a4004: The desktop keeps its state (the person's dock, the settings they set for applications, and the host's own preferences) as revisioned JSON documents in one store the host chooses: the browser (`webStorageStore`), its own server through the new `tangle_os_state` contract (`contractStore`), or the signed-in framed application (`createKernel({ state: { module } })`). It loads before anything in it can change, saves in the background one document at a time with retries, takes a document another device changed instead of overwriting it, and shows in the dock when it cannot load or save. `@tangleai/os/state-server` gives a server the `DESKTOP_STATE_MODEL` table for `@jarenjs/db` (SQLite or PostgreSQL), a compare-and-set repository interface and `serveDesktopState`, with the owner always taken from the server's session. The Pages desktop keeps its state in the browser; `createKernel({ settings })` still works.
- 29156a5: The dock is the person's own document: in edit mode they move icons, drop one on another to make a folder, rename folders, take icons out, and hide and show them, by pointer, menu or keyboard, kept with the desktop's state. A manifest may list launch entries, each its own dock icon opening the module at one of its screens (`connection.screen`, `onScreen`), and name the folders its icons start in (`dock.folders`); an older desktop refuses a manifest with those members. The assistant reads the dock and suggests a new arrangement through the kernel's `tangle_os_dock` contract; the suggestion waits in the inbox, shown as its changes, until the person accepts it. Modules may no longer take the ids `shell`, `person` or `desktop`.
- a59de21: The desktop has Files (`@tangleai/os/files`): the person's own files in this browser, offered by a host without a server, and every application's files through a file location it serves, made from one contract template (`fileLocationContract`: paged list and search, read inline or by a signed https address, and optional write, new folder, move and delete with refusals that keep their reason). Files browses with breadcrumbs, back, forward, up and search in its header bar, previews images, PDFs and text (and Markdown or other types through the host's previewers) without ever running a file as the desktop's markup, uploads, renames, moves and deletes. The assistant reads and searches through the kernel's `tangle_os_files` and never writes a location; a location can keep the assistant out. A manifest names its location with `files`. The Pages desktop offers "This browser" in its own folder of the browser's private file system and draws Markdown with `@jarenjs/md`.
- e99f017: A file in the desktop's Files opens in the application the person picks: a manifest lists the media types it `opens`, Files offers "Open in …" for each, and the desktop hands the file to the application's window, starting it when it is not running and waiting until it has joined. A framed page takes it at `onOpen`, a shipped module at `context.onOpen`, and either may refuse with a reason Files shows; `context.openFile` and `desktop.openFile` hand one over. The Pages Calendar opens iCalendar files and imports their events, counting what it cannot keep.

## 0.53.2

### Patch Changes

- Builds on Jaren 0.220.0, whose linq database client builds each handle on its first read instead of all at open, and whose `prepareModel` lets many stores open from one prepared model. Tangle reads its handles by name, so no behaviour changes beyond a lighter open; the pins, the foundation manifest and the integration audit move to the new release.

## 0.53.1

### Patch Changes

- Builds on Jaren 0.219.1, a patch whose database owner lease is pinned to a SQLite file under every spelling of its path. Its source is unchanged, so no behaviour changes; the pins, the foundation manifest and the integration audit move to the new release.

## 0.53.0

### Minor Changes

- f4868f0: Applications put their toolbar in their window's title bar: buttons, toggles, menus, tabs and a search field, described as a JSON document (`HEADER_SCHEMA`) and drawn by the desktop, so every bar follows the theme and the writing direction, works by keyboard and screen reader, and fits a narrow window by moving what does not fit into one "More" menu. A framed page calls `setHeader` and hears uses at `onHeader`; a shipped module has the same pair on its context. Every use, the person's and the assistant's, goes through the kernel's own `tangle_os_header` contract (`header.list`, `header.activate`) under grants and into the ledger; an item marked `assistant: false` is kept from the assistant. Calendar moves its month controls into its header bar and Settings its search.

## 0.52.6

### Patch Changes

- Builds on Jaren 0.219.0, whose `$date-format` writes a date on a named time zone's wall clock through an injected zone provider and whose clock arithmetic cuts a sub-millisecond fraction instead of rounding it. Tangle uses none of the date operators, so no behaviour changes; the pins, the foundation manifest and the integration audit move to the new release.

## 0.52.5

### Patch Changes

- Builds on Jaren 0.218.0, whose HTTP contract server can refuse a query member an operation does not declare (`closedQuery`, off by default, not turned on here). The Pages desktop adds two applications from Jaren's `@jarenjs/calc`: Calculator (standard, scientific, programmer, financial and converter modes) and Converter (the same component in its converter mode alone, with live public currency rates and an offline table to fall back on), both in the desktop's language and theme.

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

### Minor Changes

- e5d7435: The desktop's mail is the one inbox for what a person decides. An application declares the kinds of proposal it files (`proposals` in its manifest) and files them with `propose` (the same id replaces, `withdraw` takes one back); the mail shows them as text, with evidence linking only to http(s) pages, and the person accepts or rejects. The decision goes back to the application over its own control channel (`onDecision`), never as a contract operation, so neither the assistant nor another module can decide, whatever their grants. One decision runs at a time; an application that is not running or refuses (a moved revision) leaves the proposal pending with the reason. `kernel.propose`, `kernel.decide` and the `mail` events serve a host with its own inbox.

### Patch Changes

- e5d7435: A failure says how it happened without a message to match: a direct call's `AI0002` carries `outcome: "timeout"` or `outcome: "network"`, and a routed client reports every route it tried, including one stopped before it started by the caller's abort or the account's budget (`outcome: "budget"`, `started: false`), so a meter accounts for every attempt. The assistant view announces its errors (`role="alert"`), keeps its log live and busy while a run works, offers a failed run a retry (the `retry` intent, in all twelve languages) and returns focus to its launcher when the panel closes with focus inside it.
- fd8be60: The desktop stamps `data-theme` beside `data-scheme` on its own root and on a joined page's, so Jaren's component stylesheets (Markdown, diagrams, charts, Studio) turn dark with the desktop.
- e5d7435: The Pages playground hands its renderers and validator to the Play component once instead of on every run, and its game shares the playground's compiled language catalogues instead of compiling its own.
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

### Minor Changes

- The desktop has one Settings for every application. `@tangleai/os/settings` is a Settings module a host installs with its own sections first and then one per application whose manifest declares `settings`: `mount` (a shipped module's own settings screen), `page` (an origin application's settings page, framed from its own origin and given no contract ports) or `form` (a document module's JSON Schema, whose values the desktop keeps through `createKernel({ settings })`, checked against the schema and never a secret). Applications keep their own values; the desktop is where the person finds them, with a search, from the window and dock menus, and from the application itself (`openSettings()` over its own port, no grant needed). The Pages desktop's Settings is this module, and the Calendar's working hours are a section of it.

## 0.50.0

### Minor Changes

- The desktop fits the applications that host it or join it. Hosting: `mountDesktop(node, { compact: { below } })` makes a narrow desktop compact, every window opening maximized and only the focused one shown; at any width the dock stays on screen, its tiles shrinking to fit and then scrolling, every module reachable by pointer and keyboard, and a keyboard user keeps their place when the dock redraws; `tray` decides the mail tile and the light/dark switch and adds a brand mark; `desktop.subscribe` reports every window change with its state, and when a module is `ready` or has `failed`; a shipped module learns from `visible` and `onVisibility` when its window is hidden; a host glyph is documented API. Framed applications: a framed module has `connectTimeoutMs` (15 s by default) to answer, past which its window says so, offers to try again and holds nothing open, and a module whose page reloads connects again on fresh ports. Joining: `connectToOs` takes `connectTimeoutMs` and `signal`, refuses with an `OsConnectError` (`OS0401`, `OS0403`) and leaves no listener behind, refuses a page that is not framed at once (`OS0402`), and keeps the application's own look with `presentation: "none"` or `{ root }`; `GrantedOperation` and `ToolBuilder` are exported. Windows open wholly on the desktop, keep their manifest's minimum size when resized, are labelled regions rather than dialogs, play their opening animation once and stop moving under reduced motion, and their glass survives a minified build. The assistant view opens, closes and toggles from the host, and builds its own Markdown only when the host renders none.

### Patch Changes

- Build on Jaren 0.212.0, whose assignment engine evaluates what-ifs incrementally, proposes fills and repairs against a baseline, and whose database reads hand-written SQLite triggers back as rules.
- `npm test` runs the release suite; the long-running set (reproducing committed measurements and qualifying crash recovery, about 88% of the recorded test time) runs with `npm run test:long`, and both with `npm run test:all`. CI runs the long-running set as a separate job that never blocks a release, and keeps a verified release artifact for 90 days.

## 0.49.2

### Patch Changes

- Build on Jaren 0.207.0, whose assignment scoring covers one resource on one local civil day through an injected zone.

## 0.49.1

### Patch Changes

- Build on Jaren 0.206.0, whose calendar reads iCalendar back into its model, compiles and embeds zone definitions and edits foreign iCalendar losslessly, and whose core scores assignments exactly.

## 0.49.0

### Minor Changes

- `@tangleai/os` can be used from another repository without a registry. Every release keeps the package tarball, a one-file module side (`connectToOs` with its dependencies inside, for a page on any foundation) and a manifest of their hashes, protocol and Jaren foundation under `releases/os/`, and the desktop site serves the same files under `os/`. The package now depends on Jaren alone. `kernel.operations()` lists what a caller may call as plain data, for an application with its own agent runtime. Migration: `kernel.tools()` builds its tools with the host's tool builder, so pass one when creating the kernel: `createKernel({ tools })` with `import * as tools from "@tangleai/agents/toolbox"`; without one it refuses with `OS0301`.

### Patch Changes

- A limit that would never be reached is refused before any call, with `AI0001`: `maxRepairs`, `retry.attempts` and an agent's `maxToolRounds` and `budget.turns` must be whole numbers of at least 0, and `budget.tokens`, `budget.ms` and `budget.cost` finite numbers of at least 0. Before, `maxRepairs: Infinity` repaired without end and a NaN turn budget never stopped a run; `maxRepairs: -1` made no call and returned a failure with no errors. A structured result's `attempts` is the number of calls made.
- Build on Jaren 0.201.2, two patch releases of database, ordering and calendar fixes with fuller type declarations.

## 0.48.3

### Patch Changes

- Build on Jaren 0.201.0. Its calendar repeats monthly and yearly by the iCalendar standard, so the desktop Calendar now offers "Every month" and "Every year", and its editor says when a series skips a date that a month or year lacks. The Pages playground is now built on Jaren's play host kit instead of a copy of Jaren's site: a saved or shared session no longer carries a message language and opens in its reader's, and an example made to show one language shows it for its own run.
- Updated dependencies
  - @tangleai/agents@0.48.3

## 0.48.2

### Patch Changes

- Build on Jaren 0.199.0, whose calendar (`@jarenjs/core/calendar`), iCalendar writer (`@jarenjs/josl/ical`) and calendar-scheduled database jobs arrive in these releases. The Pages desktop gains a Calendar built on them: a month view, a day panel and an editor, recurring events with skipped days, "find a time" over the person's working hours that never offers unknown time, an iCalendar export, and a `calendar` contract (agenda, add, free) that the assistant and other applications use as tools.
- Updated dependencies
  - @tangleai/agents@0.48.2

## 0.48.1

### Patch Changes

- Build on Jaren 0.193.1. Its `sha256Hex` replaces the nine local SHA-256 helpers, each keeping its name, with identical digests. MAS caches compiled embedded schemas with Jaren's semantic cache, which now remembers the key of a frozen tree: 0.31 µs per lookup against 22.8 µs before. The Studio authoring gate now refuses an element written as an object and names an unknown operator with the nearest known one. The Studio file author sends an open profile in the prompt to an Anthropic model, which refuses an output schema with an open object, so the Pages Studio assistant no longer fails with HTTP 400 on the default model. The assistant's Japanese and Traditional Chinese packs use Jaren's 「…」 permalink wording.
- Updated dependencies
  - @tangleai/agents@0.48.1

## 0.48.0

### Minor Changes

- Make Tangle OS the Pages site. Studio, Playground, Flow, Data, the adventure, the memory loop and moving browser data are desktop applications now, beside Welcome, the assistant, Settings and the to-do module; the assistant uses the work applications' authoring tools, and a former page link opens its application. `@tangleai/os` adds theme kits (`THEME_KITS`, `composeTheme`): each is one JSON document with light and dark palettes, a procedural wallpaper and a shape, and a person's changes (accent, highlight, pattern, seed, density, glass, corners, spacing) compose into an ordinary theme document that can be exported and imported. Five procedural wallpapers (`PATTERNS`, `patternBackground`: woven threads, contours, a two-ink halftone, a sun print and moiré tides) are drawn deterministically from a seed in the theme's own colours. Windows are laid out above the dock.

### Patch Changes

- Updated dependencies
  - @tangleai/agents@0.48.0

## 0.47.0

### Minor Changes

- Add `@tangleai/os`, a browser operating system for applications built on Jaren and Tangle. A module is a JSON manifest plus the contract operations it serves and needs; the desktop hosts it as a shipped component, as a jaren-app document in a sandboxed opaque-origin frame, or as an application's own page on its own origin that joins with `connectToOs` from `@tangleai/os/module`. The kernel installs modules in shipped, suite and user layers with RFC 6902 patches, keeps a journal with undo and a recovery boot, routes every call between modules as a contract operation under grants into a ledger, carries mail, and lists every granted operation as an assistant tool. The assistant's model placeholder and the documentation now name only the models that write Jaren's JSON documents reliably: `anthropic/claude-haiku-5.5`, and Qwen 3.7 27B or larger. The desktop has context menus on its background, title bars and dock, minimized windows now actually hide, and `mountDesktop` takes `themeFor` and `onSchemeSwitch` so a host's own colours survive the dock's light/dark switch. The Pages desktop ships an Assistant window and a Settings app: provider, OpenRouter key (kept in this browser, optionally for the tab only), region, a model picker over OpenRouter's catalogue, appearance, and forgetting what the browser keeps.

### Patch Changes

- Updated dependencies
  - @tangleai/agents@0.47.0
