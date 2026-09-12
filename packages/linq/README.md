# @tangleai/linq

Typed, immutable pens for Tangle AI document formats. A pen is a fluent authoring
API whose deliverable is plain, deeply frozen JSON. It does not execute that
document or duplicate its compiler. Shared snapshotting, option checks and query
capture come from `@jarenjs/linq/authoring`.

The package currently contains one pen, at `@tangleai/linq/program`:

```ts
import { program } from '@tangleai/linq/program';

const document = program(['data'])
  .select('data', 'count', value => value.get('items').count())
  .answer('count')
  .schema;
```

The root supports `import { program as p } from '@tangleai/linq'`, followed by
`p.program(['data'])`. It also exports the same `LinqBuildError` class used by
Jaren pens. Each future pen will have a separate subpath. There are no additional
pens or query execution APIs in this package today; generic schema, model, flow,
contract and other Jaren pens remain in `@jarenjs/linq`.

The program pen tracks declared inputs, output names, slot/family kinds and the
terminal answer in TypeScript. Its eight operations are `chunk`, `grep`,
`select`, `stat`, `peek`, `map`, `reduce` and `answer`. Use `.schema` or `.toJSON()`
to obtain the document, then validate/compile/run it with `@tangleai/agents`.
Raw documents passed to `from()` make no binding-order or terminal-state inference.

See [the program reference](docs/PROGRAM-PEN.md) for exact options, emitted JSON,
refusals, type limits and executable examples. The package depends only on
`@jarenjs/linq`; its pen bundle is checked to exclude runtime engines and Tangle
model/context/agent mechanisms.

Replace imports from `@tangleai/jaren/program` with `@tangleai/linq/program`.
For pen symbols previously imported from the `@tangleai/jaren` barrel, import
from `@tangleai/linq/program` directly. Workspace exports point to strict
TypeScript; npm artifacts contain compiled ESM JavaScript and emitted declarations.
