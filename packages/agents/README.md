# @tangleai/agents

Validated tools, bounded agents, action programs, recursive execution and guarded refinement.

The implementation and deterministic tests use strict TypeScript. Published
packages contain ESM JavaScript and declarations emitted from that source. Inject
fetch, storage and compiler services at the existing seams. The public source
exports and emitted npm JavaScript share one implementation.

## Public entries

- `@tangleai/agents`
- `@tangleai/agents/toolbox`
- `@tangleai/agents/agent`
- `@tangleai/agents/program`
- `@tangleai/agents/recursive`
- `@tangleai/agents/refine`
- `@tangleai/agents/schemas/program`
- `@tangleai/agents/program-result`
- `@tangleai/agents/program-session`
- `@tangleai/agents/package.json`

See [ownership and verification](../../docs/JAREN_AI_MIGRATION.md) for source
provenance, installation mode, unchanged serialized identities and qualification.

## The toolbox

```js
import { createToolbox, registerModelContext } from '@tangleai/agents/toolbox';

const toolbox = createToolbox();
toolbox.add({
  name: 'lookup_order',
  description: 'Look up one order by id.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string', minLength: 1 } },
    required: ['id'],
  },
  execute: ({ id }) => orders.get(id) ?? { error: `no order '${id}'` },
});

// the same tools, published to a browser-hosted agent (WebMCP):
const binding = registerModelContext(toolbox);
await binding.ready;
// On host teardown: await binding.dispose();
```

Every call is validated against the tool's schema by `@jarenjs/validate` before the tool
runs. `execute` never throws for content-level problems — unknown tool, invalid input, or
a throwing tool all come back as `{ error }` results the model can read and correct.

Weak models routinely JSON-*encode* a nested argument. Where the schema wants an object or
an array and a parseable JSON string arrived, the toolbox parses it and validates the
parsed value, so the tool sees what the model meant instead of a type error. A rejected
call answers `{ error, errors, inputSchema }` — up to eight validation errors as
`{ instancePath, keyword, message }`, plus the tool's own schema to re-read — and adds a
named `hint` when a property that wanted structure arrived as JSON text that does not
parse, naming the offending properties.

### The geo toolbox — spatial answers about data the model was given

`createGeoToolbox` is a closed set of seven tools, each one call into `@jarenjs/core/geo`
and each guarded by the shipped GeoJSON meta-schema **by reference**:

```javascript
import { createGeoToolbox } from '@tangleai/jaren/geo-tools';
import { registerModelContext } from '@tangleai/agents/toolbox';
import geojson from '@jarenjs/json/schemas/geojson.schema.json' with { type: 'json' };

const geo = createGeoToolbox({ geojson });     // the artifact is injected — this package depends on no engine
geo.execute('geo_distance', { a: [4.9041, 52.3676], b: { type: 'Point', coordinates: [2.3522, 48.8566] } });
// → { metres: 429861.98… }
geo.execute('geo_neighbours', { cell: 'u173zt' });   // → { cells: [ …nine cells, reading order… ] }
const binding = registerModelContext(geo);           // the same seven over WebMCP
await binding.ready;                                // dispose when the host leaves
```

| tool | input | returns |
| --- | --- | --- |
| `geo_distance` | two GeoJSON values (or bare positions) | `{ metres }`, geodesic, between representative positions |
| `geo_within` | a value and an area | `{ within }` — only a polygon has an inside |
| `geo_bbox` | a value | `{ bbox: [w, s, e, n] }` |
| `geo_geohash` | a value, `precision` 1–12 (default 9) | `{ cell }` — a bucket, the description says so |
| `geo_neighbours` | a cell | `{ cells }` — the nine-cell **proximity** probe |
| `geo_parse_wkt` / `geo_to_wkt` | text ↔ value | the conversion, both ways |

Every `inputSchema` `$ref`s `https://jarenjs.dev/schemas/geojson` (and its `position`
definition) rather than restating a geometry shape, so a longitude of `200` is refused by
the validator at `/a/coordinates/0` with the schema to re-read — before the tool runs, and
not by a `try`/`catch` (the module has none). A value with no positions is a content
refusal the model can read (`{ error }`). And there is **no overlay**: a request for
`geo_union`, `geo_intersection`, `geo_difference`, `geo_buffer` or their kin is answered
with a refusal naming why — a half-correct clipper is worse than none, and JSTS or Turf do
that work — never an approximation.


## The agent loop

```js
import { createAgent } from '@tangleai/agents/agent';

const agent = createAgent({ client, toolbox, system: 'You are…', maxToolRounds: 5 });
const { message, messages, steps } = await agent.send(history, {
  onDelta: (text) => ui.stream(text),
  onToolCall: ({ name }) => ui.activity(name),
});
```

The loop is bounded (`maxToolRounds`, default 5) and stops with a readable message instead
of spinning; oversized tool results are truncated (`maxToolResultChars`, default 8000) so
a local model's context is respected. `send` never mutates the history it receives — it
returns the complete new transcript, ready to persist and send back next turn.

**Long sessions fit a small context — for questions about one thing at a time.** That
qualification is load-bearing and the numbers below are why: compaction keeps a session
runnable and answerable one fact at a time, and a question that needs *every* fact at once
stops being answerable the moment anything is cut. `historyBudget` (characters — deterministic where
tokens are provider-private) compacts each request when the history outgrows it: the
system prompt, the first user message and the largest tail that fits always survive, and
the dropped middle becomes one synopsis message naming every dropped tool round. Cuts
happen only at tool-round boundaries, so `tool_calls`/`tool` pairing stays wire-legal —
always. The built-in synopsis is pure string work (no second model call; a single local
model runs unassisted); `compaction: (droppedRounds, addresses) => string` swaps in your
own writer. The returned transcript is always the full, uncompacted history.

