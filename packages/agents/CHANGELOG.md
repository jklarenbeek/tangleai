# @tangleai/agents

## 0.45.2

### Patch Changes

- @tangleai/context@0.45.2
  - @tangleai/models@0.45.2

## 0.45.1

### Patch Changes

- @tangleai/context@0.45.1
  - @tangleai/models@0.45.1

## 0.45.0

### Minor Changes

- Let the host decide the agent loop's language, tools, context and spend. `createAgent({ messages })` replaces every sentence the loop writes into a request or a result (`AgentMessages`; the English `AGENT_MESSAGES` are byte for byte the earlier text), and passes `messages.goal`, `messages.recall`, `messages.environment` and `messages.toolbox` to the goal prompt, the `recall` and environment tools and its own toolboxes; `createLedger({ messages: { goal } })`, `goalPrompt(goal, messages)`, `createRecallTool(ledger, { messages })`, `environmentTools(environment, messages)` and `createToolbox({ messages })` take the same words. `recall` is now listed only when the agent can compact (a ledger and a `historyBudget`), or with `recall: true`; `recall: false` never lists it. Tools run as `execute(input, { signal, context })` with the send's abort signal and the host's `toolContext`, so a stopped run stops its tools (Jaren's contract tools read the same signal). A model call that rejects counts as a turn and carries `error.partial = { messages, steps, spent }`. `budget.cost` bounds a run priced by `prices(model)`, `spend()` reports `cost`, and `budget.reserve` with `maxOutputTokens` refuses any call whose worst case could cross the token or cost budget, booking the worst case when a provider reports no usage; `probePrices` in `@tangleai/models/providers` reads per-token prices from a provider's model listing. `toolbox.add` throws `AI0001` for a name it already holds unless `{ replace: true }`, and `toolboxFromContract(contract, client, { bind, mapOutcome, … })` registers a contract's operations with host-bound input members removed from the model's schema and injected on execution.

### Patch Changes

- Report structured-output failures in one shape and stop repairing truncated replies. `createStructuredOutput().generate` answers `{ ok: true, value }` or `{ ok: false, errors }`, both with `raw`, `attempts`, `finishReason`, summed `usage` and per-attempt `calls`; every error record carries `stage` (`parse`, `schema`, `gate` or `truncated`), an always-present `code` and `path`, and `message`, beside the `instancePath`, `keyword` and `docPath` the repair prompt still carries byte for byte. A reply that stops at the token limit, or carries reasoning and no content, is reported as `truncated` instead of being sent for a repair; `onAttempt` reports a reply that is not JSON as `parse` (it said `schema`) and adds each attempt's finish reason and usage. A passing gate may return `data`, surfaced as `gateData`; `deadlineMs` bounds a whole generation as `AI0004`; `parse: 'lenient'` reads JSON wrapped in prose; `bundle: true` sends `bundleSchema(schema, refs)`, a self-contained schema, while validation stays local; `tier` overrides the structured-output tier. The chat client states its model's tier (`structured`, reported as `endpoint.structured`, so Anthropic models on OpenRouter can take the prompt-carried `null` they need, since they refuse `oneOf`), bounds each attempt with `timeoutMs` (a retryable `AI0002` with status 0), and asks a stream for its usage with `requestUsage` (`stream_options`, never in the replay key). `createRoutedClient` accepts a host's own purpose and types its `onRoute` events and `account`. New entries: `@tangleai/models/testing` exports `createScriptedFetch`, a scripted `fetch` for keyless tests (replies, truncation, HTTP and network failures, a hang that honours abort), and `@tangleai/models/replay-file` exports `createFileReplayCache`, a replay directory over an injected file system with `record`, `fresh` and a fail-closed `replay` mode. `ChatResult`, `ChatClient`, `StructuredError` and `StructuredResult` are exported types. The program runtime's `account` option takes typed `reserve` and `settle` functions.
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangleai/context@0.45.0
  - @tangleai/models@0.45.0

## 0.44.0

### Patch Changes

- @tangleai/context@0.44.0
  - @tangleai/models@0.44.0

## 0.43.1

### Patch Changes

- @tangleai/context@0.43.1
  - @tangleai/models@0.43.1

## 0.43.0

### Patch Changes

- @tangleai/context@0.43.0
  - @tangleai/models@0.43.0

## 0.42.1

### Patch Changes

- @tangleai/context@0.42.1
  - @tangleai/models@0.42.1

## 0.42.0

### Minor Changes

- Move every package onto the Jaren 0.161.0 foundation, consumed as candidate tarballs rebuilt byte for byte from the pinned source because npm does not serve that release. Absorb its typed check outcomes, stage-discriminated guarded commits, strict retry options and typed migration plans; remove the two declaration bridges its corrected LINQ declarations make unnecessary; re-derive the paid memory policy report's interval statistics under its corrected nearest-rank quantile, which changes the default policy's provenance report id but no selection, decision or default value; and raise the program pen bundle ceiling to 29,000 bytes for the larger captured-expression module.

### Patch Changes

- Updated dependencies
  - @tangleai/models@0.42.0
  - @tangleai/context@0.42.0

