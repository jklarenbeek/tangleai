# @tangleai/gmpl

GMPL supplies immutable prompt, role, domain and pattern content for
`@tangleai/mas`. MAS owns validation, planning, agents, concurrency, bounded
loops, durable interactions and replay. The host supplies clients, context,
store, clock and any permitted capabilities. Importing GMPL performs no I/O.

The fourteen source packs compile with Jaren JOSL (`parseToml`) and JTLT
(`compileJtltStylesheet`). Installed consumers use `artifacts/catalog.json`;
no checkout prompt directory or archived module is needed. Outcome reflection
and trading/research domain content are outside this catalog.

```ts
import {
  gmplArtifacts, createGmplCatalog, renderGmplPrompt,
} from '@tangleai/gmpl';

const loaded = await createGmplCatalog(gmplArtifacts);
if (!loaded.valid) throw new Error(JSON.stringify(loaded.issues));
const prompt = loaded.value.prompt('analysis-analyst');
if (!prompt) throw new Error('Missing analyst artifact');
const rendered = renderGmplPrompt(prompt, {
  query: 'Compare these records.', evidence: [],
  context: { participant: 'analyst-1' },
});
```

`compileGmplPromptPack(sourceText, { variables, outputSchema })` accepts TOML
text and explicit variable contracts. It returns a schema-bound artifact or
coded issues. Named variables and balanced `{{#if name}}` blocks are the only
source syntax. Variables outside optional blocks are required. Unknown names,
traversal, helpers and malformed blocks refuse. Conditional presence means
true, a nonempty string/container or a nonzero finite number. Substituted text
is never parsed again; JSON values render in stable property order. System
instructions are static. Source-byte, parsed-pack, role, schema, compilation
policy and compiled-template changes move identity.

`createGmplDomainBinding` and `createGmplRecipe` create revisioned data.
`gmplCatalogDocument` seals a document containing prompts, domains and recipes;
`createGmplCatalog` checks those identities, references and schemas and returns
a detached immutable catalog. Domain data names prompt bindings and pure answer
projector ids/versions; it cannot contain clients, functions, credentials or
filesystem paths.

`materializeGmplTemplate(recipe, domain, hostSnapshot, catalog)` fixes the
participant topology and produces a MAS template, registry snapshot and identity
receipt. The host snapshot contains `{ registry, config, profile }`, using the
MAS public registry/catalog constructors. Child workflows inherit registry and
CONFIG pins; the final registry exists before a top-level template pins it.
The top-level template is never inserted into the registry it hashes.

`instantiateGmplPattern(materialized, { caps? }, hostSnapshot, catalog)` uses
MAS specialization, full validation and planning. Parameters can only lower
declared caps. Changing participant counts or round policy requires a newly
materialized recipe; there is no node-array patch. `createGmplHostBindings`
returns pure task handlers and exact message adapters for MAS compilation.
Neither function executes agents. Parallel analysis executes independent analysts
and an ordered, evidence-preserving synthesis. Peer review, red team and structured
debate use bounded MAS loops, explicit early termination and no-consensus at the
round cap. The catalog contains all six default recipes. Peer/red single-round
recipes remain available with `scope: 'round'`. Debate synthesizes once after
terminal judgment and preserves dissent. Execution coverage is reported by the
[benchmark](../../docs/GMPL_BENCHMARK.md).

Clarification inspects intent, asks one to three questions (`q1` through `qN`),
and waits through MAS. The host supplies `{ answers: { q1: "..." } }` with exactly
the requested keys. Nonblank string answers are bounded to 4,096 characters.
Accepted responses become labelled host evidence; they clarify intent and do not
independently verify external facts. Each turn has a distinct durable interaction
path. Resolved intent permits one answer stage; unresolved turn exhaustion returns
`needs-information` with `outstandingQuestions` and makes no answer call.

