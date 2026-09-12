# @tangleai/models

Injected model clients, provider adapters, embeddings, replay, routing and structured generation.

The implementation and deterministic tests use strict TypeScript. Published
packages contain ESM JavaScript and declarations emitted from that source. Inject
fetch, storage and compiler services at the existing seams. The public source
exports and emitted npm JavaScript share one implementation.

## Public entries

- `@tangleai/models`
- `@tangleai/models/providers`
- `@tangleai/models/sse`
- `@tangleai/models/client`
- `@tangleai/models/embed`
- `@tangleai/models/structured`
- `@tangleai/models/errors`
- `@tangleai/models/check`
- `@tangleai/models/routing`
- `@tangleai/models/grammar`
- `@tangleai/models/replay`
- `@tangleai/models/package.json`

See [ownership and verification](../../docs/JAREN_AI_MIGRATION.md) for source
provenance, installation mode, unchanged serialized identities and qualification.

## The client

```js
import { createChatClient } from '@tangleai/models/client';

const client = createChatClient({
  provider: 'openrouter',            // 'openrouter' | 'ollama' | 'lmstudio' | 'custom'
  apiKey: userKey,                   // omit for local runtimes
  model: 'qwen/qwen3-4b',
});

const { message } = await client.complete({
  messages: [{ role: 'user', content: 'Say hi.' }],
  onDelta: (text) => process.stdout.write(text),   // streamed by default
});
```

Base URLs are forgiving: `http://localhost:11434` becomes `http://localhost:11434/v1`, a
pasted `…/chat/completions` suffix is stripped (in any case), and a query string or
fragment is refused with `AI0001` rather than spliced into the middle of every endpoint.
The resolved base is `endpoint.base`; `/chat/completions` and `/models` are both composed
from it, never re-derived from one another. `fetch` is injectable
(`createChatClient({ fetch: myFetch })`) so the client runs identically in the browser, in
Node, and in tests against a scripted stub. Failures carry stable codes: `AI0001` (caller
error), `AI0002` (HTTP error status), `AI0003` (malformed payload).

**Token limits are configurable.** `maxTokens` sets the client's default budget;
`complete({ maxTokens })` overrides its amount for one call. The client option
`maxTokensField` selects the JSON field: `'max_tokens'` by default for existing
compatible providers, or `'max_completion_tokens'` for OpenAI Chat Completions.
The client sends exactly one of these fields when a budget is set, and neither
when it is unset. Selection is explicit, independent of the URL and model.

```js
import { createChatClient } from '@tangleai/models/client';

const client = createChatClient({
  provider: 'custom',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL,
  maxTokens: 3000,
  maxTokensField: 'max_completion_tokens',
});
const reply = await client.complete({
  messages: [{ role: 'user', content: 'Say hi.' }],
  stream: false,
});
```

