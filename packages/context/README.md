# @tangleai/context

Evidence-backed ledgers, bounded environments, recall, retention and storage contracts.

This package keeps its JS/JSDoc implementation and deterministic tests. Inject
fetch, storage and compiler services at the existing seams. The public source
exports and emitted npm JavaScript share one implementation.

## Public entries

- `@tangleai/context`
- `@tangleai/context/recall`
- `@tangleai/context/ledger`
- `@tangleai/context/environment`
- `@tangleai/context/storage/memory`
- `@tangleai/context/storage/slot`
- `@tangleai/context/schemas/ledger`
- `@tangleai/context/schemas/patch`
- `@tangleai/context/evidence`
- `@tangleai/context/retention`
- `@tangleai/context/schemas/evidence`
- `@tangleai/context/archive`
- `@tangleai/context/package.json`

See [ownership and verification](../../docs/JAREN_AI_MIGRATION.md) for source
provenance, installation mode, unchanged serialized identities and qualification.

## A goal that outlives the tab

```js
const ledger = createLedger({ storage });                    // durable storage is yours
await ledger.setGoal({ objective: 'Reconcile July against the bank export.' });

const agent = createAgent({
  client, toolbox, ledger,
  budget: { turns: 40, tokens: 250_000, ms: 15 * 60_000 },   // hard stops, not warnings
  retrieval: { memories: { tags: ['reconcile'], limit: 5 }, skills: {} },
});
await agent.resume();                                        // no new instruction needed
```