Delphi polls independently and exposes a closed projection of prior rounds to
peers: round-local panel/finding aliases, answer keys, estimates, confidence,
citation ids and statistics. Private finding ids, origins, reasons and invocation
paths remain in host traces. This protects structured attribution from peers;
external evidence ids remain visible, and answer keys deliberately containing an
identity are not anonymized free text. Confidence is diagnostic. Text domains
require unanimous normalized keys; numeric domains use Jaren sample standard
deviation on their declared scale. Unresolved supported contradictions block
agreement. The final synthesizer receives the full retained finding ledger.

`createGmplHostBindings(materialized, catalog, { answerProjector? })` checks a
pure custom projector's id/version against the domain before execution. Built-in
`text-answer` and `estimate-answer` projectors use version `1`. A custom binding
returns a `GmplOutcome<{ key, estimate }>`; functions never enter artifact JSON.

| Pattern | Default | Participant range | Round/turn range |
|---|---|---|---|
| Parallel analysis | 2 analysts, 1 synthesis | 1–8 | one pass |
| Peer review | 2 critics, 3 cycles, acceptance >=0.7 | 1–8 | 1–10 |
| Red team | 1 attacker/defender, 3 rounds, resilience >=0.7 | 1–8 | 1–10 |
| Structured debate | 2 participants, 3 rounds, final synthesis | 2–8 | 1–10 |
| Clarification | at most 5 human turns | 1–3 questions/turn | 1–10 |
| Delphi | 5 panelists, 3 rounds, sample deviation <=0.2 | 2–20 | 1–10 |

Claims cite visible evidence ids and exact digests. The shared evidence gate
rejects foreign citations and silent loss or reattribution of supported findings.
Changing a finding disposition requires a new evidenced reason. These checks
establish citation scope and ledger retention; they do not prove entailment or
that an answer is true. Pure post-agent validation preserves a content failure
as a failed MAS attempt after the already incurred agent/normalization cost.

Public content issues use `TGMPL1001` (shape), `1002` (identity), `1003` (unknown
id), `1004` (prompt), `1005` (evidence/findings), `1006` (round/disposition), and
`1007` (host capability). MAS/Jaren errors keep their owning codes or causes.

Development gates: `npm run emit:gmpl`, `npm run gmpl:artifacts`,
`npm run test:gmpl`, and `npm run benchmark:gmpl -- --require complete`.
The benchmark is keyless scripted conformance. It is not evidence of live
pattern quality improvement, and it supplies no implicit paid-provider approval.

The public host walkthrough is [examples/gmpl.ts](../../examples/gmpl.ts).
`npm run gmpl:smoke` (or `bun scripts/gmpl-consumer-smoke.ts`) runs the
`document-review` text domain, the `estimate-panel` domain on [0,1], and a
two-turn scripted clarification. Domain replacement changes immutable payload
restrictions, prompt roles, evidence and host profile identities while retaining
the same participant topology and round policy. Every domain payload is checked
before any model request. The host registers versions, runs the existing MAS
worker, reopens SQLite, reads the result/finding ledger and projects the saved
plan with `projectMasPlan`. A second reconciliation creates no new effect.

`npm run benchmark:gmpl -- --require comparison` publishes the 288 primary
scripted executions and seven separately registered diagnostic ablations.
All pairs share question/evidence bytes, model/profile/config, output contract,
scorer, total caps and no incremental human information. Clarification waits on
nine cases and scores 0.625 versus its control's 1.000; the other five pairs tie
at 1.000. These are protocol/scorer fixtures, not measured model improvements.

`npm run benchmark:gmpl:locomo -- --plan` freezes 64 seeded category 1–4
questions and their evidence slices from the local LoCoMo submodule. It never
loads credentials. `--replay PATH` accepts an explicitly bound, content-addressed
bundle using the existing model wire replay keys; misses fail closed and partial
rows are ineligible. Reports separate original purchases from zero incremental
replay transport. Test-created responses remain `scripted`. See
[the plan and replay report](../../docs/GMPL_LOCOMO.md) for identities, costs and
limits. Live LoCoMo pattern-versus-single-agent quality remains unmeasured.
