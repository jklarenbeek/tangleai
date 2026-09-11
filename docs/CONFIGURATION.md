# Configuration — profiles, identity, and what a result may claim

Tangle resolves every AI stack through one contract: a capability-profile
registry owned by `@tangleai/config`, a pure resolver, and a credential-free
**run identity** stored beside every result. A profile name expresses intent;
only the validated effective identity beside the result says what actually
ran.

## Intent versus identity

The registry (`config/profiles.json`, the only one) declares **capability
tags** — `reasoning`, `fast`, `cheap` seed the set; any lower-case hyphenated
name may join it. A tag is a declared intent with ordered candidates and a
required `limitations` sentence; nothing anywhere treats the spelling as
proof that a model is fast, cheap or good at reasoning. Two hosts may
legitimately resolve the same tag to different models — and their effective
identities then differ, which is the point: the **run identity** materializes
every value that ran (provider, suite-normalized base, model, inference
controls, prompt and response-schema revisions, the effective tool manifest,
the one embedding identity, policy/ranker component references, the effective
budget, rate-card provenance) and is content-addressed with `canonicalSha256`
over RFC 8785 JSON. Reordered members hash equally; any materially different
value cannot collide.

## Resolution, inheritance, refusal

`resolveProfile({ registry, request, host })` in `@tangleai/config` is pure:
no environment, database or network, no client construction. A profile has
zero or one `extends` parent; the child's RFC 7396 merge patch (the suite's
`applyMergePatch`) applies over the resolved parent and the merged registry
validates whole again, so a patch can empty an optional field and can never
smuggle in a ghost reference or an undeclared member. Every refusal is a
value — sorted `{ code, path, detail }` issues under stable `TCFG1xxx` codes
(the vocabulary is documented on `ISSUE_CODES`) — and nothing falls back: a
pinned candidate the host cannot serve, an exhausted tag, a missing required
tool, a raised budget, a dimension disagreement or a credential-bearing URL
refuses before a paid answer or an index mutation.

## The host boundary

Effectful work lives in the host adapter (`apps/desktop/src/ai-host.ts`),
which both the desktop settings and the benchmark environment reader feed.
It validates and normalizes input (a corrupt stored row reverts member by
member with counted issues; environment integers are schema-normalized with
explicit/defaulted/rejected states), projects it into the generated legacy
request, builds a credential-free host manifest from suite-normalized
endpoints, and constructs clients only from an `ok` identity — through the
one `chatClientFor`/`embedderFor` pair. The suite owns providers, wires and
replay: `PROVIDERS`, `resolveEndpoint` (the only endpoint authority — Ollama
and LM Studio with omitted bases get their suite defaults; custom without a
base refuses), `probeProvider`/`probeEmbeddings`, `createChatClient`/
`createEmbeddingClient`, `createBudgetAccount`, `createStructuredOutput`,
`createToolbox`. A run identity is never a replay key; the suite client's
effective-request cache remains the only cache identity.

## Secrets are write-only slots

A registry or request names a slot (`openrouter-primary`,
`settings-chat-key`); it can never hold a value. Manifests and identities
record only slot presence and source class. The settings surface returns
`null` for every credential value with `slots` booleans beside them; a public
read saved back verbatim RETAINS the stored value, a non-empty string
replaces it, and only the explicit clear flag removes one. URL userinfo is
refused as host policy (`TCFG1013`) before the suite ever normalizes the
base.

## The one embedding identity

A resolved run has exactly one `{ model, dims }` embedding identity, checked
with the suite's `sameIdentity`; registry dimensions must equal the host's
probe or reply, and disagreement refuses before indexed work. A wire embedder
is **provisional** until its first successful reply proves the width — the
stack's wrapped embedder finalizes and persists the identity BEFORE the first
vectors reach a caller. A configured wire that no work of a run ever observed
stays `configured-unproven`: the identity claims no embedding rather than
guessing one. Changing an indexed corpus's identity is the vector-migration
boundary in `ROADMAP.md` and does not happen here.

## Legacy behavior

Pre-profile settings project into a generated `legacy` request. Genuinely
unconfigured chat stays grounded/offline and an unconfigured embedder stays
the built-in — intentional product behavior. A *partial* remote configuration
(a wire with no model, custom with no base) is `TCFG1021`, an issue the user
can fix, never a silent fallback to another model. Historic rows whose stack
was never recorded read as `legacy-unrecorded` — a stated absence that is
never backfilled.

## Probes are explicit

Ordinary resolution and every keyless gate make zero network calls (tested
with throwing fetch stubs). The desktop's probe buttons and the adapter's
`refreshObservation` are the only probes: user-triggered, one attempt per
configured wire, calls and failures counted, the observation dated. Holding a
credential is not authority to probe, and the read-only `config.inspect`
operation never probes or constructs a client.

## Usage and cost

Provider-reported usage is stored verbatim as observation beside the
identity reference. A candidate may carry a sourced rate card (currency,
per-million-token prices, source, `asOf`); absence means cost **unknown**,
never free — the production registry currently sources none, so every cost
state reads unknown. The suite budget account remains the stop authority;
a profile may lower a host ceiling and can never raise one (`TCFG1016`).

## Querying the results

Every benchmark artifact and the desktop store carry the same envelope: an
identity table plus rows that are `run` (referencing an identity), `not-run`
(analysis that ran no provider stack) or `legacy-unrecorded`. Three committed
`@jarenjs/json` query documents under `queries/config/` answer the standing
questions with `compileJsonQuery` — no graph store, no SQL mirror, no wrapper
grammar:

```
npm run benchmark:config:queries
```

- `identity-inventory.json` — every row of every artifact joined to its
  identity, grouped by status and artifact.
- `profile-resolution.json` — the same request across host-manifest
  revisions; different effective identities never collapse under a shared
  tag spelling.
- `temporal-stack.json` — *which exact effective stack produced and scored
  temporal (category 2) QA*: joins the answer artifacts' rows to their
  identities and groups by complete stack id. Today it answers honestly that
  the 83 historic paid temporal questions sit under one `legacy-unrecorded`
  group with no stack fact invented, beside the keyless `not-run` ceiling;
  the moment an authorized live run lands with its identity, the same query
  answers with the full stack.

The pinned outputs live in `benchmark/results/config-queries.json`; the
conformance instrument (`npm run benchmark:config`) measures the 44
registered equivalence/sensitivity/refusal/legacy cases and publishes the
census beside them.

## Completion token limits

Chat settings and inference presets accept optional `maxTokensField` values
`max_tokens` or `max_completion_tokens`; chat settings also accept an optional
positive `maxTokens` limit. The suite client sends the selected provider field,
and the resolved run identity records the choice. Omitted settings preserve
the existing provider default. No secret is part of the identity.

The public contract classifies the two new input property constraints as R6,
because those extra members were previously untyped. Settings reads and writes
add the corresponding optional output members (R9). The contract tests pin the
exact changes beside the existing citation closure; supported older settings
remain readable and editable.