On its own that is lossy, and worth being precise about, because the loss has a shape.
Each dropped tool call leaves one line whose result excerpt is capped at 60 characters, so
the synopsis remembers **that** `fetch_record` was called and returned a `REC0007` and
loses **what the record said**. Measured on <!--fact:horizon.measured-->2026-08-13, Node v22.22.2, 40 tool rounds<!--/fact--> of ~440-character results at a
6 000-character budget, with the fact behind the padding, the request keeps <!--fact:horizon.synopsisGap-->15 of 40 record ids and 7 of their 40 values<!--/fact--> (`npm run benchmark:long-horizon`). A model can see the label and answer confidently from
a record it no longer has. **Compaction alone is not the answer to a long session.**

### Compaction that moves instead of destroying

Give the agent a ledger and nothing leaves the request without a copy that can be named:

```js
import { createAgent } from '@tangleai/agents/agent';
import { createLedger } from '@tangleai/context/ledger';

const ledger = createLedger({ storage });        // storage is yours to inject
const agent = createAgent({ client, toolbox, historyBudget: 6000, ledger });
```

`createLedger()` takes no arguments and works in memory, so a static page degrades cleanly;
durability is a storage adapter the host injects — four async methods and nothing else:

```js
const storage = {
  get: async (key) => …,              // a JSON value, or undefined
  set: async (key, value) => …,       // value is a JSON value
  delete: async (key) => …,           // an absent key is not an error
  keys: async (prefix) => […],        // every key starting with prefix, sorted
};
```

`keys()` really must be **sorted**: listings, the goal archive and a snapshot's entries are
read in key order, and the ledger's zero-padded sequences exist so that order is
chronological. One optional fifth method, `rank`, lets an adapter that can rank vectors
where they live answer `recall({ near })` without handing every record over (§A durable
ledger over `@jarenjs/db`).

Back it with `@jarenjs/db` over OPFS, with one `localStorage` slot, with a file, with a
server — or with nothing. The package gains no dependency either way, which is the whole
posture: storage stays injected and it degrades to in-memory and
schema-only. This site's assistant backs it with a single JSON slot
([`storage/slot.ts`](../context/src/storage/slot.ts)), which is all a browser session
needs. The ledger serializes its own writes. An adapter with `mutate` also
serializes other writers at storage; `ledger.concurrency` reports `atomic` or
`single-writer`. Four-method adapters require host coordination between writers.
The website uses Web Locks, reads fresh bytes inside the lock, and holds it across
the browser's localStorage publication boundary. Quota and lock failures are visible.


The ledger holds four kinds, and they differ in every dimension that matters — lifetime,
retrieval and who may write them:

| kind | what it is | how it is retrieved | written by |
|---|---|---|---|
| `goal` | the one active objective and its append-only progress | always in the prompt | the host (`setGoal`), a refinement (progress only) |
| `memory` | an evidenced fact worth carrying past this context | `recall({ tags, where, near, limit })` | the host, or a gated refinement |
| `skill` | a reusable recipe: when it applies, what to do | `recallSkills(…)` — the same query | the host, or a gated refinement |
| `slot` | addressable content too big to carry; metadata is separate from the bytes | by name (`recall` the tool) | the harness — never proposed by a model |

Retrieval is tag match plus recency by default. Inject `compileQuery`
(`compileJsonQuery` from `@jarenjs/json/query`) and a `where` predicate becomes a real
query document — the same document `@jarenjs/db` could push down to SQL. Without that seam
a `where` is **refused**, not ignored: a filter silently dropped answers the wrong question
with a straight face.

**Recall by meaning is the same shape of seam.** A memory or skill may carry an `embedding`
(plain `number[]` — never a typed array, because the storage boundary is JSON) together with
its identity, `embeddedBy: { model, dims }`; the two travel as a pair, the vector must be
exactly `dims` finite numbers, and an un-embedded record is exactly as valid as before.
Inject an embedder (§Embeddings) and `recall({ near })` ranks by cosine similarity through it:

```js
import { createLedger } from '@tangleai/context/ledger';
import { createEmbeddingClient } from '@tangleai/models/embed';

const embedder = createEmbeddingClient({ provider: 'ollama', model: 'nomic-embed-text' });
const ledger = createLedger({ storage, embedder });      // embedOnWrite stays off

await ledger.addMemory({ text: 'The export uses CRLF line endings.', evidence: 'head export.csv' });
await ledger.embedMissing();                            // → { embedded: 1, remaining: 0 }
const { memories, scores, skipped } = await ledger.recall({
  near: 'line endings in the export', tags: ['csv'], limit: 5, minScore: 0.3,
});
```

- **Refused without the seam.** `recall({ near })` on a ledger with no embedder answers
  `{ error: 'recall: near needs the embedder seam — …' }`, exactly as a `where` refuses without
  `compileQuery`. An absent capability refuses; it never degrades to a different answer.
- **Refused across identities.** Every candidate's `embeddedBy` is compared with the query
  embedder's `{ model, dims }` before any arithmetic. Two models in the ledger, or a ledger
  embedded by one model and queried through another, answer `{ error }` naming every identity
  found — never the matching subset, because a silent subset is a silent wrong answer.
  The comparison is `sameIdentity(a, b)` and the wording is `describeIdentity(identity)`,
  both exported, because the rule is not the ledger's alone: a storage adapter that
  ranks applies the same comparison where the records live, and so does a host with a
  vector store of its own beside the ledger.
- **Skipped, reported.** The candidates are the records that pass `tags`/`where` AND carry a
  vector; the ones that pass and carry none are counted in `skipped`, never scored (a fabricated
  score poisons a ranking) and never hidden (a silent drop poisons trust). The result is
  `{ memories, scores, skipped, via, ranking }` — `scores[i]` is `memories[i]`'s cosine, descending; equal
  scores fall back to recency, then id, so the order is deterministic; `minScore` filters the
  ranked list and `limit` caps what survives. `recallSkills({ near })` answers `{ skills, scores,
  skipped, via, ranking }` the same way, a skill's meaning being its name, when and instructions together.
