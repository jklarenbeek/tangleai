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

Static fetching supports a per-hop `admission(url, hop)` policy. It runs after
public-address validation and before robots on every initial/redirect URL;
auxiliary robots destinations are admitted too. A refusal produces
`DocumentError('policy-denied')` with the URL, hop, reason and redirect chain.
Existing terms policy remains independently enforced. Successful results retain
the redirect chain. Protected IPv4 addresses encoded as IPv6 mappings are
classified before transport, including expanded and hexadecimal spellings.

A host can narrow an individual request with the fourth argument
`{ maxBytes, respectRobots }`. Machine search API requests may explicitly skip
robots; ordinary page requests retain the configured robots behavior.
`onBytesRead` counts every delivered body chunk, including auxiliary robots
and a final chunk exceeding the allowance, so a caller can share a byte budget.
The callback can terminate a read; that budget error never becomes a fail-open
robots outcome. Browser callers inject public-address lookup; Node's default
resolver is loaded only when needed.

HTML extraction exposes uninterpreted structured date metadata in `metadata`.
Conflicting values are omitted with a warning. Consumers validate date semantics
and provenance; the extractor does not substitute HTTP timestamps or infer dates
from prose. Existing title, elements and canonical-link behavior is unchanged.

The `./extract-static` subpath owns shared HTML/text extraction and its limits
without importing the PDF dependency. The existing `./extract` entry consumes
that same implementation and adds PDF extraction. Browser web retrieval uses
the static subpath; installed Node and Bun retain the complete extractor.
