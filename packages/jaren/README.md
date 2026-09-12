# @tangleai/jaren

Jaren-specific AI authoring and tooling over public Jaren engines and editors.
Models, context and agent policy remain in their respective Tangle packages.

- `/studio`: `createStudioFileAuthor` returns one compiler-checked file candidate.
  `createStudioAdapter` validates the assembled project and preserves file routes,
  imports and order. `propose` captures the whole project revision; `accept` uses
  the shared editor's queued revision check. Conflicts return the candidate.
- `/flow`: `createFlowAdapter` proposes FSM/DAG documents through the shared
  compiler checks and offers template, write, patch, check and explicit run.
- `/data`: `createDataAdapter` proposes one model or query, validates through the
  shared editor and inspects the actual contract result and plan. Publication
  only updates buffers. `run({ operation: 'query' })` executes explicitly;
  `run({ operation: 'open' })` explicitly asks the owning host to open the model.
  The shared model pen and authoring schema accept physical column types,
  database defaults, identity, collation, constraints and STRICT declarations.
  Accepting those declarations never implicitly applies a table migration.
- `/stylesheet`, `/spatial`, `/geo-tools`: compiler-gated stylesheet authoring,
  spatial agents and tools backed by Jaren's shipped spatial operations.

Pass an editor returned by `@jarenjs/studio/component`, `/flow` or `/data`.
These adapters own no editor controller, view, worker, database or task registry.
Every write requires the revision returned by `read`; rejected writes preserve
manual work. Hosts own mounts, lifecycle, templates and explicit execution.

See [engine authoring and measured limits](docs/AUTHORING.md) for the retained
compile-gated recipes, schema-size tradeoffs, spatial intent limits and original
provider evidence.

The [program pen reference](../linq/docs/PROGRAM-PEN.md) documents factories, types, refusals and executable examples for `@tangleai/linq/program`.