- **`embedMissing({ limit?, batch? })` is the explicit sweep** — every un-embedded memory and
  skill, through `embed(texts[])` in batches, written inside the ledger's write chain, answering
  `{ embedded, remaining }`. A positive fractional `batch` is floored to at least one.
  A second run embeds zero and makes no seam call. A failing batch
  ends the run with the error surfaced once: what was embedded before it is written, the rest
  stays un-embedded and is counted in `remaining` — never a throw that loses the batch. A ledger
  that already holds vectors under another identity is refused up front rather than turned into
  the mixture `recall` would then refuse.
- **`embedOnWrite` is off by default**, because a write must not silently acquire a network
  dependency. `createLedger({ embedder, embedOnWrite: true })` embeds a record that arrives
  without a vector inside its own write; a seam failure then stores the record **un-embedded**
  and reports it on the returned record as `embedError` (not part of the stored record) — one
  bad network call never loses a memory, and `embedMissing()` closes the gap later.
- **No arithmetic lives here.** The cosine is `@jarenjs/core/vector`'s; the ledger calls it and
  computes nothing. Ranked recall is an exact sweep by default — one adapter scan plus one cosine
  per embedded record, reported as `via: 'sweep'` — which is the right tool for a ledger of
  thousands and the wrong one for millions; the instrument below says what it costs, and an
  adapter that declares `rank` (below) turns that scan into a k-nearest plan. The same question over a `@jarenjs/db`
  collection is the query language's own k-nearest composition (QUERY-FORMAT §8.15) — and
  over a `derive: 'vector'` column the store plans it as a cut the engine finishes, with
  `explain()` naming the mode (its ARCHITECTURE, "The k-nearest plan").
- **Measured, whichever way it fell.** `benchmark/retrieval.ts` scores the ranked path beside the
  default over the same seeded corpus, through the deterministic reference embedder
  (§Embeddings — lexical, so a mechanism score, not a model-quality claim): <!--fact:retrieval.ranked-->5.0% of questions at 10,000 memories through the hash-trigram-64 reference embedder (33.8% at 1,000), ahead of tag match and recency's 1.3%<!--/fact-->.
  A real model's number is the host's to measure through the same instrument's `--live` tier.