The active objective and everything recorded against it are composed into the **system
prompt of every request** — unconditionally, because it is the thing being worked on.
Memories and skills are *retrieved* (`retrieval`, using the ledger's own query shape) and
are absent unless you ask for them. Progress is appended with evidence
(`{ at, note, evidence }`; bounded goals also mint a stable `id`), which is what stops a resumed session redoing finished work: a
new agent built over the same storage reads what has already been tried rather than being
told.

Composition happens **in the request, never in the transcript**. `send` still returns the
full, uncomposed history, so the transcript you persist and hand back next turn carries the
immutable base prompt and the conversation — not yesterday's rendering of the goal. A goal
ends by being completed, paused or cleared (`setGoalStatus`); it never ends by being
forgotten, and there is no timeout that silently drops it.

**Budgets are refusals.** `turns` (one turn = one model call), `tokens` and `ms` each stop
the run with a named `stopReason` — `budget-turns`, `budget-tokens`, `budget-ms` — and a
message naming what remains, the same posture as `maxToolRounds`. They bound the *run*, not
the turn: the counters live on the agent, `spend()` reads them back and `budget.spent` seeds
them, so a budget survives a reload. Token accounting uses the provider's reported `usage`
and falls back to deterministic character accounting (4 chars ≈ 1 token) when a provider
reports none — stated here because a budget that silently did not apply on the runtimes
that report no usage would be worse than no budget.

### Atomic storage and reported lifecycle limits

The optional storage capability is
`mutate(scope, current => ({ next, result }))`. A scope is a key prefix string or
`{ prefixes: [...], keys: [...] }`. The callback is synchronous, receives a detached
JSON record map, and either returns a replacement map under that scope or omits
`next` for a read-only decision. Exceptions publish nothing; keys cannot escape
the scope. Every adapter write must participate in the same serialization.
The memory adapter executes without yielding; the DB recipe uses one immediate
transaction with synchronous scoped collection operations. Ledger work stages in
an isolated map, then compares and atomically publishes it. Contention retries
against current records; embedding batches are reused during retries. Exact-key
scopes keep ordinary slot writes independent of corpus size. Record counters
survive deletion and rollback so minted memory/skill addresses are never reused.

```js
const ledger = createLedger({
  storage,
  archiveLimits: { maxItems: 24, maxBytes: 262144 },
  goalLimits: { maxEntries: 8, maxChars: 8192, maxBytes: 16384 },
});
const report = await ledger.retentionReport();
const composed = await ledger.composeGoal(); // { text } or a visible refusal
```

Limits are optional, nonnegative safe integers; unknown limit names are errors.
Automatic retention requires atomic storage. Archive `maxItems` counts live
round and index slots. `maxBytes` measures the serialized archive sub-map in
UTF-8, including slot metadata, content, durable tombstones and the latest report.
Oldest unreferenced slots are evicted deterministically by timestamp and name.
Pinned slots, newly archived batches, addresses in retained transcript context,
and memory/goal references are protected. Free-text references are protected
conservatively by address occurrence. `putArchive` commits rounds, their index,
evictions and reports together. An impossible budget refuses without changing
storage or discarding the current transcript.

Compaction uses `putArchive(entries, { immutable: true })` to reject conflicting
content at an existing address, including conflicts within a batch or between
concurrent writers. Host-named archives remain replaceable when this option is absent.

`readSlot(name)` returns text, `undefined` for an absent address, or a typed
`{ status: 'evicted', name, bytes, reason }` tombstone. Recall and environment
reads preserve that distinction. Reports and tombstones are durable; they also
consume the byte budget, so an indefinitely growing audit trail eventually needs
host action. `clearArchives()` intentionally removes conversation rounds,
indexes, tombstones and the archive report. Memories, goals and snapshots remain.

Goal limits apply to the active goal: raw entry count, serialized goal bytes and
complete prompt characters. A deterministic lossless checkpoint stores unique
note/evidence pairs plus every source entry id and timestamp. Only after exact
coverage validates does the atomic commit replace raw entries. `checkpointReducer`
may supply a synchronous host/model-authored checkpoint; invented, missing,
duplicated or changed source evidence is rejected. This is exact evidence
preservation, not semantic summarization. `composeGoal()` includes the objective,
checkpoint and uncovered entries without excerpting; `createAgent` refuses an
over-budget goal before requesting a model. Increasing limits or superseding the
goal is explicit host action. Distinct evidence cannot be compressed indefinitely.
Archived goals, durable snapshots and ordinary corpus slots are separate classes;
these limits do not claim to cap an entire host's storage usage.

Measured tradeoffs: <!--fact:ledger.retention-->On 48 seeded rounds, an eight-round oldest policy retains 16.7% of referenced addresses; protected eviction retains 100.0%, while retaining only 4.8% of unreferenced addresses. A lossless checkpoint reduces goal context from 14,841 to 4,216 characters. Impossible protected budgets are refused.<!--/fact-->

The [retention instrument](https://github.com/jklarenbeek/jarenjs/blob/main/benchmark/README.md#ledger-retention) reports all
address loss, exact serialized bytes, restart correctness, retrieval and refused
writes. Its seeded corpus is a reproducible policy test, not a universal quota or
real-world language-quality claim. `ledgerFootprint(records)` accounts every
serialized adapter byte by class, with braces reported as overhead.

### Generic guarded documents and referential evidence

`createGuardedRefiner({ read, validateProposal, apply, validateCandidate,
planCommit, commit, snapshot?, restore? })` owns validation, copy/apply, candidate
validation, planning and commit. `prepare(document, proposal)` is synchronous and
returns pointered errors or a candidate/plan; `commit(proposal)` serializes the
whole flow. The injected committer supplies atomic persistence. Snapshot/restore
are paired fallback hooks; failed restoration is attempted once and retains both
causes. No ledger paths or universal document schema exist in this engine.
`createRefiner` and `createClaimRefiner` are its two production consumers.

Memory evidence accepts legacy nonempty strings unchanged, or a versioned
`CLAIM_EVIDENCE_SCHEMA` envelope:

```json
{
  "version": 1,
  "artifacts": [{ "id": "source", "kind": "slot", "locator": "round-1" }],
  "evidence": [{ "id": "citation", "artifact": "source", "quote": "42 rows" }],
  "visibleEvidence": ["citation"],
  "claims": [{ "id": "count", "text": "There are 42 rows", "critical": true,
    "status": "supported", "evidence": ["citation"] }]
}
```

`validateClaimEvidence(envelope, { artifacts? })` checks shape, unique ids within
each record class, artifact/evidence resolution, visible evidence membership and
unresolved critical claims. An optional external artifact list checks admission
and descriptor identity; `createClaimRefiner` requires that list. `createLedger({ artifacts })` applies the same immutable host admission list
to memory writes and refinement. When that option is omitted, ledger memories
validate self-contained envelopes. The validator never fetches locators, judges
source authority or decides prose entailment. Host admission establishes which
artifacts may be named; it does not establish the truth of a claim. Existing
stored string evidence needs no migration; typed consumers narrow the evidence
union. Envelope and checkpoint versions reject unknown versions.

### Refinement — the only way durable state changes

```js
import { createRefiner } from '@tangleai/agents/refine';
import { applyJSONPatch } from '@jarenjs/json';

const refiner = createRefiner({
  client, ledger,
  applyPatch: (doc, patch) => applyJSONPatch(doc, patch),   // injected, never imported
});
const result = await agent.send(history);
await refiner.refine(result);        // proposes, gates, commits — or declines
```

The model is asked what it learned, and answers with an **RFC 6902 JSON Patch** over the
supplemental state, generated through `createStructuredOutput`. Four stages, in order:
the constrained schema (three verbs, a `path` *pattern*, a cap on operations); application
to a **copy** through the injected patch engine; validation of every resulting record
against the ledger's own schemas; then a snapshot and the commit. A failure at any stage
returns coded, pointered errors for one bounded repair and then declines — nothing is
half-applied, and `rollback(result.snapshot)` restores byte-identical state after one that
succeeded.

Two properties are asserted rather than documented:

- **The base system prompt is not a patch target.** It is not in the document a patch
  applies to, and no path that could reach it matches the schema's pattern. There is no
  operation a model can write that edits its own instructions.
- **Every stored memory carries `evidence`**, because the ledger rejects one that does not.
  That is the mechanism by which "evidence-backed" is enforced rather than hoped for, and
  it is why a refinement cannot launder a hallucination into durable state.

A revised memory is stored as a new record, not an edit: a different claim, with different
evidence, at a different time. The empty patch is a legal answer, and the schema does not
demand an operation — asking a model that learned nothing to produce something is exactly
how an invented memory gets in.

`createRefiner({ ..., deduplicate: 'exact-evidence' })` optionally skips new
memories whose text and evidence match byte for byte and whose tags match as a
multiset. It preserves case, whitespace, independent citations, complementary
details and conflicts; it does not merge or delete existing records. Every
proposal still passes validation. A retained record must survive the same patch;
one scheduled for removal cannot suppress its replacement.

Results include `deduplicated`, with each skipped proposal's `path`, its
`retainedPath` in the proposed document, and `retainedId` when the witness was
already stored. A repeated batch that changes nothing creates no snapshot and
preserves timestamps. Calls on one refiner serialize through generation and
commit. On atomic storage, a refinement publishes its snapshot and every write
in one mutation; a changed supplemental document is refused before any patch
index can name a different record. Four-method adapters require host coordination
between refiners. Their commit failures restore once; a failed restore reports
both causes and the recovery snapshot. Explicit rollback is a host-authorized
restore of recorded state and can intentionally remove later writes.

Refinement result: <!--fact:recall.dedup-->After 12 labelled waves, opt-in exact-evidence suppression stores 21 records instead of 78; state bytes fall 73.1%. Evidence recall@10 is 1.000 versus 0.667, with all labelled conflict and complement units retained. Proposals are scripted; vectors are baai/bge-m3.<!--/fact-->

The option remains off by default. The [full policy comparison](https://github.com/jklarenbeek/jarenjs/blob/main/benchmark/README.md#labelled-recall-and-repeated-refinement)
includes the rejected normalization, similarity and merge controls, and clearly
separates scripted proposals from live embeddings.

The patch schema discriminates `oneOf` branches by operation and JSON Pointer
path. Memory, skill and progress values cannot be exchanged; progress is append
only, remove carries no value, and replace/remove require a canonical numeric
index. Provider decoding uses the full schema with `strict: false`. Any custom
validator is an additional check and cannot weaken local full-schema validation.

Provider comparison: <!--fact:ledger.decoding-->openrouter, google/gemini-3.7-flash: oneOf valid; if-then rejected-full-schema (2 calls, $0.00567000 reported cost). One trial per syntax is provider acceptance evidence, not proof of grammar enforcement. Two excluded preparatory calls cost $0.00293850 and remain recorded.<!--/fact-->

### What the cheap tier does with it (measured)

Refinement is open-ended authoring, which the field notes above say weak models do badly —
so it was measured on the qwen tier rather than assumed, on a four-step incident-diagnosis
run with facts planted in the tool results (`REC0007`, `pg-bouncer`, `v4.19.2`), so that
grounding and invention are both checkable without a judge.

These figures are **dated, not regenerated** — measured 2026-08-12 by a live probe that
needs a key and fifteen model calls, so it is not part of the committed benchmark suite and
not driven by the figure gate the numbers above it are. Read them as a record of one run on
one day, and re-run the probe rather than trusting the table if it matters.

| model | trials | accepted | first attempt | records | grounded | fabricated ids | median |
|---|---|---|---|---|---|---|---|
| `qwen/qwen3.6-35b-a3b` (non-streamed, the shipped path) | 5 | 5 | 5 | 16 | 16/16 | 0 | 69 s |
| `qwen/qwen3.6-35b-a3b` (streamed) | 5 | 5 | 5 | 16 | 16/16 | 0 | 56 s |
| `qwen/qwen3.6-27b` (streamed) | 5 | 5 | 5 | 15 | 15/15 | 0 | 10 s |

**Refinement does not need a stronger model** — with one caveat that is the whole finding.
Before the prompt carried a per-path shape table and one worked example, *every* trial
failed its first attempt and needed the repair round, always the same way: a progress entry
written in a memory's shape (`text` where the goal wants `note`). The schema cannot rule
that out — one `value` union serves three paths — so it is the prompt's job. Six of six
first attempts failed without it; twenty-four of twenty-four passed with it. That is this
package's own field note ("a few-shot example fixes *shape*") applied to its own harness,
and it is the difference between refinement costing one call and costing two.

Nothing else needed a stronger model: 47 of 47 records across every tier cited something
that was actually in the run, and no trial invented an identifier. The scoring is
deliberately narrow — it checks that a claim quotes the run and that no `REC…`/`v…`/region
token appears that the run never contained — so read it as "does not fabricate the things
we can check", not as a quality score.

One incidental result, recorded because the long-horizon benchmark found the opposite:
`createStructuredOutput` sends `stream: false`, and non-streaming did **not** hang here on
the same provider. It was slower on the thinking model (69 s against 56 s median) and
identical in outcome. The smaller `27b` answered in a tenth of that, from a fifth of the
completion tokens — a thinking model spends most of a refinement thinking.


## The environment — a corpus you work on, not one you read

Everything above makes a long context *fit*. The environment asks the other question:
why is the corpus in the request at all?

```js
import { createEnvironment } from '@tangleai/context/environment';
import { compileJsonQuery } from '@jarenjs/json/query';

const environment = createEnvironment({ ledger, compileQuery: compileJsonQuery });
await environment.put('report', await file.text());          // 10 MB is fine
await environment.chunk('report', { strategy: 'line', size: 4000 });

const agent = createAgent({ client, toolbox, environment });  // env_* tools registered
```

Content lives in named slots. The model sees a **digest** — name, kind, size, count, one
line of excerpt — and works by naming slots in operations:

| operation | answers with | never |
|---|---|---|
| `digest()` | every slot's metadata, capped, plus how many it did not list | content |
| `peek(name)` | metadata and the first characters | the slot |
| `chunk(name, …)` | addresses of the pieces, capped, plus how many more | the pieces |
| `grep(pattern, …)` | which slot matched, a window **around the hit**, and its offset | the slot |
| `select(name, query)` | the address of a new slot holding the result | the rows |
| `stat(name)` | counts, sizes, kinds — for one slot or a whole family | anything read |
| `read(name, { chars })` | exactly that many characters | more than asked |

**No operation returns bulk content.** Every result is capped by construction, so it is the
same size whether the slot holds 10 kB or 10 MB — that is asserted, not intended. `read` is
the single exception and it makes the caller state a budget, because a design where reading
is as easy as peeking is a design that ends up back in the transcript.

**The root view does not grow with the corpus.** Sweeping a corpus across three orders of
magnitude (10 kB → 10 MB, `test/context/environment-scale.test.js`), the root request stays
inside a 3 000-character band and moves by *tens* of characters between decades — the extra
digits in a chunk's index, and nothing else. The digest lists at most twelve slots and
reports how many it did not list; a cap that hid the difference would let a model conclude
a four-hundred-slot corpus is twelve slots long. The same sweep runs against an
asynchronous, out-of-process stub adapter, because a property that only held for the
in-memory default would be a property of the test.

Addresses are derived, never stored: a chunk is `parent#strategy:size/index`, so chunking
the same slot twice writes the same slots instead of a second copy. Shorter or empty
`ingest` and `chunk` replacements remove old indexed suffixes. Cached selections keep
their original result address. Environment caps must be finite safe integers; negative
slice bounds cannot expand a preview. `select` needs the
`compileQuery` seam and declines with a stated reason without it — naming `grep` as the way
around it — while every other operation is unaffected.

### The transcript is just another slot

```js
const agent = createAgent({ client, toolbox, environment, transcript: { window: 2 } });
```

The growing conversation is a long prompt too. With `transcript`, it is written whole to a
slot before every call and the request keeps a window of it plus the address of the rest —
so the request stops growing with the conversation, and an earlier round is reached the way
anything else is: `env_grep` for it, `env_read` at the offset it reports. Over forty
gathering rounds the request stays under 3 000 characters, and a value that a
6 000-character `historyBudget` run no longer carries comes back from a 600-character read
(`test/agents/transcript-slot.test.js`).

This is the alternative to `historyBudget` rather than a tuning of it: there is no budget to
exceed when the history is addressed instead of resent. `historyBudget` keeps working
exactly as it did — an agent with no `environment` is byte-identical to one built before
this existed — and which to reach for is the choice, not a migration.


## A durable ledger over @jarenjs/db

This injected adapter stores the complete ledger contract in one collection.

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
 * imports nothing from `@tangleai/context` — the storage contract is the
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
