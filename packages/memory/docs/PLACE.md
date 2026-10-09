# Sourced place memory

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

`positionSeries(temporalStore, { scope, versionId, subject, gazetteer,
pageLimit?, maxPages? })` reads the complete qualified location membership.
Defaults are 256 rows per page and 128 pages. Every row and numeric mirror must
match the captured validated projection; a short, repeated, altered or foreign
page cannot prove completeness. The table retains unknown and conflicting
assertions. Unplaceable counts statuses other than accepted and time kinds
other than state/point; an accepted state with an unknown end is instead
checked for exact validity after the join. Known starts produce numeric
`{ at, value: tableIndex }` samples; unknown starts receive no invented instant.
These native samples differ from the serialized `PositionSample` contract.

`locationAtInstant(series, epoch)` uses Jaren's backward `asOfJoin`. Equal
instants select the last row in deterministic physical membership-id order.
Only the matched claim is tested by `claimContains`: an ended state or old
point refuses `TPLC1008`, and an unknown end refuses `TPLC1009` with
`unknown-validity`. There is no fallback to an older position. A later exact
point can answer after an earlier unknown-ended state. An unknown-time row
cannot be ordered and makes exact location refuse. `locationAtEvent` also
requires an accepted, exact point event for the same subject and scope.
`movementDistance` requires both event operands and rounds native
`geoDistance` to integer metres. These are distances between sourced point
proxies, not traveled route lengths or ellipsoidal distances.

`nearbyEntries(gazetteer, entry, { radiusMetres, precision, entriesInCells? })`
returns sorted neighbouring ids, excluding the centre, plus `probedCells`,
`candidates` and `narrowed`. Native circle bounds must fit a contiguous nine-cell
footprint; wrapped or polar footprints and larger radii conservatively refuse
`TPLC1011`. The optional cell reader must return the complete candidates for the
same immutable gazetteer. The SQLite adapter's stored cells use precision six
and validate the whole gazetteer before their cell query; this is not bounded
read I/O. Other precisions can use the in-memory view without that callback.

`recallPlace({ temporal, gazetteer, entriesInCells? }, query)` requires scope,
subject, knowledge and embedder identity, embedding, candidatePool, k, minScore
and expectedHead (an exact head or null). Operations are `location-at` (`at`),
`location-at-event` (`eventClaimId`), `movement` (`fromClaimId`, `toClaimId`) and
`nearby` (`entryId`, `radiusMetres`, `precision`). The knowledge view must match
an independently prepared projection. Ranking shares the temporal lane's cosine
and source-id tie order. Every event and position citation must fit the declared
semantic pool and final k; position paging never widens either budget.

A successful recall contains `head`, `answer`, selected `claims` and `sources`,
`coverage` and `refusals`. Coverage records occurrences, comparable sources,
semantic candidates, positions, unplaceable rows, pool truncation and
completeness; refusals retain that coverage. `answerPlace` adds deterministic
`text`. `renderPlaceAnswer(answer, gazetteer)` returns a result containing names
as the gazetteer spells them, integer metres and deduplicated source spans.
The explicit gazetteer supplies names because the closed answer stores ids.
Nearby geometry answers have no persona claims or invented citations; their
entries retain source metadata in the gazetteer. `recallPlaceWithFallback`
returns ordinary embedding ranking separately while keeping the original
place refusal.

Run the [three-entry public example](https://github.com/jklarenbeek/tangleai/blob/main/examples/place.ts)
with `npm run place:smoke`. Its companion gazetteer copies the cited Wikidata
CC0 coordinates unchanged; its persona assertions are synthetic host reporting
events. The [place benchmark](https://github.com/jklarenbeek/tangleai/blob/main/docs/PLACE_BENCHMARK.md)
measures the separately licensed annotation fixture: 174 of 197 audited mentions
are grounded; 57 position assertions cover 16 personas. All 124 original
questions pass on memory, Node SQLite and Bun SQLite. The equal-budget paired
table retains temporal eligibility's five location losses alongside its 40 wins;
distance/proximity gains over baselines without geometry are labelled structural.
Correct refusals are scored, and no paired interval or live-model gain is claimed.

The separate [candidate-scale receipt](https://github.com/jklarenbeek/tangleai/blob/main/benchmark/receipts/place-scale-2026-10-08.json)
measures the shared sweep over 50,000 sparse synthetic points. Node and Bun both
meet the 50 ms warm p95 target, so no bbox or R-tree is adopted. These timings
exclude gazetteer validation, semantic ranking and full SQLite adapter I/O.
The public source contract rejects synthetic entries; only the private geometry
measurement uses them. Live mention extraction and placement proposals through
the structured seam remain unmeasured. Neither fixture changes ordinary LoCoMo
scores or default pipeline routing.
