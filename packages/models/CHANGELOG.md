# @tangleai/models

## 0.42.0

### Minor Changes

- 4567009: Size tool calls to the model that makes them. `@tangleai/models/profile` reads a
  model id into a profile with a tool budget (`modelProfile`, `resolveToolBudget`,
  `TOOL_BUDGETS`): a mixture of experts is tiered by its active parameters, a dense
  model by its size, with overridable heuristic defaults. `@tangleai/agents/staging`
  (`stageTools`, `estimateArgumentChars`) builds any tool whose typical input exceeds
  the budget as a draft in budget-sized, sub-schema-checked calls and commits it
  through the tool's own validation, offers small catalogs to small budgets, and
  refuses duplicate tool names. A tool call cut off at the reply's length limit now
  says where it was cut and points at the drafts. `@tangleai/jaren/contract-tools`
  (`createContractToolbox`) turns a Jaren contract into such tools, with host-pinned
  input members and outcomes shaped for a model; `@tangleai/jaren` now depends on
  `@jarenjs/contract` 0.91.4. Existing exports are unchanged.

### Patch Changes

- fb8a15e: Host Radiant OS on the Pages site at `os/`: an installable, offline browser OS
  that is a two-dimensional Turing machine governed by a council of its own parts
  under the human's veto. Its studio is a turn-based crew game for finishing small
  apps together (up to four people add ideas, the crew builds each one as a block
  through the OS contract, and the people approve or veto it), with a board of
  linked notes and todos, mail that keeps every conversation, a library of the
  suite's documentation to read, hear and ask, and three games: Monkey Grove,
  Tape Dancers and Bench Arena. A configured model plays the oracle, the crew and
  the library's voice. The crew builds with `createContractToolbox` under the
  model's tool budget, and the library answers only from the passages it is given,
  citing them. Without a model, a scripted oracle and crew run the same paths.

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
