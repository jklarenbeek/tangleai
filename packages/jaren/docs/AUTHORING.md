# Engine authoring and measured limits

Received from Jaren revision `3491513e164dc30e429c84e709bd738841f4df16`.
Import paths name current owners. Historical measurements, failures and model
identities remain historical; linked original evidence uses its immutable source.
No new paid run or improved model capability is claimed.

## Authoring engine documents — validate *and* compile

The Jaren engines are program languages published as JSON Schema — a query, a JSLT
stylesheet, an app, a flow machine. A model can author one under the schema, but "it
validates" is not "it compiles": a jaren-fsm can be structurally perfect and still name a
transition to an undeclared state, which only the *compiler* catches. So the gate for a
generated program is the schema (the **shape**) plus a compile check (the **semantics**),
and `createStructuredOutput` composes them for you with `refs` and `gate`:

```javascript
import { createStructuredOutput } from '@tangleai/models/structured';
import { compileFsm } from '@jarenjs/flow';

// the two-line compile gate: success → true, a compile error → an
// outcome carrying the engine's own code + docPath
const compiles = (doc) => {
  try { compileFsm(doc); return true; }
  catch (e) { return { valid: false, errors: [{ code: e.code, docPath: e.docPath, message: e.message }] }; }
};

const out = createStructuredOutput({
  client, schema: fsmSchema, name: 'jaren_fsm',
  refs: [querySchema],   // every engine grammar $refs the query grammar — register it
  gate: compiles,        // shape (schema, constrained-decoded) + semantics (compile)
});
```

- **`refs`** are the schemas your `schema` references by `$id`. Every Jaren engine-document
  grammar composes the published query/JSLT grammars by `$ref`, so without `refs` the
  internal validator throws "Can not resolve schema". Pass the referenced grammars once.
- **`gate`** is one or more checks run *after* schema validation (the schema still drives
  constrained decoding). The first invalid check wins and its errors go back to the model.

What makes this *repairable* rather than merely "failed": every Jaren compile error carries
a stable `code` (`JQ0002`, `JT0007`, `JF0006`, …) and a `docPath` — a JSON Pointer into the
exact offending member — kept through the repair prompt. The model is told not "something
failed" but *where* and *what* — the difference between a loop that converges and one that
flails.

