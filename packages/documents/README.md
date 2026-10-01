# @tangleai/documents

Safe, versioned document ingestion and retrieval for TangleAI

Install with `npm install @tangleai/documents`. The npm distribution provides ESM JavaScript, TypeScript declarations, and the documented package subpaths for Node 24 and Bun 1.4 or newer.

See the [Tangle documentation](https://github.com/jklarenbeek/tangleai#readme) for architecture, examples, and runtime requirements. All public Tangle packages use one coordinated version.

`createDocumentIngester` supports opt-in `strategy: 'parent-child'` with explicit
`parentTokens` and child `maxTokens`/`overlapTokens`. Effective values participate
in version identity. Parents are contiguous retained context; only children are
embedded. Each child names its true `parentChunkId`, and overlap-carried element
ids are separate from its own element ids. Re-ingesting unchanged content with
the same effective configuration skips embeddings.

`DocumentCorpusStore.listParents` resolves parents by version. Activation keeps
superseded chunks, elements and parents; recall only ranks active versions.
`rankDocumentChunks` is the shared pure semantic ranker and reports incompatible
embedding identities as skips. Parent/child recall expands to its parent without
cross-parent neighbours. Legacy `parentId` retains its heading-element meaning:
new ingestion selects the preceding matching heading, and expansion picks the
earliest chunk carrying that heading. Existing flat defaults remain unchanged.
