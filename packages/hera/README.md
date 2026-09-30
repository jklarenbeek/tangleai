# @tangleai/hera

Contracts, compiled role prompts and durable learning state for evaluated
orchestration. The package exports eight role definitions and five control
artifacts compiled through GMPL. Importing its root performs no filesystem,
database or network work. Hosts supply storage, scope and write authority.

The current measurement is the [keyless orchestration instrument](../../docs/HERA_BENCHMARK.md).
Its analytic oracle and reference establish the fixture; its seven mechanism
rows remain explicitly unimplemented. These contracts do not measure model
quality or a learning improvement.

## Artifacts and identities

`heraArtifacts` is an immutable GMPL catalog. Use `createGmplCatalog` and
`renderGmplPrompt` from `@tangleai/gmpl` to validate and render it.
`createHeraAgents(catalog, {scope, profile, at})` creates the eight definitions
and their candidate prompt versions. `heraRegistryDocument` constructs the MAS
capability document; `heraConfigCatalog` names the host profile and limits.
Only the Retriever's immutable allowlist includes `hera-evidence`.

Prompt versions separate the unchanged role envelope from operational rules and
behavioral principles. `compileEffectivePrompt` combines those blocks after
checking the envelope revision. Role result schemas compose GMPL's existing
claim and finding contracts; there is one citation vocabulary.

Content hashes exclude lifecycle status and observation time. Those metadata
fields change only through fenced activation; a different immutable payload
cannot reuse an address. Snapshots retain exact experience-version ids beside
their library revision, so a later library cannot replace a frozen membership.

## Storage and authority

`createMemoryHeraStore({scope})` and `createHeraStore(db, {scope})` from
`@tangleai/store` implement the same contract. Database rows use scoped physical
keys, allowing the same role name in different scopes. The generated schema is
the write gate for both adapters.

Read with `getAgent`, `getPromptVersion`, the other named getters, `readHead`,
`listExperiences`, `listPromptVersions`, `listTrajectories` and `listSnapshots`.
Queries default to 1,000 records and accept an explicit limit up to 10,000.

Writes take `{scope, mode}` authority. Learning records can be written only in
`learn`; `evaluate` and `infer` may persist operational trajectories but refuse
learning writes with `THERA1004`. `assertTaskSplit(task, mode)` also refuses a
held-out or unlabelled task offered to learning. The task adapter owns its split;
a model cannot grant itself write authority.

Named `putAgent`, `putPromptVersion` and the other puts are immutable: identical
bytes are a no-op and conflicting bytes return `THERA1002`. Stage prompt and
snapshot candidates before activation. `planPromptActivation`,
`planSnapshotActivation` and `planLibraryActivation` produce plans for
`transitionHead`. Every transition delegates to the existing outcome head fence,
comparing both version and revision. An A → B → A sequence cannot revive an old
token. Lost fences return `THERA1006`.

`transaction(authority, async view => ...)` groups domain writes and transitions.
A refusal or exception rolls back the entire transaction, even when the callback
catches a content refusal. Unexpected host errors propagate. `counters()` reports
committed learning writes and refused write attempts for measurement.

## Building and checking

`npm run emit:hera` composes the HERA definitions with GMPL's evidence schema and
emits the public contract and TypeScript declarations. `npm run hera:artifacts`
compiles thirteen TOML packs; both commands accept `--check`. Runtime consumers
read the resulting JSON. The single-trajectory reflection file is debugging
prose outside the catalog and has no learning authority.

`npm run test:hera` covers the schema, artifacts, registry, activation, modes and
instrument. The same lifecycle runs in memory, SQLite memory and a reopened
SQLite file; injected failures prove activation rollback.
