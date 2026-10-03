# Sourced place contracts and assertions

`@tangleai/memory/place` supplies an opt-in, deterministic place vocabulary.
Every operation returns `{ status: 'success', value }` or a closed
`{ status: 'refused', code, reason, detail, cause? }`. The public schema and
generated types live in `@tangleai/core/schemas/place`; its matching JSON asset
is `@tangleai/core/schemas/place.schema.json`.

`createGazetteer({ id, revision, entries })` checks each entry's Wikidata or
GeoNames source metadata, unique id, aliases and two-dimensional GeoJSON Point.
Coordinates are `[longitude, latitude]`, bounded to `[-180, 180]` and
`[-90, 90]`, and must equal the supplied `sourceLatLon` pair. CRS wrappers,
extra geometry members and swapped pairs are refused. `revision` is Jaren's
`canonicalSha256` of the complete entries sorted by code-point id order.
The result is a detached frozen view: `byId(id)` returns a result value and
`byName(name)` returns immutable candidates. Source metadata is validated
locally; loading a gazetteer performs no online verification or geocoding.

Aliases use NFC, Unicode lowercase and collapsed whitespace. This is native
lowercase normalization, not a full Unicode case-fold table. Matching has no
accent removal, stemming, fuzzy search or model inference.

```ts
import { matchPlaceMentions, createPlaceClaim } from '@tangleai/memory/place';

const result = await matchPlaceMentions(source.text, gazetteer, {
  source,                         // a validated temporal SourceOccurrence
  knownUngrounded: ['Local café'],
});
if (result.status === 'success') {
  console.log(result.value.counts); // grounded / ambiguous / ungrounded
}
```

Matching chooses the longest non-overlapping alias at Unicode word boundaries,
then returns mentions in source order. Citations retain the original UTF-16
offsets and quote, including decomposed accents, whitespace and surrogate pairs.
The source identity and hash are verified before matching. A unique candidate
grounds an occurrence; multiple candidates remain ambiguous. An optional
synchronous `disambiguate(candidates, context)` may select an existing candidate
id; the mention retains the complete candidate inventory. Returning a foreign
id, a promise or a malformed callback value is a refusal.

A separate synchronous `qualify(candidates, context)` may return `false` when
an alias is not a place reference in that source context. For example, a host
may supply audited locative qualifications for nationality adjectives. The
matcher does not infer that a mentioned place establishes anyone's position.
Qualification and position evidence remain explicit host inputs.

`createPlaceClaim({ scope, subject, entry, kind, at, until, source, span,
derivation, precision? })` delegates identity, citation and time semantics to
`createTemporalClaim`. Its series key is `location` and value is the entry id;
geometry stays in the gazetteer. `kind` is `event` or `state`. An event requires
`until: null`; a state's null end means **unknown**, never indefinitely valid.
Known state ends are exclusive. Default precision is `minute`, so a point
cannot establish an exact instant. A host with exact evidence or a declared
reporting index may explicitly supply `precision: 'millisecond'`.
`placeClaimGeometry(claim, gazetteer)` resolves the entry; it does not establish
the claim's temporal eligibility or evidence truth.

`placeCell(entry, precision)` and `placeNeighbourhood(entry, precision)` return
result values over Jaren's geohash kernels. Precision must be an integer from
1 through 12. Neighbourhoods contain up to nine cells; boundaries can have
fewer. Cells are candidate buckets, not distances or proof that a radius is
fully covered.

`placeIntent(operation)` marks every place operation spatial and `nearby` as
proximity. `placeGates({ question, sample, intent })` composes the existing Jaren
spatial gates with explicit intent. `checkAuthoredQuery(document, call)` returns
`TPLC1007` with the original `AI0230`, `AI0231` or `AI0232` cause for a prefix
used as proximity, planar coordinate arithmetic or missing spatial operators.
The authoring host still supplies compilation and execution gates. These APIs
call no model and start no network, file or database work on import.

| Code | Meaning |
| --- | --- |
| TPLC1001 | Invalid closed shape or inconsistent gazetteer inventory |
| TPLC1002 | Invalid or mismatched geometry |
| TPLC1003 | Missing or invalid source metadata |
| TPLC1004 | Unknown entry or stored gazetteer |
| TPLC1005 | Ungrounded mention |
| TPLC1006 | Ambiguous place |
| TPLC1007 | Spatial authoring gate refusal |
| TPLC1008 | No position at the requested instant |
| TPLC1009 | Temporal refusal; `cause` retains the temporal reason |
| TPLC1010 | Persistence failure |
| TPLC1011 | Exhausted budget |

The vocabulary includes query/answer and coverage contracts for consumers.
Contract validation alone does not execute a retrieval operation or establish
that its evidence is complete. The sourced annotation instrument is documented
in the repository's [place benchmark](https://github.com/jklarenbeek/tangleai/blob/main/docs/PLACE_BENCHMARK.md).
