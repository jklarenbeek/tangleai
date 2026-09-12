# Vectors and recall

Received Jaren example; generic storage/query remain Jaren-owned and model/ledger mechanisms are Tangle-owned.

## Storing and Recalling by Meaning

An embedding is an array of numbers, so nothing in this suite needs a new
type to hold one. What it needs is four things in a row: something that
turns text into vectors, somewhere to keep them beside the documents they
belong to, a way to ask for the *k* most similar, and — for an agent's
ledger — a recall that ranks by meaning instead of by tag.

The whole pipeline below runs as written, with no network and no model
download, because `createHashEmbedder` is a deterministic reference
embedder that ships with the package. **It is demo-grade and lexical**: it
hashes character trigrams, so it matches words rather than meaning. Swap
it for `createEmbeddingClient` (an OpenAI-compatible `/embeddings`
provider) or any object with the same three members and every line after
it is unchanged — that seam is the point.

### Text to vectors

```javascript
import { createHashEmbedder } from '@tangleai/models';

const embedder = createHashEmbedder({ dims: 64 });

const notes = [
  { id: 'n1', topic: 'deploys', text: 'the deploy verifies itself by polling the published build' },
  { id: 'n2', topic: 'deploys', text: 'a service worker cache name must be bumped with the assets' },
  { id: 'n3', topic: 'schemas', text: 'a wrong-width vector is refused at the write, never padded' },
];

const vectors = await embedder.embed(notes.map((n) => n.text));
```

`embed` answers one `Float32Array` per input, in the order the inputs
were given — a wire client reassembles the provider's reply by its
`index` member and refuses the batch unless exactly one finite vector of
the expected width arrived per text, because an embedding attached to the
wrong text is worse than an error.

### Vectors beside their documents

A collection declares which member is the embedding and how wide it is.
The store then keeps that member l2-normalized and packed as
little-endian binary32 in one column beside the document — stored on
every driver, with no B-tree over it and no registered function, so a
plain `SELECT` or a backup can read the table:

```javascript
import { openStore } from '@jarenjs/db';
import { nodeDriver } from '@jarenjs/db/node';

const store = await openStore({
  $model: '0.1',
  collections: {
    notes: {
      schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          topic: { type: 'string' },
          text: { type: 'string' },
          // typed `array` and nothing else, and constrained to the width:
          // a wrong-width write is then a validation error rather than a
          // row that silently cannot be ranked
          embedding: { type: 'array', items: { type: 'number' }, minItems: 64, maxItems: 64 },
        },
      },
      key: '/id',
      indexes: [{ name: 'by_vec', path: '$.embedding', derive: 'vector', dims: 64 }],
    },
  },
}, { driver: nodeDriver() });

const collection = store.collection('notes');
for (const [i, note] of notes.entries()) {
  // a stored vector is a plain array of numbers — the JSON round trip is
  // the source of truth, so a `Float32Array` member would be held as an
  // object and the column would be NULL
  await collection.put({ ...note, embedding: Array.from(vectors[i]) });
}
```

### The k most similar

There is no `knn` keyword. "The k most similar" is the query language's
own ordering and window: `$orderby` on a `$similarity` key, descending,
inside a `$subsequence`. Because it is an ordinary query document, the
`$where` beside it narrows first and the second `$orderby` key breaks
ties, exactly as they would anywhere else:

```javascript
const [probe] = await embedder.embed(['how does the deploy check what it published?']);

const nearest = {
  $subsequence: [{
    $for: { n: '$[*]' },
    $where: { $eq: ['$n.topic', 'deploys'] },
    $orderby: [{ $key: { $similarity: ['$n.embedding', '$q'] }, $dir: 'desc', $empty: 'least' },
      '$n.id'],
    $return: '$n.id',
  }, 0, 2],
};

const externals = { q: Array.from(probe) };
const ranked = await collection.execute(nearest, { externals });
// → [ 'n1', 'n2' ]

const mode = (await collection.explain(nearest, { externals })).mode;
// → 'knn' — the column cut the candidates and the engine ordered them

await store.close();
```

`mode: 'knn'` is worth asserting in your own tests. A probe of the wrong
width, or one that is not an array of numbers, **diverts** to the
whole-collection residual with the reason in `explain()` — the answers
stay right and the cost does not, and the only thing that tells you is
the mode.

### Recall by meaning, in a ledger

`@tangleai/context`'s ledger recalls by tag and recency by default. Give it the
same embedder and `recall({ near })` ranks by cosine similarity instead —
refusing when there is no embedder, refusing when the stored vectors were
made by a different model, and *reporting* the records it had to skip
rather than scoring them as zero:

```javascript
import { createLedger, createMemoryStorage } from '@tangleai/context';

const ledger = createLedger({ storage: createMemoryStorage(), embedder });
for (const note of notes) {
  await ledger.addMemory({ text: note.text, evidence: note.id, tags: [note.topic] });
}

// writing does not embed: a write must not silently acquire a network
// dependency. This is the explicit sweep, and a second run embeds zero
const swept = await ledger.embedMissing();         // → { embedded: 3, remaining: 0 }

const recalled = await ledger.recall({
  near: 'how does the deploy check what it published?', limit: 2,
});
recalled.memories.map((m) => m.evidence);          // → [ 'n1', 'n2' ]
recalled.scores.map((s) => s.toFixed(3));          // → [ '0.712', '0.441' ]
recalled.skipped;                                  // → 0 — none was un-embedded
```

Read the scores, not just the order: `n1` shares *deploy* and
*published* with the question and lands at 0.712; `n2` is the other
deploy note but shares almost no letters with it, so it places second at
0.441 — a gap the reference embedder earns by matching *words*, not by
knowing what a deploy is. That is what a mechanism score looks like — the
sweep, the identity check and the ranking all worked. Whether the *right*
memory comes back is the embedding model's job, which is why this suite
ships a seam and a benchmark rather than an opinion about models.

---

---
