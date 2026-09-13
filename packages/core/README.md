# @tangleai/core

Tangle AI core — memory record model, k-means clustering, token heuristics (vector arithmetic is @jarenjs/core/vector's)

Install with `npm install @tangleai/core`. The npm distribution provides ESM JavaScript, TypeScript declarations, and the documented package subpaths for Node 24 and Bun 1.4 or newer.

See the [Tangle documentation](https://github.com/jklarenbeek/tangleai#readme) for architecture, examples, and runtime requirements. All public Tangle packages use one coordinated version.

`@tangleai/core/schemas/temporal` exports closed temporal JSON contracts,
generated TypeScript types, `temporalSchema` and cached Jaren shape validation
through `validateTemporalShape`. The matching schema asset is exported as
`@tangleai/core/schemas/temporal.schema.json`. These describe occurrences, exact
source spans, claims, projections, queries, answers and durable operations.
Shape validation does not establish calendar validity or evidence truth; use
`@tangleai/memory/temporal`'s semantic constructors and validators for that.
See the [temporal API guide](https://github.com/jklarenbeek/tangleai/blob/main/packages/memory/docs/TEMPORAL.md).
