# @tangleai/memory

Evidenced memory storage, ingest policies, retrieval and outcome learning over an injected store.

Install with `npm install @tangleai/memory`. The distribution provides ESM JavaScript, TypeScript declarations and public subpaths for Node 24 and Bun 1.4 or newer.

The selected default disables novelty filtering, contradiction resolution and crystallization (each lowers to threshold 2). Memory retrieval uses k = 10 and minScore = 0. The pipeline's offline embedder is `hash-trigram-512`; its width was selected by lexical evidence recall independently of the live answer experiment. Explicit thresholds and retrieval overrides retain their meaning. Existing vectors keep their model/dimension identity and must be re-embedded before they can rank against a different embedder.

```ts
import {
  DEFAULT_MEMORY_POLICY, POLICY_PROVENANCE, policyThresholds,
  MEASURED_MEMORY_POLICIES, SHIPPED_LEGACY_POLICY, SHIPPED_LEGACY_CELL_ID,
} from '@tangleai/memory/policy';

const thresholds = policyThresholds(); // selected default: all three thresholds are 2
console.log(DEFAULT_MEMORY_POLICY.retrieval); // { k: 10, minScore: 0 }
console.log(POLICY_PROVENANCE.reportId); // exact source report for the decision
```

`MEASURED_MEMORY_POLICIES[cellId]` contains measured alternatives with their original effective values and labels. `SHIPPED_LEGACY_POLICY` aliases the historical shipped cell (novelty 0.97, contradiction 0.8, crystallization 0.9, maxPairs 20, k 10, minScore 0, hash width 64). This is opt-in data, not a recommended provider profile. To reproduce its pipeline settings:

```ts
import { createMemoryUnitStore } from '@tangleai/memory';
import { createPipeline } from '@tangleai/pipeline';
import { createHashEmbedder } from '@tangleai/models/embed';

const store = createMemoryUnitStore();
const legacyPipeline = createPipeline({
  store,
  thresholds: policyThresholds(SHIPPED_LEGACY_POLICY),
  embedder: createHashEmbedder({ dims: SHIPPED_LEGACY_POLICY.embedding.dims }),
});
// Use SHIPPED_LEGACY_POLICY.retrieval explicitly when recalling its memories.
```

The [registered report](https://github.com/jklarenbeek/tangleai/blob/main/docs/LOCOMO_POLICY.md) selected inert: the challenger gained F1 0.000719 over 89 held-out questions, with 95% interval [-0.001464, 0.003216]. Its paired SD was 0.011458; the registered minimum detectable effect was 0.002380 (1.96 × standard error, a precision diagnostic rather than a powered equivalence test). Every clause except a positive overall interval passed. This does not prove equivalence or a general absence of benefit. The result is bounded to one dataset, model and sample; disabling resolution can leave conflicting observations retrievable.

`POLICY_PROVENANCE` carries report, registration, cell, source, challenger and transition identities, per-field measurement tiers, decision clauses and power. `POLICY_CONTRACT_REVISION` is the Jaren contract revision; JSON contracts are exported at `@tangleai/memory/schemas/policy.contract.json` and `@tangleai/memory/schemas/policy.schema.json`. Config profiles reference this owner rather than copy its values. Generation reads validated benchmark evidence only during development; runtime packages never import benchmark files.

From the repository root:

```sh
npm run policy:check
npm run policy:contract:check
npm run emit:policy -- --check
```

The drift check validates the immutable live evidence, regenerates the expected artifact in memory, checks the registry reference and probes the public runtime behavior. `npm run policy:generate` writes a default only from a complete eligible confirmation; regenerate declarations with `npm run emit:policy` after a contract change. Contract compatibility is checked against the committed v1 fixture.