Nothing here is engine-specific: the same `refs` + `gate` shape authors a query, a JSLT
stylesheet, an `@jarenjs/app` document or an `@jarenjs/flow` machine. `@jarenjs/flow`'s
[README](https://github.com/jklarenbeek/jarenjs/blob/3491513e164dc30e429c84e709bd738841f4df16/packages/flow/README.md#authoring-with-a-model) shows the flow worked example end to end.

### What holds up on a cheap model (field notes)

Measured driving `qwen3.6-35b-a3b` (orchestration) and `qwen3.6-27b` (coding) through
OpenRouter on a real, complex task — designing a Kubernetes self-management state machine
and its remediation scripts. The pattern that *reliably* gets a valid, useful program out
of a small model:

- **Author with constrained structured output, not a free-form agent tool.** With
  `response_format: json_schema` the schema constrains generation and a rich, valid
  document comes back in one shot. Handing the model an *unconstrained* tool argument
  (`{ doc: object }`) and hoping it emits the right shape is far weaker — a small model
  degrades to a trivially-valid-but-empty document just to satisfy the gate, or stalls.
- **Compile errors repair; quality asks do not.** A precise `JF0006 at /transitions/0/to`
  is a fix the model lands. A terse "needs ≥6 events" invites narrow patching and burns
  rounds — enforce *breadth* in the prompt and, if a whole document is inadequate,
  **re-generate with a sharper prompt** rather than repair-patching it.
- **A few-shot example fixes *shape*.** Told in prose to make an event-driven machine, a
  small model tends to build an action *pipeline* chained by one generic event. One tiny
  worked example in the prompt flips it to the intended shape (events → transitions).
- **Pin caller-known fields.** If you ask for the script implementing action `X`, set the
  result's `action` to `X` yourself — don't trust the model's free-form label.
- **Match the adequacy metric to the shape.** An event-driven loop is *few states, many
  events*; measuring "≥5 states" pushes the model toward the wrong (pipeline) design.

The reliable *composition* of all this is a jaren-dag: one task node authors the machine
(orchestrator model, `refs` + `gate`), a query node extracts its actions, a task node
writes a validated script per action (coder model), and a query node assembles the system
— every AI output schema-validated and compiled before the next stage, no `eval`.

### When the grammar is too big to decode (measured)

The pattern above has a size limit, and the published JSLT grammar is past it. Asked for a
stylesheet with `jaren-jslt.schema.json` as the `response_format`, `qwen3.6-35b-a3b`
returns **an empty reply — three times out of three, in 14 seconds each**. Not a bad
document: no document. The LLM-profile twin does not help, because a relaxation *restates*
every constraint it removes and therefore **grows** the schema.

Those runs were measured when the canonical grammar was 18,831 characters and its LLM
profile 19,158. It is **23,515** today, and the profile **23,870**: every operator the
vocabulary gains lands in the response format, so the gap this section is about widens
rather than closes with time. That is the failure `@tangleai/jaren/stylesheet` fixes:

```javascript
import { createStructuredOutput } from '@tangleai/models/structured';
import { createStylesheetAuthor } from '@tangleai/jaren/stylesheet';
import { compileJsltStylesheet } from '@jarenjs/json/jslt';
import authoring from '@jarenjs/json/schemas/jaren-jslt.authoring.schema.json' with { type: 'json' };
import canonical from '@jarenjs/json/schemas/jaren-jslt.schema.json' with { type: 'json' };
import grammar from '@jarenjs/json/schemas/jaren-query.schema.json' with { type: 'json' };

const author = createStylesheetAuthor({
  client, createStructuredOutput,
  compile: compileJsltStylesheet,   // the engine, INJECTED — never imported here
  schema: authoring,                // 3,491 chars: the document shape, body open
  canonical,                        // the full grammar, as a local check after decoding
  grammar,                          // the operator vocabulary, for the prompt
  models: host.authoringModels,   // ordered host configuration
});

const { value, model } = await author.author(
  'Use jsonpath to make a stylesheet that gets the nearest probability to a random upperclass list',
  { sample },                       // the document it will run on
);
```

Four changes, each one answering something that was measured rather than suspected.

**1. Narrow the response format; move the vocabulary to the prompt.**
[`jaren-jslt.authoring.schema.json`](https://github.com/jklarenbeek/jarenjs/blob/3491513e164dc30e429c84e709bd738841f4df16/packages/json/schemas/jaren-jslt.authoring.schema.json) is
the canonical grammar cut at the one `$ref` that pulls in the whole expression language —
**23,515 → 3,491 characters**, the document shape intact and the body open. The cut is
where all the growth is, so the authoring profile has not moved a byte while the grammar
it is cut from has grown by a quarter. It is mechanically derived and the artifact test
asserts the committed file *is* the derivation.
It is deliberately weaker than the canonical schema, which is why `canonical` is validated
locally afterwards and the compiler still gates everything: the same validate-then-compile
pipeline, with a smaller thing driving the decoder. What the cut removes goes into the
system message instead, as **1,303 characters of operator names grouped by arity** —
`operatorCrib(querySchema)`, read off the injected artifact so it cannot rot. Arity is in
there because leaving it out was measured too: on the small schema alone the model reached
the right algorithm and wrote `{"$if": {"$gt": …, "then": …, "else": …}}` — named members
for an operator whose operands are an array.

**2. Ground the question in the data, as paths.** A real user's prompt names no field that
exists: *propability* is a typo and *upperclass* is a value, not a member. `describePaths`
turns a sample into the addresses that reach it —

```
$.target                    number  e.g. 0.5
$.records[*].class          string  e.g. "upper", "middle"
$.records[*].probability    number  e.g. 0.61, 0.54
```

— which binds both without being told. Arrays collapse to one `[*]` entry, so four hundred
records describe the same shape as three and the request does not grow with the data.

**3. Two gates the schema and the compiler both miss.** Both of these documents validate,
compile, and are wrong:

| the document | why every existing check passes it | what catches it |
| --- | --- | --- |
| `{"match": "$", "body": "if (.class == \"upper\") …"}` | a body string that does not start with `$` is a legal string **literal** — the transform returns its own source | `literalBodyGate` → `AI0220` |
| `{"$sub": ["$i.probability", "$$.target"]}` | `$$` is the escape for a literal `$`, so this is the *text* `"$.target"` — legal everywhere except arithmetic | `runGate` → the engine's own `JQ2001` at `/…/$sub/1` |

The second is the sharper lesson: **compiling is not running**. That document was produced
by a live model on the first attempt, filtering the right class and ranking by absolute
distance — correct in every respect except one operand, and unfindable until a value flowed
through it. The sample the digest already needs is exactly what makes it findable, so the
run gate costs nothing extra and converts a silent wrong answer into a repair round
carrying the engine's pointer. Neither gate judges the *answer*: a transform that runs and
returns the wrong record passes, because a quality gate repairs badly on weak models — a
field note this package earned once already.

**4. Bound the request.** Of 2,642 completion tokens on one of these calls, **2,167 were
reasoning**: 82% of the output budget spent thinking, and a repair round (a longer prompt
carrying the failed attempt) escalated it to 5,131 and blew its deadline. The author sends
`reasoning: { effort: 'low' }` and a `maxTokens` ceiling by default. The ceiling is not
only thrift: left unset a provider substitutes the model's whole context window, which a
credit-metered aggregator must be able to afford up front — OpenRouter answers **HTTP 402**
naming the number it wanted rather than billing for it. `createChatClient` now takes
`maxTokens` for this reason.

**5. Name the member the model has to change.** A closed vocabulary is the one thing
JSON Schema reports badly. Both tiers reach for `$abs` for "nearest" — a reasonable
spelling, and one that lives in `mathPack` rather than the core grammar — and validating
that document against the canonical schema produces **280 errors, of which the first to
contain the string `$abs` is number 67**. A repair round carries eight. What the model
gets back is `must be a array`, `must have required property '$query'`, `must NOT have
additional property '$head'` — the anyOf branches failing one by one, describing
everything except what to fix. It repaired to the identical document twice.
`unknownOperatorGate` walks the bodies, checks every `$`-member against the grammar's own
closed vocabulary, and says *`'$abs' is not an operator in this grammar`* with a pointer.
It runs **before** the canonical schema, because the first invalid check is the one whose
errors travel. A host that mounts a registry passes `operators: registry.names()` and both
the crib and the gate widen together — a gate stricter than the prompt would refuse what
the instructions offered.

#### What it does, end to end

The question is the user's, typo and all — *"Use jsonpath to make a stylesheet that gets
the nearest propability to a random upperclass list"* — over fourteen records with a
`class` and a `probability` and a `target` to be near. A run counts as **correct** only if
the authored stylesheet compiles, runs, and returns the record the arithmetic says it
should: the nearest probability *among the upper class*, which is not the nearest overall.

The earlier dense-model success table had no recoverable measurement artifact and
has been withdrawn. Current program and JSLT probes retain every failed attempt,
including timeouts; prompts, schema hashes, sampling options and usage are recorded
in `benchmark/programmind-authoring-*.json`. These results do not justify a model-family
routing default.

<!--fact:program.live-->

| instrument | profile / model | attempts | correct | timeout | other failures |
|------------|-----------------|----------|---------|---------|----------------|
| authoring-live | primary / qwen/qwen3.6-35b-a3b | 6 | 0 | 1 | 5 |
| authoring-live | secondary / qwen/qwen3.6-27b | 6 | 0 | 4 | 2 |
| authoring-remeasured-live | primary / qwen/qwen3.6-35b-a3b | 6 | 3 | 0 | 3 |
| authoring-remeasured-live | secondary / qwen/qwen3.6-27b | 6 | 6 | 0 | 0 |

<!--/fact-->

`models` is a list because the *call* can fail — a timeout, a transport error, a candidate
that never passes the gates — and the next model is then tried with the same messages.
It escalates on a failed call and never on a bad answer: a second opinion on a document
that authored cleanly is not what a fallback is for.

The failing 35b run is worth naming too, because it is the honest limit: it authored a
stylesheet that compiled and ran and ranked over every record instead of over one class.
No gate here refuses that, deliberately, and the arithmetic in the harness is what caught
it. A gate that judged answers would have to be right about the question, and it isn't.

**The worked example carries a `$where`, and that is load-bearing.** Without it the example
is `$for`/`$orderby`/`$return`, and asked for the nearest probability *in one class* the
model returned the nearest probability *overall* — a stylesheet that compiled, ran, and
answered a question nobody asked. It copied the shape it was shown, filter and all, and the
shape it was shown had no filter. Adding the clause to the example fixed it on the next
run. This is the "a few-shot example fixes *shape*" note above, in its sharpest form: an
example that omits a clause teaches the model to omit it.

### The spatial profile — the same author, three rules a model gets wrong by default

Geography is where a cheap model's defaults are wrong in ways that *compile and run*:
asked for "places within 5 km", it reaches for Pythagoras on raw degrees (wrong by two
thirds over a kilometre at Dutch latitudes), assumes a distance to a shape is the minimum
distance (it is the distance to the centroid), and tests a geohash **prefix** for nearness —
the folklore the internet taught it, which misses a neighbour at every cell boundary. None
of those is a schema error or a compile error. `createSpatialAuthor` is the stylesheet
author above with the query format's §8.14 taught in the prompt and refused at the gate:

```javascript
import { createSpatialAuthor } from '@tangleai/jaren/spatial';
import { createStructuredOutput } from '@tangleai/models/structured';

const author = createSpatialAuthor({
  client, createStructuredOutput, compile: compileJsltStylesheet,
  schema: authoring, canonical, grammar,   // the same three artifacts as above
});
const { value } = await author.author('the cities inside the region, nearest to the centre first',
  { sample: { centre: [4.9041, 52.3676], region, places } });
```

What changes is the message and the gates. The prompt carries the thirteen §8.14 operators
with their one-line definitions (a test holds that table to `QUERY-FORMAT.md`'s own, so it
cannot teach an operator that does not exist), the three rules — *geodesic, never planar*;
*a value is measured by one representative position*; *a prefix is bucketing, proximity is
the nine cells* — and a worked example that filters with `$within`, orders by `$distance`
and projects kilometres. The grounding names which sample paths hold a `[longitude,
latitude]` position, because a digest alone shows `at[*]  number` and leaves the model to
guess. And three gates run beside the stylesheet author's, each with a pointer and the fix:

| the document | why every existing check passes it | what catches it |
| --- | --- | --- |
| `{"$starts-with": [{"$geohash": ["$c.at", 6]}, {"$geohash": ["$.here", 4]}]}` asked for "near" | a legal prefix test that compiles, runs and answers something | `prefixProximityGate` → `AI0230`, naming `$geohash-neighbours` — the **same document asked for "group by cell" passes**, because a prefix is exactly right for bucketing |
| `{"$mul": [{"$sub": ["$c.at[0]", "$.here[0]"]}, …]}` | legal arithmetic over numbers | `planarArithmeticGate` → `AI0231` at the operator, naming `$distance` in metres |
| four `$gt`/`$lt` over `at[0]`/`at[1]` that "mean" within | a correct filter for a rectangle, and for nothing else | `spatialOperatorGate` → `AI0232`: a geographic ask with no spatial operator |

The gate reads the *question* (`spatialIntent`: near, within N km, closest → proximity;
inside, region, polygon → spatial) so a prefix is refused only when nearness was asked for.
The run gate stays: the worked example is proven to compile **and run** on the repository's
own five-city dataset, answering Amsterdam 0 km, Utrecht 34, Rotterdam 57.

**What was measured, and what was not.** The gates and the prompt are proven against
recorded fixtures — the documents a model writes when it gets each rule wrong — and the
repair round is shown to carry the code, the pointer and the fix. No live model was run
against this profile in the session that built it; the stylesheet rows above are the only
live measurements this package carries, and a spatial row will be added when one is taken.

## A model as a dataflow node

An `@jarenjs/flow` dag runs a graph whose nodes are the suite's engines — and a *model*
is just another node. A `task` handler is three lines, and the run's shared `AbortSignal`
reaches the client for free:

```javascript
const dag = compileDag(doc, {
  tasks: {
    llm: ({ with: w, input }, signal) =>
      client.complete({ stream: false, messages: [{ role: 'user', content: prompt(w, input) }], signal })
        .then((r) => JSON.parse(r.message.content)),
  },
});
await dag.run(rows);        // the model's output flows to the next node; aborting the run aborts the request
```

That is the whole integration — no wrapper, no adapter. Guarding the model's *output*
with a downstream `query`/`jslt` node, or with `createStructuredOutput` inside the
handler, composes the same way. the Tangle AI packages and `@jarenjs/flow` never import each
other; the graph is the only thing that knows about both.
