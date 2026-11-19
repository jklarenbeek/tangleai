/**
 * Storing and recalling by meaning, end to end and offline: embed notes with
 * the deterministic reference embedder, store them beside a vector index, ask
 * for the k nearest through a query document, then recall the same notes from
 * a ledger. `test/context/howto-vector.test.ts` runs this file and checks
 * every `// →` value below against what the run answered.
 */
import { openStore } from '@jarenjs/db';
import { nodeDriver } from '@jarenjs/db/node';
import { createHashEmbedder } from '@tangleai/models';
import { createLedger, createMemoryStorage } from '@tangleai/context';

export async function runVectorRecallExample() {
  const embedder = createHashEmbedder({ dims: 64 });
  const notes = [
    { id: 'n1', topic: 'deploys', text: 'the deploy verifies itself by polling the published build' },
    { id: 'n2', topic: 'deploys', text: 'a service worker cache name must be bumped with the assets' },
    { id: 'n3', topic: 'schemas', text: 'a wrong-width vector is refused at the write, never padded' },
  ];
  const vectors = await embedder.embed(notes.map((n) => n.text));

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
            // constrained to the width: a wrong-width write is a validation
            // error, not a row that silently cannot be ranked
            embedding: { type: 'array', items: { type: 'number' }, minItems: 64, maxItems: 64 },
          },
        },
        key: '/id',
        indexes: [{ name: 'by_vec', path: '$.embedding', derive: 'vector', dims: 64 }],
      },
    },
  } as any, { driver: nodeDriver() });
  const collection: any = store.collection('notes');
  // a stored vector is a plain array: a Float32Array would round-trip through
  // JSON as an object and leave the index column NULL
  for (const [i, note] of notes.entries()) await collection.put({ ...note, embedding: Array.from(vectors[i]) });

  const [probe] = await embedder.embed(['how does the deploy check what it published?']);
  const nearest = {
    $subsequence: [{
      $for: { n: '$[*]' },
      $where: { $eq: ['$n.topic', 'deploys'] },
      $orderby: [{ $key: { $similarity: ['$n.embedding', '$q'] }, $dir: 'desc', $empty: 'least' }, '$n.id'],
      $return: '$n.id',
    }, 0, 2],
  };
  const externals = { q: Array.from(probe) };
  const ranked = await collection.execute(nearest, { externals });            // → [ 'n1', 'n2' ]
  const mode = (await collection.explain(nearest, { externals })).mode;       // → 'knn'
  await store.close();

  const ledger = createLedger({ storage: createMemoryStorage(), embedder });
  for (const note of notes) await ledger.addMemory({ text: note.text, evidence: note.id, tags: [note.topic] });
  // writing never embeds (a write must not acquire a network dependency);
  // this is the explicit sweep, and a second run embeds zero
  const swept = await ledger.embedMissing();                                   // → { embedded: 3, remaining: 0 }
  const recalled = await ledger.recall({ near: 'how does the deploy check what it published?', limit: 2 });
  // recalled.memories' evidence                                                → [ 'n1', 'n2' ]
  // recalled.scores, 3 decimals                                                → [ '0.712', '0.441' ]
  // recalled.skipped, none was un-embedded                                     → 0
  return { ranked, mode, swept, recalled };
}