The [labelled retrieval instrument](https://github.com/jklarenbeek/jarenjs/blob/main/benchmark/README.md#labelled-recall-and-repeated-refinement)
adds a checksum-pinned SciFact import, neutral host datasets, resumable vectors
and explicit dataset/embedding classes. It measures the real ledger using
standard fractional recall, MRR and nDCG; the historical synthetic row above
uses hit rate. Model claims remain tied to their dataset, provider and date.

Reference measurement: <!--fact:recall.reference-->baai/bge-m3 (1024 dimensions, openrouter, 2026-09-09): recall@10 0.783, MRR@10 0.608, nDCG@10 0.644 on 5183 SciFact documents and 300 test queries.<!--/fact-->

#### A durable ledger over `@jarenjs/db`

The adapter is four methods over one collection, and it needs nothing from this package —
the storage contract is the whole interface between a ledger and where it lives. Declare a
`derive: 'vector'` column over the records' embeddings and the same adapter can implement
the **optional fifth**, `rank`, so `recall({ near })` is answered by the store's k-nearest
plan instead of by reading every record back to be swept:

```js
import { openStore } from '@jarenjs/db';
import { nodeDriver } from '@jarenjs/db/node';

/**
 * One collection is the whole schema a ledger needs: the storage key,
 * the JSON value, and — when records carry embeddings — one packed
 * vector column derived from `value.embedding`. `value` is deliberately
 * untyped: the ledger stores objects, strings and arrays under the same
 * contract, and only the vector member has to be declared.
 */
const ledgerModel = (dims) => ({
  $model: '0.1',
  collections: {
    slots: {
      schema: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { properties: { embedding: { type: 'array', items: { type: 'number' } } } },
        },
        required: ['key'],
      },
      key: '/key',
      indexes: dims === undefined ? []
        : [{ name: 'by_vec', path: '$.value.embedding', derive: 'vector', dims }],
    },
  },
});

/** A collection answer as a list — `execute` returns the bare item for one. */
const many = (result) => (Array.isArray(result) ? result : result === undefined ? [] : [result]);

/**
 * A durable ledger storage adapter over one `@jarenjs/db` collection:
 * the four methods, plus `rank` when a vector column is declared. It
 * imports nothing from the ledger implementation — the storage contract is the
 * whole interface between them.
 *
 * The prefix is INLINE in every query document rather than bound as an
 * external, because a string operator only translates to SQL with a
 * literal pattern; inlined, `keys()` and the ranked read both become a
 * range scan over the key column. The ledger asks for a handful of
 * distinct prefixes, so the documents are built once each and cached.
 */
export async function createDbStorage({ path = ':memory:', dims } = {}) {
  const store = await openStore(ledgerModel(dims), { driver: nodeDriver(), path });
  const slots = store.collection('slots');
  const documents = new Map();

  /** Every query document one prefix needs, built once. */
  const forPrefix = (prefix) => {
    let built = documents.get(prefix);
    if (built !== undefined) return built;
    const under = { '$starts-with': ['$r.key', prefix] };
    const score = { $similarity: ['$r.value.embedding', '$q'] };
    const mine = [{ $eq: ['$r.value.embeddedBy.model', '$model'] },
      { $eq: ['$r.value.embeddedBy.dims', '$dims'] }];
    const counted = (where) => ({ $count: { $for: { r: '$[*]' }, $where: where, $return: '$r' } });
    const ranked = {
      $for: { r: '$[*]' },
      $where: { $and: [under, ...mine] },
      // the ledger re-scores and re-sorts what comes back, so this
      // ordering only has to agree with its tie-break: score, then
      // newest, then the key
      $orderby: [{ $key: score, $dir: 'desc', $empty: 'least' },
        { $key: '$r.value.at', $dir: 'desc' }, '$r.key'],
      $return: { key: '$r.key', score },
    };
    built = {
      keys: { $for: { r: '$[*]' }, $where: under, $orderby: ['$r.key'], $return: '$r.key' },
      ranked,
      window: (limit) => ({ $subsequence: [ranked, 0, limit] }),
      skipped: counted({ $and: [under, { $not: { $exists: '$r.value.embedding' } }] }),
      held: counted({ $and: [under, { $exists: '$r.value.embedding' }] }),
      ours: counted({ $and: [under, { $exists: '$r.value.embedding' }, ...mine] }),
      names: { $distinct: { $for: { r: '$[*]' }, $where: under, $return: '$r.value.embeddedBy' } },
    };
    documents.set(prefix, built);
    return built;
  };

  return {
    mutate: async (prefix, transform) => store.transaction((tx) => {
      const rows = tx.sync.collection('slots');
      const prefixes = typeof prefix === 'string' ? [prefix] : prefix.prefixes ?? [];
      const keys = [...new Set([...(prefix.keys ?? []), ...prefixes.flatMap((part) => many(rows.execute(forPrefix(part).keys)))])].sort();
      const matches = (key) => (prefix.keys ?? []).includes(key) || prefixes.some((part) => key.startsWith(part));
      const current = Object.fromEntries(keys.map((key) => [key, rows.get(key)?.value]));
      for (const key of Object.keys(current)) if (current[key] === undefined) delete current[key];
      const outcome = transform(current);
      if (!outcome || typeof outcome.then === 'function') throw new TypeError('mutate callback must be synchronous');
      if (outcome.next !== undefined) {
        const next = JSON.parse(JSON.stringify(outcome.next));
        if (Object.keys(next).some((key) => !matches(key))) throw new TypeError('mutation escaped its namespace');
        for (const key of keys) if (!Object.hasOwn(next, key)) rows.delete(key);
        for (const [key, value] of Object.entries(next)) rows.put({ key, value });
      }
      return outcome.result;
    }, { mode: 'immediate' }),
    get: async (key) => (await slots.get(key))?.value,
    set: async (key, value) => { await slots.put({ key, value }); },
    delete: async (key) => { await slots.delete(key); },
    // sorted, because the ledger reads listings, the goal archive and a
    // snapshot's entries in key order and its zero-padded sequences
    // exist so that order is chronological
    keys: async (prefix = '') => many(await slots.execute(forPrefix(prefix).keys)),
    /**
     * The optional fifth: rank where the records live. The window is the
     * k-nearest plan — the vector column cuts the candidates, the engine
     * orders them — and the two reports the ledger needs are counts,
     * which push to SQL. Naming every identity costs a scan, so it is
     * paid only when the counts prove a mixture, which is the one case
     * that is about to refuse anyway.
     */
    rank: async ({ prefix, vector, model, dims: width, limit }) => {
      const docs = forPrefix(prefix);
      const externals = { q: vector, model, dims: width };
      const hits = many(await slots.execute(
        limit === undefined ? docs.ranked : docs.window(limit), { externals }));
      const skipped = await slots.execute(docs.skipped);
      const held = await slots.execute(docs.held);
      const ours = await slots.execute(docs.ours, { externals });
      const identities = held === ours
        ? (ours === 0 ? [] : [{ model, dims: width }])
        : many(await slots.execute(docs.names));
      return { hits, skipped, identities };
    },
    // beyond the contract, and deliberately: the store is the host's to
    // migrate, back up and explain, and hiding it would only mean
    // opening a second one to do any of that
    store,
    close: () => store.close(),
  };
}
```

`recall({ near })` reports which path answered — `via: 'adapter'` when the store ranked,
`via: 'sweep'` when the ledger did. Exact adapters answer the same records with the same scores
as the sweep: the adapter selects candidates, the kernels re-score them, and `minScore` and
`limit` are applied here, so an adapter can never quietly change what a similarity means. A
query carrying `tags` or `where` narrows on members the adapter knows nothing about and
takes the sweep. An adapter whose `rank` answers anything other than
`{ hits, skipped, identities }` is refused rather than trusted, because a capability that
cannot be relied on to report what it skipped is worse than one that is absent.

`identities` is what makes the mixture refusal the ledger's and not each adapter's: the
store reports the distinct `embeddedBy` it holds under the prefix, and the wording, the
order and the decision stay in one place. Above, that report is two pushed `COUNT(*)`
statements on the hot path — the naming scan is paid only when the counts prove a mixture,
which is the one case about to refuse anyway.

Adapters may also return `ranking: { algorithm, exhaustive, candidateCount }`.
Approximate selectors declare `exhaustive: false`; old adapters normalize to
`legacy-exact` with `exhaustive: true`. The sweep reports `exact-cosine`.
`candidateCount` counts returned candidates before filtering and capping, not
all indexed records. Approximate adapters should return enough candidates for
ledger re-scoring. Their candidate set can lose recall; their supplied scores
never become the final scores. Returned keys must be unique and under the
requested prefix, and stored ids, embedding identities and vectors are checked.
A concurrently deleted candidate is omitted. The adapter must still report
every identity under the prefix; completeness cannot be proved from its selected
hits alone. Tag/where filters continue to use the exhaustive sweep.

Index decision: <!--fact:recall.annDecision-->0/6 contender rows cleared all bars; retain exact. Required exact-top-10 recall ≥ 0.95, p95 speedup ≥ 2×, and a measured exact p95 ≥ 100 ms. The largest reference corpus contains 5183 documents; scale beyond it remains unmeasured.<!--/fact-->

Selecting "the records whose `embeddedBy` is `{ model, dims }`" is the one piece of the
ledger's rule an adapter has to apply itself, so it is exported rather than left to be
re-derived:

```js
import { sameIdentity, describeIdentity } from '@tangleai/context/ledger';

rank: async ({ prefix, vector, model, dims, limit }) => {
  const query = { model, dims };
  const under = await readUnder(prefix);
  const mine = under.filter((record) => sameIdentity(record.embeddedBy, query));
  const identities = [...new Map(under
    .filter((record) => record.embedding !== undefined)
    .map((record) => [describeIdentity(record.embeddedBy), record.embeddedBy])).values()];
  return { hits: score(mine, vector).slice(0, limit), skipped: under.length - mine.length, identities };
},
```

The SQL adapter above cannot call it — a predicate that pushes to the database has to be
written as a query document — which is exactly why the JavaScript form is published: every
other adapter, and every host keeping its own vector store beside the ledger, applies one
implementation instead of writing a second. Two edges make that worth insisting on:
`sameIdentity(undefined, undefined)` is **false** (a record with no identity has no space
to share, so "unknown" must never rank against "unknown"), and matching `dims` alone is
never enough (two models at 768 produce vectors whose cosine is arithmetic without
meaning).

Each dropped round is archived to a slot **before** the synopsis is written, and every
synopsis line carries its address:

```
[Earlier context was compacted. 33 round(s) are ARCHIVED, not lost: recall("rx-…") lists
 every address; recall(name) returns one in full. What happened:]
- called fetch_record({"index":7}) → {"id":"REC0007","notes":"xxxx… [recall("r-8kq2p-442") · 442B]
```

The excerpt is now a *preview*, not a summary. A `recall` tool is registered alongside your
own (only when there is a ledger, and never over a `recall` you registered yourself), so
the model fetches a round back when it needs one — a normal tool call that shows up in
`steps` like any other, rather than an automatic re-expansion guessing which round mattered.

- **Addresses are content-derived**, so compacting the same history twice writes the same
  slots rather than a second copy. A fingerprint collision refuses compaction before
  dropping transcript content; exact bytes establish whether an existing address is reusable.
- **The allowance grows with the number of archived rounds** instead of being flat, and is
  capped at a quarter of the budget so the addresses cannot crowd out the recent tail. The
  budget still holds to the character.
- **The header survives truncation.** If the synopsis itself has to be cut, the per-round
  addresses go but the index address does not — and the index lists every one of them.
- **A store that refuses a write throws** (`AiError` `AI0001`). The alternative is dropping
  a round while claiming an address for it, which is the failure this exists to remove.

The contract, asserted over every budget the benchmark sweeps in both payload shapes
(`test/agents/compaction-recovery.test.ts`): **every fact the full transcript held is either
still in the request verbatim or reachable through an address the request names** — <!--fact:horizon.ledgerRecovered-->40 of 40<!--/fact--> record values at the same budget, where the same runs without a ledger keep <!--fact:horizon.synopsisBand-->1 to 28<!--/fact--> of them. What that
costs is a few characters of verbatim retention at the tightest budgets, published beside
the win.

That is the model-free half. Here is a real model on the same contexts — the realistic
payload shape, one needle question per trial, scored by whether the answer is right:

<!--fact:horizon.liveNeedle-->
| history budget | without a ledger | with a ledger | recall calls |
| --- | --- | --- | --- |
| 20000 | 66.7% | 66.7% | 0 |
| 10000 | 50.0% | 66.7% | 1 |
| 6000 | 0.0% | 50.0% | 3 |
| 4000 | 33.3% | 100.0% | 3 |
| 2000 | 0.0% | 100.0% | 5 |
<!--/fact-->

The last column is the point: those answers were fetched, not remembered. A ledger row
that scored well with **zero** recalls would have scored on what was still in front of it,
and the number is printed either way so that cannot be read as a win. Three trials per row
is a small sample with a wide error bar — the ceilings above are the structural claim, this
is the check that a model can actually use them.

**And here is what it does not fix.** A question that needs *every* fact at once (which two
of forty records are closest?) is unanswerable the instant one round is cut, and a ledger
does not change that: forty rounds fetched one at a time do not fit the budget they were
cut to fit. The benchmark scores that question too and publishes it beside the needle: <!--fact:horizon.pairwise-->0% at every budget that compacts anything except ledger/front at 20000<!--/fact-->.
Recall is the wrong shape of answer for it: the fact is not missing, the *relation* is, and
no number of one-at-a-time fetches reconstructs it inside the budget. Moving that number
needs the corpus held *outside* the context and worked on programmatically, which is what
[the environment](#the-environment--a-corpus-you-work-on-not-one-you-read) and
[the action language](#the-action-language--a-program-the-model-writes-and-the-compiler-checks)
below are for — the same question, asked of an environment, is answered by a program that
visits every record by address while the root carries a plan and a step report. The live
tier of the numbers above ran on <!--fact:horizon.live-->qwen/qwen3.6-35b-a3b, 3 trial(s) per row, 146 model calls<!--/fact-->.

Without a `ledger`, all of this is inert and compaction behaves exactly as it always did.


## The action language — a program the model writes and the compiler checks

For typed fixture and host authoring, the [AI program pen](../linq/docs/PROGRAM-PEN.md)
emits this same document and imports no AI runtime.

The environment lets a model *address* a corpus. A program lets it *work* one: a small
document whose steps name slots and operations, generated under a schema, compiled before
anything runs, and executed by the harness.

```js
import { createProgramRunner, createProgramAuthor } from '@tangleai/agents/program';
import { createStructuredOutput } from '@tangleai/models/structured';
import { compileJsonQuery } from '@jarenjs/json/query';
import querySchema from '@jarenjs/json/schemas/jaren-query.llm-profile.schema.json' with { type: 'json' };

const runner = createProgramRunner({ environment, client, compileQuery: compileJsonQuery });
const author = createProgramAuthor({
  client, environment, compileQuery: compileJsonQuery, createStructuredOutput, querySchema,
});

const { value: program } = await author.author('Which two records have the closest values?');
const result = await runner.run(program);        // result.answer.text
```

A program is a list of steps, each reading `from` a slot or an earlier step and writing `as`
a name the next step can read:

| step | does | calls a model |
|---|---|---|
| `chunk` | splits a slot into addressable pieces | no |
| `grep` | records which pieces matched a pattern | no |
| `select` | runs a query over a JSON slot | no |
| `stat` / `peek` | shape, sizes, a head excerpt | no |
| `map` | asks one question of **every piece** | **yes** |
| `reduce` | combines a map's results with a query | no |
| `answer` | reads the slot the answer is in | no |

Three properties, each asserted rather than intended:

- **A program that does not compile never runs.** `run()` puts the document through the
  schema and then the compiler, and returns the errors having written nothing and spent no
  model call. The compiler resolves names against what the environment actually holds, so a
  step reading something no earlier step produced is `AI0201` *with a pointer* — the class of
  error small models repair well, and one a schema cannot catch. A query that will not
  compile keeps the **query engine's own** code (`JQ0003`, …) with its pointer rebased onto
  the step it came from.
- **No step can carry content.** Every member of every step is an operation name, a binding,
  a slot reference, a bounded instruction or a query document — `test/agents/program.test.ts`
  walks the grammar and fails if a string member is ever declared without a cap. So the
  program is the same size for a 10 kB corpus and a 10 MB one, which is what keeps the root
  request flat while a program runs.
- **`map` is the only step that calls a model**, so it is the only thing to bound:
  `maxSubcalls` caps how many are made (and a capped map *says* how many pieces it did not
  visit), `maxConcurrentSubcalls` caps how many are in flight, and the run's `AbortSignal`
  reaches every one of them. A sub-call that fails is a **result** — `{ error }` in its own
  slot — and the map completes, because forty pieces of which one was unreadable is a
  finished map with one recorded failure, not a crashed program.

### Fan-out is concurrent, and that is the point

The RLM paper this design follows states its own limitation plainly: its sub-calls are
sequential, and "RLMs without asynchronous LM calls are slow". Running the fan-out in a
harness rather than inside an evaluator is what makes concurrency available at all — the
same program and the same sub-calls, run one at a time and then four at a time, is worth <!--fact:horizon.programFanout-->3.9x (814ms sequential vs 209ms at concurrency 4, 40 sub-calls of 20ms each)<!--/fact-->.
The per-call latency there is synthetic and deliberately so: a benchmark that made eighty
real calls to time its own scheduler would be measuring the provider's queue.

**What it answers, and what the root pays for it.** The pairwise question that compaction
scores 0% on at every budget is answered at a ceiling of <!--fact:horizon.program-->100%, with 40 of 40 records reaching the reduce over 40 sub-calls, while the root request carried 937 characters against a corpus of 17719<!--/fact-->.
By contrast a needle question over the same environment costs **one** sub-call, because
`grep` narrows to the piece that mentions the record before anything is spent on it.

**On the cheap tier** (D8 — the campaign targets the weak model deliberately, and publishes
the result whichever way it falls), the measurement is <!--fact:horizon.programLive-->2 of 3 authored programs compiled — but 1 of those attempts never came back at all (the 300 s deadline), so of the 2 that answered, 2 compiled. Answering 40 sub-calls itself it reached 40 of 40 records (0 sub-call(s) failed) and named the CORRECT pair<!--/fact-->.
Read that second half as the campaign's own result and the first half as a caveat about the
transport, not the tier: the sub-calls are where the model does the work, and it did it.

### Why there is no `$llm` operator

The obvious-looking alternative is to register an async `$llm` operator into the JSLT/query
registry so a stylesheet could call a model inline. **Deliberately not done.**
`@jarenjs/core`'s operators are pure synchronous functions and both evaluators are
synchronous by construction; making them async for this one caller would change an engine
that `@jarenjs/db` pushes down into, `@jarenjs/md` renders directives with and
`@jarenjs/app` derives state from — every one of them would inherit a promise, to save this
package a `map` step.

So the division is fixed, and it is worth stating because it is the first thing a reader
will want to reopen: **the program selects (pure, synchronous, compiled) and the harness
awaits (async, bounded, cancellable).** `map` is the seam between the two halves and it is
the only one. The pairwise question is answered under that rule — the closest pair of forty
records is a `$fold` over `$orderby`-sorted tuples, which is arithmetic the query engine
already does once the model has read each record once.


## Recursion — a job, not a conversation

`createAgent` is a bounded tool loop: you talk to it. `createLongHorizonAgent` is the
other shape — a corpus, a question over all of it, and nobody waiting to answer a
follow-up. It authors a program, runs it, and may let any sub-call be **another agent over
its own slice**.

```js
import { createLongHorizonAgent } from '@tangleai/agents/recursive';

const agent = createLongHorizonAgent({
  client, environment, compileQuery: compileJsonQuery,
  createStructuredOutput, createProgramAuthor, createProgramRunner, createEnvironment,
  depth: 1,                                   // default 1, hard cap 3
  budget: { turns: 40, tokens: 200_000 },     // shared by the WHOLE tree
});

const { answer, trajectory, stopReason, spent } = await agent.run('Which two are closest?');
```

**Depth defaults to 1 and caps at 3.** The research this follows runs depths 0–3 and finds
most of its gain at depth 1, with depth 3 helping only on information-dense tasks — so
deeper is not the default, because it multiplies cost on every task where it does not help.
Ask for more and you get the cap *and are told*: `depthClamped` is true and the trajectory
records it. The benchmark publishes the trade rather than asserting it, as **median and p95**
call cost per depth — never the mean, which is the one summary that would hide the outlier
trajectories a caller has to provision for.

**Budgets are shared by the tree.** Depth × fan-out is multiplicative — depth 3 fanning
twenty ways is eight thousand leaf calls — so one account is threaded through every level,
and a turn is *reserved before* a call rather than charged after it, which is what keeps the
bound exact when four sub-calls launch together. Tokens cannot be known in advance, so a
token budget may overshoot by at most `maxConcurrentSubcalls - 1` calls' worth; that bound
is asserted, not hoped for. When a budget runs out the tree stops with a named `stopReason`
and **leaves its partial work in slots**, which is what makes a stopped run resumable rather
than merely failed.

**A child is isolated, and the isolation is invisible to it.** Each child gets the same
store seen through its own prefix: names go in prefixed and come out stripped, so a child's
corpus is `corpus` and it authors exactly the program it would author at the root. A child
naming a sibling's real address resolves *beneath itself*, so the sibling is unreachable
rather than merely discouraged — no check has to remember to run.

**A child's failure is a value.** A child whose program will not compile returns
`{ error, depth, address }` into its parent's map result slot, and the parent's map
completes. One bad branch is a recorded failure with somewhere to look, not a silent empty
answer — the propagation failure the research names.

### Recursive result contracts

`createLongHorizonAgent` compiles every level in recursive mode, including depth zero.
Inject `analyzeQuery` and `annotateTypes` from `@jarenjs/json/query` alongside
`compileQuery`. Each reduce and the final answer must preserve an item or sequence
of `{slot:string,value:any}` envelopes. The harness unwraps a child's envelope before
its value enters the parent's map; a sequence contributes its elements individually.
Empty query sequences normalize to an empty result.

```js
const query = ['$[*]']; // one array containing every map envelope
```

`compileProgram(doc, {recursive: true, compileQuery, analyzeQuery, annotateTypes})`
refuses incompatible or unknown shapes with `AI0208` and the reduce's document path.
For unknown inference only, a reduce may declare `outputSchema` with required `slot`
and `value` members. The runner validates that declaration before writing its result;
a lying declaration is `AI0209`. Standalone programs may still reduce to arbitrary JSON.
This is a structural guarantee: correctness of the value still needs a host checker.

The recursive author example collects envelopes rather than choosing a maximum.
Map results wrap the parsed leaf reply in `value`; an object, array or null reply
is preserved as such. In recursive mode a failed map entry has `value: null`
alongside its `error` diagnostic (and any `raw`, `depth` or `address` metadata).
The collector keeps these entries; an error is distinguishable from a successful
null reply, and the map's `failed` count still records it. A structurally successful
program may contain only failures or no relevant facts; hosts must check its outcome.
An array constructor collects a query sequence into one
JSON array, including the empty case. An object member needs one value, so a bare
wildcard there fails when several items match. Numeric or string extrema require
an explicit homogeneous scalar projection and are not a general fact reducer.

`createProgramRunner().run()` returns the discriminated `ProgramRunResult` type:
`ok: true` has a `ProgramAnswer`, and `ok: false` has a null answer and an error.
Both retain completed step details, `subcalls`, `failed`, elapsed `ms` and the
configured `concurrency`. A compile refusal has empty steps and zero counts.
`answer.truncated` explicitly reports when the requested
preview is shorter than the stored result. A host that needs the full JSON result
can use `readProgramAnswer(environment, answer, {maxChars: 64000})` from
`@tangleai/agents` or `@tangleai/agents/program`. It checks slot metadata before loading
content, verifies the actual size afterwards, and returns `{ok, answer}` or
`{ok: false, error}`. The environment must be the one that owns the answer's scope.

`createLongHorizonAgent` uses this same reader before unwrapping a child's result.
Its `maxAnswerChars` option defaults to 200,000 characters per child. An oversized
or missing child result becomes a map failure with a diagnostic. The root answer
remains a bounded preview; increasing this child limit does not enlarge it.

### Verified program reuse

`createProgramSession({...authorOptions, reuse})` composes authoring and execution.
Omit `reuse` for fresh authoring. Opt-in policy requires `environmentId`, `schemaVersion`
and `check({question,result,reused})`, returning a boolean or validation outcome. The
host must change the environment identity when its corpus, tools or semantics change.
Optional `tools` names are compared exactly; `embedder` embeds the question for storage.
Ledger recall keeps its existing embedder identity checks.

Candidates above `threshold` are compiled and gated against current slot names.
An identical question fingerprint may proceed; a paraphrase additionally
requires `accept({question,skill,score}) === true` from the host. Similarity alone grants
no execution authority. Successful checked programs become validated skill records.
A rejected or wrong reuse records separate failure evidence and falls back to fresh
once. A failed fresh outcome ends the request. Returned `reuse.events` explains each
choice. For long-horizon jobs, the same policy applies at the root.

Fixture scorecard: <!--fact:program.reuse-->25/25 fixture answers correct; 5 author calls and 1125 token proxy with reuse, versus 25 calls and 5000 tokens fresh. Selected threshold 0.9 with 32 hash dimensions, host suitability proof and an outcome checker.<!--/fact-->

The live stream uses the same fixture-family checker and reports real provider token
usage; retrieval uses the local hash embedder and has no provider token charge.

<!--fact:program.reuseLive-->

| profile | mode | correct | author calls | reported tokens | reused answers |
|---------|------|---------|--------------|-----------------|----------------|
| primary | fresh | 0/4 | 4 | 10073 | 0 |
| primary | reuse | 0/4 | 4 | 3934 | 0 |
| secondary | fresh | 4/4 | 4 | 3183 | 0 |
| secondary | reuse | 4/4 | 2 | 1544 | 2 |

<!--/fact-->

The fixture threshold is not calibrated for other embedders or real question streams.
`benchmark/programmind-reuse.json` retains every threshold, wrong execution and fallback.

### Derived authoring profiles and host routes

Query, JSLT, app, FSM, DAG, statechart and composed workflow have generated
`*.authoring.schema.json` artifacts. `grammar: 'statechart'` uses
`compileStatechart`; `grammar: 'workflow'` uses `compileWorkflow` with the host's
versioned task registry. Their schemas live in `packages/flow/schemas/`;
workflow validation registers the DAG, query and JSLT grammars too.
`createGrammarAuthor({client, grammar, profile, schema, refs, compile})` always validates
against the full schema after profile decoding and then invokes the injected compiler.
Profiles intentionally allow values that the full grammar rejects. `docs:check` checks
source, named seam, profile hashes and generated output for drift.

<!--fact:program.profiles-->

| grammar | full closure bytes | profile bytes | full branches | profile branches |
|---------|--------------------|---------------|---------------|------------------|
| model | 8972 | 8903 | 7 | 7 |
| query | 20709 | 3564 | 47 | 10 |
| jslt | 23515 | 3491 | 59 | 6 |
| app | 47275 | 2799 | 106 | 0 |
| fsm | 24140 | 3026 | 51 | 4 |
| dag | 49558 | 5128 | 112 | 6 |
| statechart | 23058 | 2634 | 49 | 2 |
| workflow | 52878 | 3685 | 121 | 9 |

<!--/fact-->

Authors and program subcalls accept `selectModel({purpose,grammar,depth,limits})`.
Return `{client,identity}` or an ordered list for transport/timeout fallback. The default
uses the supplied client. Purposes are `author`, `subcall`, and `stylesheet`; embedding
routing is deliberately refused by the chat wrapper to protect embedding identity.
`limits` accepts `deadlineMs`, `outputTokens`, and `reasoningTokens`. Provider-reported
overruns are charged and refused; a remote provider can exceed a requested token limit
before the client learns its usage. Each fallback consumes the shared turn budget.
`onRoute` reports identity, outcome, usage and elapsed time. Tool-bearing requests cannot
use this retry path. The website retains its existing host selection because live evidence
does not establish a better default.

### Information-dense depth frontier

The original hierarchical corpus combines accepted leaf revisions into section and
regional totals, with rejected revisions as distractors. All depths receive identical
source and questions and use the same answer/evidence checker. Scripted extraction proves
traversal and accounting; it does not measure intelligence.

<!--fact:program.depth-->

| depth | correct fixture tasks | author calls | subcalls | token proxy |
|-------|-----------------------|--------------|----------|-------------|
| 0 | 1/1 | 1 | 2 | 150 |
| 1 | 1/1 | 3 | 5 | 400 |
| 2 | 1/1 | 8 | 14 | 1100 |
| 3 | 1/1 | 22 | 29 | 2550 |

<!--/fact-->

Live depth results: <!--fact:program.depthLive-->0/8 live depth tasks correct; 2 timed-out calls and 6 provider token-ceiling violations. No deeper default is justified.<!--/fact-->

Depth remains one by default, capped at three. A deeper default requires a live correctness
gain at the cost bound declared in `benchmark/programmind-depth-fixture.json`.

### What the cheap tier actually managed

Published because it is the campaign's own bet (D8) and because half of it lost. On the
qwen tier, the **program** path works: it authored plans that compile, answered all forty
sub-calls itself, and named the right pair — the number is in §"The action language" above.

The **recursive** path did not. Measured at depths 1 and 2, it managed <!--fact:horizon.depthLive-->0 of 4 tasks at depths 1 and 2 — every one of them died on the 300-second deadline during its first authoring call, so what this measured is that the recursive path does not currently RUN on this tier, not that it runs badly<!--/fact-->.

Read that precisely, because the distinction matters: this is not "recursion answers badly
on a small model". It is "recursion did not get far enough to be scored". The authoring call
at each level carries the digest, the question, a worked example and the program schema, and
on this tier that request exceeds a 300-second deadline — **even streamed**, which rules out
the non-streaming hang this repo measured elsewhere. Every level needs one such call, so the
chance of at least one timeout compounds with depth, which is exactly the shape observed:
the single-level program path lost 1 attempt in 3, the recursive path lost 4 in 4.

The model-free depth numbers in the benchmark are therefore the honest ones for now — they
say what recursion *costs* (1.5× and 2.0× the calls for the same answer on these tasks) and
say nothing about what it is worth on a task where depth should pay. The new hierarchical scorecards above retain the open provider-quality limitation.

### What is not guarded

Guardrails for recursive LM systems are under-explored, and this package does not pretend
otherwise. The depth cap, shared budget and abort signal bound execution; optional route limits also bound individual calls. There is no detection of a child that answers confidently and
wrongly, no loop detection beyond depth, and no per-branch quality gate. A thinking model
needs output room for the authoring call, and the finding in §"Thinking can be turned off"
above is *sharper* here, not exempt: recursion is the extreme case of a tool loop, so
turning thinking off wrecks it.

### Heartbeats are the host's

There is no scheduler here, deliberately. Re-entering a session on a timer is a *host*
concern — a browser page, a service worker, a cron — and this package injects its
environment rather than owning it. The ledger plus `agent.resume()` is the primitive: the
goal, the progress and the memories reload from storage and the run continues. What decides
*when* that happens is yours, and keeping it out is what lets the same agent run in a static
page with no store at all.