## 0.41.0

### Patch Changes

- @tangleai/context@0.41.0
  - @tangleai/models@0.41.0

## 0.40.0

### Patch Changes

- @tangleai/context@0.40.0
  - @tangleai/models@0.40.0

## 0.39.0

### Patch Changes

- @tangleai/context@0.39.0
  - @tangleai/models@0.39.0

## 0.38.0

### Patch Changes

- @tangleai/context@0.38.0
  - @tangleai/models@0.38.0

## 0.37.0

### Patch Changes

- @tangleai/context@0.37.0
  - @tangleai/models@0.37.0

## 0.36.0

### Patch Changes

- @tangleai/context@0.36.0
  - @tangleai/models@0.36.0

## 0.35.0

### Patch Changes

- @tangleai/context@0.35.0
  - @tangleai/models@0.35.0

## 0.34.0

### Patch Changes

- @tangleai/context@0.34.0
  - @tangleai/models@0.34.0

## 0.33.0

### Patch Changes

- Updated dependencies [236b915]
  - @tangleai/models@0.33.0
  - @tangleai/context@0.33.0

## 0.32.0

### Patch Changes

- @tangleai/context@0.32.0
  - @tangleai/models@0.32.0

## 0.31.0

### Patch Changes

- @tangleai/context@0.31.0
  - @tangleai/models@0.31.0

## 0.30.1

### Patch Changes

- @tangleai/context@0.30.1
  - @tangleai/models@0.30.1

## 0.30.0

### Patch Changes

- @tangleai/context@0.30.0
  - @tangleai/models@0.30.0

## 0.29.8

### Patch Changes

- @tangleai/context@0.29.8
  - @tangleai/models@0.29.8

## 0.29.7

### Patch Changes

- @tangleai/context@0.29.7
  - @tangleai/models@0.29.7

## 0.29.6

### Patch Changes

- @tangleai/context@0.29.6
  - @tangleai/models@0.29.6

## 0.29.5

### Patch Changes

- @tangleai/context@0.29.5
  - @tangleai/models@0.29.5

## 0.29.4

### Patch Changes

- @tangleai/context@0.29.4
  - @tangleai/models@0.29.4

## 0.29.3

### Patch Changes

- @tangleai/context@0.29.3
  - @tangleai/models@0.29.3

## 0.29.2

### Patch Changes

- @tangleai/context@0.29.2
  - @tangleai/models@0.29.2

## 0.29.1

### Patch Changes

- @tangleai/context@0.29.1
  - @tangleai/models@0.29.1

## 0.29.0

### Patch Changes

- @tangleai/context@0.29.0
  - @tangleai/models@0.29.0

## 0.28.0

### Patch Changes

- @tangleai/context@0.28.0
  - @tangleai/models@0.28.0

## 0.27.3

### Patch Changes

- @tangleai/context@0.27.3
  - @tangleai/models@0.27.3

## 0.27.2

### Patch Changes

- @tangleai/context@0.27.2
  - @tangleai/models@0.27.2

## 0.27.1

### Patch Changes

- @tangleai/context@0.27.1
  - @tangleai/models@0.27.1

## 0.27.0

### Patch Changes

- Updated dependencies [6dcfde9]
  - @tangleai/context@0.27.0
  - @tangleai/models@0.27.0

## 0.26.3

### Patch Changes

- @tangleai/context@0.26.3
  - @tangleai/models@0.26.3

## 0.26.2

### Patch Changes

- @tangleai/context@0.26.2
  - @tangleai/models@0.26.2

## 0.26.1

### Patch Changes

- @tangleai/context@0.26.1
  - @tangleai/models@0.26.1

## 0.26.0

### Patch Changes

- @tangleai/context@0.26.0
  - @tangleai/models@0.26.0

## 0.25.1

### Patch Changes

- Consume the exact Jaren 0.87.0 registry packages and source pin. Qualify native SQLite schema changes, column references, JSON type inspection and per-call mutation semantics alongside Tangle records across Node, Bun and installed consumers. Preserve the existing document storage model and historical paid measurements.
- Updated dependencies
  - @tangleai/models@0.25.1
  - @tangleai/context@0.25.1

## 0.25.0

### Patch Changes

- @tangleai/context@0.25.0
  - @tangleai/models@0.25.0

## 0.24.1

### Patch Changes

- @tangleai/context@0.24.1
  - @tangleai/models@0.24.1

## 0.24.0

### Patch Changes

- @tangleai/context@0.24.0
  - @tangleai/models@0.24.0

## 0.23.0

### Patch Changes

- @tangleai/context@0.23.0
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
  - @tangleai/context@0.22.0

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

## 0.21.0

### Minor Changes

- Add independent model transport, evidence-backed context, and bounded agent/program packages. Preserve the JavaScript/JSDoc APIs, strict result contracts and injected host services, with JavaScript distributions and checked declarations. Toolbox browser registration delegates to Jaren's shared WebMCP contract.

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @tangleai/models@0.21.0
  - @tangleai/context@0.21.0

The source transfer is locally qualified before its first coordinated release.
