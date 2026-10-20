# Contract tools

`@tangleai/jaren/contract-tools` turns a compiled Jaren contract into agent tools sized to
the model that will call them. It builds on `contractTools` from
`@jarenjs/contract/project`, which projects every public, invokable operation into a
validated `{ name, description, inputSchema, execute }`, and adds what every host composing
those by hand has had to write itself: host-pinned input members, outcomes shaped for a
model, and staging under the model's tool budget.

```javascript
import { compileContract } from '@jarenjs/contract';
import { openLocalClient } from '@jarenjs/contract/local';
import { createChatClient } from '@tangleai/models/client';
import { createAgent } from '@tangleai/agents/agent';
import { createToolbox } from '@tangleai/agents/toolbox';
import { createContractToolbox } from '@tangleai/jaren/contract-tools';

const model = 'qwen/qwen3.6-35b-a3b';
const contract = compileContract(boardContract);
const client = openLocalClient(contract, handlers, { validateOutput: 'always' }); // or openHttpClient

const tools = createContractToolbox(contract, client, { model, pin: { by: 'oracle' } });
const toolbox = createToolbox();
for (const tool of tools.tools) toolbox.add(tool);

const agent = createAgent({
  client: createChatClient({ provider: 'openrouter', apiKey, model }),
  toolbox,
  maxToolRounds: 12,
});
const { message } = await agent.send([{ role: 'user', content: 'Import these notes into the roadmap board.' }]);
```

The result is the staged tool set of `@tangleai/agents/staging` — `tools`, `direct`,
`staged`, `drafts()` — plus the resolved `budget`, the model's `profile` (or `null`), and
`execute(name, args)`, which calls one of `tools` with the same input validation a toolbox
applies.

| option | meaning |
| --- | --- |
| `model` | The model id; with `budget` `'auto'` or omitted, its `modelProfile` decides the budget. |
| `budget` | `'auto'` (the default), a tier name, or a partial budget over the model's own — or over the tier it names. |
| `pin` | Input members the host fixes, e.g. `{ by: 'oracle' }`. |
| `name`, `ops` | Passed to `contractTools`: the tool name of an operation id (default `.` → `_`), and the operations to offer. |
| `prefix`, `maxDrafts` | Passed to `stageTools`: the prefix of the draft and catalog tool names, and the most drafts open at once (default eight). |

An unknown option, a `name` that is not a function, a pin that is not a JSON value, a pin
that no offered operation declares, and a partial budget without a tier when no model is
given each throw `AI0001`. Contract misuse — a client without `invoke`, an `ops` entry
that names no operation — is `contractTools`' own `JC1008`.

## Budgets

The budget is a dynamic per-model parameter (see the models package's per-model tool
profiles). Under it, an operation whose typical input — `estimateArgumentChars` of its
input schema — exceeds `maxArgumentChars` is built as a draft (`draft_open`, `draft_set`,
`draft_append`, `draft_view`, `draft_commit`, `draft_discard`), and under a catalog budget
the other operations sit behind `tool_list`, `tool_describe` and `tool_call`. On the test
fixture's twelve-note import, `qwen/qwen3.6-35b-a3b` (a mixture of experts with 3B active
parameters, the `small` tier) gets the import as a draft and the catalog, while
`qwen/qwen3.8-27b` (dense 27B, `medium`) is offered the whole import directly.

With `budget: 'unlimited'`, or with neither a model nor a budget, nothing is staged: the
tools are `contractTools`' own names, descriptions and input schemas, pinned and with
shaped outcomes.

## Pins

A pinned member applies to every offered operation whose input declares it — a member of
the operation's input object, after any root `$ref` — and to no other. It leaves the
schema the model is asked to fill (`properties` and `required`), so the model is never
asked for it, and it is applied on every call over whatever arrived: a closed schema
refuses the member from the model before anything runs, and a host that calls a definition
directly still gets the pin. The contract client then validates the completed input
against the contract once more, so a pin the contract refuses fails as the contract's own
`JC2050` outcome.

## Outcomes

A contract outcome reaches the model as

```javascript
{ ok: true, value, meta: { op } }
{ ok: false, error: { code, message, details }, meta: { op } }
```

The operation id stays; the trace, attempt, revision and entity tag do not, because they
mean nothing to a model. A value that is not an outcome passes through unchanged, and the
toolbox's own input refusal (`{ error, errors, inputSchema }`) arrives before any call.

## Human-only operations

An operation with `policy: { audience: 'server' }` is never offered: `contractTools` keeps
it out of the public projection every tool is built on, naming it in `ops` does not offer
it either, and `tool_list`, `tool_call` and `draft_open` do not know it.

## WebMCP

The same contract tools can still be published to a browser model context. The plain
projection registers as before through `registerWebMcp` from `@jarenjs/contract/webmcp`:

```javascript
import { contractTools } from '@jarenjs/contract/project';
import { registerWebMcp } from '@jarenjs/contract/webmcp';

const binding = registerWebMcp(contractTools(contract, client));
await binding.ready;   // dispose() when the host leaves
```

The sized tools go through a toolbox, so that every call is validated before it runs —
`registerModelContext(toolbox)` from `@tangleai/agents/toolbox`, with the toolbox built
from `tools.tools` as above.

## What is proven

`test/jaren/contract-tools.test.ts` drives the whole path through `createAgent` with a
scripted model that cannot emit more than 700 characters per tool call; a longer call
comes back cut at the limit with `finishReason: 'length'`. Offered the whole import
(`budget: 'unlimited'`), it is cut off twice and the handler never runs. Under its own
budget (`model: 'qwen/qwen3.6-35b-a3b'`) its first, whole call is cut off too, the error
points at the drafts, and it reads the note schema, sends the twelve notes in four appends
of at most 600 characters and commits: the handler receives the full, valid input once,
with the pinned member. No live model has been measured against these tools yet.