OpenAI's `max_completion_tokens` bounds visible output **and reasoning tokens**;
3,000 is their combined budget, not a promise of 3,000 visible tokens. OpenAI
documents `max_tokens` as deprecated and incompatible with o-series models.
Both parameters belong to Chat Completions; the Responses API is a different
endpoint. No OpenAI SDK is needed for this client. Other options still depend on
the selected model: `temperature` is omitted unless supplied, and `reasoning`
is a provider-specific passthrough, not a translation to OpenAI's
`reasoning_effort`. See the [OpenAI Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

**Retries are built in.** Transient failures — network errors, 408, 429, 5xx,
and malformed HTTP 200 payloads in either streaming mode — back off
exponentially with full jitter and try again (`retry: { attempts, baseMs, maxMs }`,
default 3 total tries; `attempts: 1` disables). A provider `Retry-After` header (seconds
or HTTP-date) overrides the computed delay, capped at `maxMs`. Two hard rules: a request
never retries once `onDelta` or `onReasoning` has received output, and an abort cancels the
backoff immediately, preserving the signal's exact cancellation reason. The final
transport `AI0002` reports `status`, `attempts`, and `retryAfterMs`; an exhausted
malformed reply reports `AI0003` with `attempts`.

**Reasoning models are first-class.** Thinking streamed as `delta.reasoning` (or
`reasoning_details`) reaches the caller through `onReasoning`, and the final message
carries a `reasoning` member — so a reasoning-only turn (empty `content`, non-empty
`reasoning`) is distinguishable from an empty one instead of rendering as a blank bubble.
The agent attaches `reasoning` to the **returned** message only: the transcript it
accumulates never carries it, so a host that persists `messages` and sends them back next
turn keeps a clean wire history.

**Thinking can be turned off** — `reasoning` is forwarded verbatim, as a client-level
default or per request: `createChatClient({ …, reasoning: { effort: 'none' } })`, and
`{ enabled: false }` does the same. (`{ exclude: true }` only HIDES the thinking; the
model still thinks and you still pay for it.) On a short, non-agentic call this is a large
win — measured on a hybrid Qwen model, a one-line answer went from 140 completion tokens
and 28.8s to 2 tokens and 0.5s. **Do not reach for it in an agent loop.** The same models,
asked to author a document through tools with thinking off, roughly doubled their tool
calls and stopped converging (2/3 then 0/3 runs reaching a green result, several hitting
the round limit): they plan the document in the reasoning channel, so removing it removes
the planning. Turn it off for classification, extraction and rewriting; leave it on for
tool use.

**A replay is a seam, and the client keys it.** `createChatClient({ …, cache })` takes
`{ get(key), set(key, value) }` — each sync or async, a `Map` in a test, SQLite or a
directory of files in a host — and answers a repeated request from it with **zero**
transport calls. The client builds the key, not the host: after endpoint resolution and
default application, from the exact credential-free body it would POST — provider,
normalized base, model, messages, tools, `tool_choice`, `temperature`, the selected token-limit field,
`reasoning`, `response_format` — canonicalized collision-free (`semanticKey` from
`@jarenjs/core/object`). `stream`, the signal, the callbacks and the headers never enter
it, and because the key is the body rather than an allow-list, an option added later
cannot alias an old key. A replay comes back marked `replayed: { ms }` with the
purchase's wall time and the purchase's `usage`, and fires `onDelta`/`onReasoning` once
each with the whole text, so a streaming caller sees one code path; a purchase is
remembered as `{ value, ms }`. The seam **fails closed**: an adapter that throws fails the
call, a stored entry that does not verify is `AI0003`, a request that cannot be keyed (a
function inside `tools`) is `AI0001` before any wire call — an adapter that wants to keep
buying while its storage is broken catches its own errors and answers `undefined`. The key
is the complete canonical request; an adapter that needs a fixed-width id hashes it with a
cryptographic hash, never a 32-bit one, or two prompts a token apart will one day share an
answer. A call ceiling counts wire calls at the injected `fetch`, which a replay never
reaches.

```js
const store = new Map();
const client = createChatClient({ provider: 'ollama', model: 'qwen3:4b',
  cache: { get: (key) => store.get(key), set: (key, value) => { store.set(key, value); } } });
const bought = await client.complete({ messages });        // one wire call, remembered
const replay = await client.complete({ messages });        // zero wire calls
replay.replayed;                                           // { ms: <the purchase's wall time> }
```

**Probe before the first turn.** `probeProvider({ provider, baseUrl, apiKey })` GETs the
provider's `/models` listing with exactly the auth a chat call would use and never throws:
`{ ok: true, models }` or `{ ok: false, status?, error }` — the contract a settings UI
wants for a "Test connection" button and a model picker.


## Embeddings

The same providers serve the OpenAI-compatible `/embeddings` wire beside `/chat/completions`
— OpenRouter at `/api/v1/embeddings`, Ollama and LM Studio at `/v1/embeddings` — and
`createEmbeddingClient` speaks it from the same resolved base, with the same key, headers,
`fetch` injection and retry policy as the chat client:

```js
import { createEmbeddingClient, probeEmbeddings } from '@tangleai/models/embed';
import { cosineSimilarity } from '@jarenjs/core/vector';

const embedder = createEmbeddingClient({
  provider: 'ollama',                // the chat client's providers, keys and base URLs
  model: 'nomic-embed-text',         // required — it is half of every vector's identity
});

const [a, b] = await embedder.embed(['a cat on a mat', 'quarterly revenue']);
cosineSimilarity(a, b);              // Float32Arrays in; higher is better
embedder.dims;                       // the width, settled by the first reply (or pass `dims`)
```

**The reply is verified, not trusted.** An `/embeddings` reply carries
`data: [{ index, embedding }]`, and providers do answer a batch out of order. The client
reassembles the items by `index` into input order and refuses the reply — `AI0003`, naming
the input — unless exactly one non-empty vector of finite numbers, of the expected width,
arrived per input. Components must stay finite after Float32 conversion, on the wire and
from replay; numbers that overflow that range are refused with `AI0003`.
An embedding attached to the wrong text is worse than an error, and this
is the one place in the suite that rule is enforced.

**A vector never travels without its identity.** Vectors from two models are pairwise
meaningless and compare into plausible garbage, so the client carries `model` and `dims`:
`dims` is either configured up front or fixed by the first reply, and every later reply is
held to it — a model that changed width under the same name is refused, never mixed.

**Retries and timeouts follow `complete()`.** Transient failures (network, 408, 429, 5xx, a
malformed 200) back off with the same `retry` option and the same `Retry-After` cap; an abort
ends everything at once. There is no default timeout, as `complete()` has none — a batch of
long texts on a local runtime legitimately takes a while; `timeoutMs` bounds each attempt when
you want one, and a timed-out attempt retries like a network failure.

**Replays are per text.** `createEmbeddingClient({ …, cache })` takes the same seam the chat
client documents and keys every input separately — the credential-free endpoint, the model
and the text — so a batch that repeats three of five texts fetches two: the remembered
vectors are placed, the rest travel in one wire call in input order, and every bought vector
is remembered as `{ vector: number[], ms }` (the batch's wall time; the array is JSON-only,
so a file or a SQL column stores it as it is). A call whose every text is remembered makes
no wire call, and its first replay settles `dims` exactly as a first reply would — a stored
vector of another width is `AI0003`, never mixed. Replays are observable at the seam (every
`set` is a purchase, every answering `get` a replay); `probeEmbeddings` never consults one.

**Probe before relying on it.** `probeEmbeddings({ provider, baseUrl, apiKey, model })` embeds
one word in one attempt (5 000 ms, as `probeProvider`) and never throws:
`{ ok: true, model, dims }` or `{ ok: false, status?, error }` — the contract for a settings
UI, and the live proof that a provider really serves `/embeddings`.

**The seam.** Everything in this package that consumes embeddings is written against three
members — `{ embed(texts, { signal }) → Promise<Float32Array[]>, model, dims }` — and anything
that implements them plugs in: the wire client above, a local transformer runtime, a native
embedding library. The contract a host implementation keeps: `embed` returns a Promise and
**rejects, never throws** (a synchronous throw escapes `.catch` and `Promise.all` alike — the
consumers here call it inside their own `try` so a host that slips is still caught, but the
contract is the rejection); one vector per input, in input order, all of one finite width;
`model` a non-empty string; `dims` the width, or `undefined` until a first reply settles it.
The ledger's `recall({ near })` and `embedMissing()` (§Compaction that moves) are the
consumers. This package ships no model weights, no tokenizer and no download, and publishes
no opinion on which embedding model is good; embedding *quality* belongs to the provider and
the host.

**The reference embedder is demo-grade, and says so.** `createHashEmbedder({ dims = 64 })`
implements the seam with hashed character trigrams (FNV-1a into `dims` buckets, l2-normalized)
— deterministic, dependency-free, network-free, identity `hash-trigram-<dims>`. It is
**lexical, not semantic**: two texts score high when they share letters, not when they mean the
same thing. It exists so that tests and offline demos exercise retrieval *mechanics* without a
network; it is not a substitute for a model.

The arithmetic — dot, cosine and Euclidean similarity (higher-is-better, a malformed pair
scores 0 and never throws), l2 normalization, the packed little-endian Float32 form and the
`isVector` shape guard — lives in [`@jarenjs/core/vector`](https://github.com/jklarenbeek/jarenjs/blob/main/packages/core/README.md#vectors), the
suite's one home for it.


## Structured output

```js
import { createStructuredOutput } from '@tangleai/models/structured';
import schema from '@jarenjs/json/schemas/jaren-query.llm-profile.schema.json' with { type: 'json' };

const out = createStructuredOutput({ client, schema, name: 'jaren_query' });
const result = await out.generate([{ role: 'user', content: 'books over €10' }]);
if ('value' in result) compileJsonQuery(result.value);   // validated, ready to compile
else console.log(result.errors);                          // instancePath'd, model-readable
```

One call, every provider tier: where the provider speaks
`response_format: json_schema` the schema constrains decoding; where it only has JSON
mode, or nothing, the schema travels in a system instruction. Either way the reply is
parsed (accidental code fences stripped) and **validated locally** by `@jarenjs/validate`
— the provider is an accelerator, never the authority — and a failed round goes back to
the model with the instancePath'd errors for a bounded number of repairs (`maxRepairs`,
default 1). The query/JSLT grammars ship LLM-profile twins built for exactly this
(see `@jarenjs/json`'s README).
