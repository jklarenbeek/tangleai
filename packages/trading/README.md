# @tangleai/trading

Closed trading records, point-in-time providers, deterministic signals and
atomic simulated execution with corporate settlement and hard risk limits. Importing the package performs no
filesystem, network or database work. Hosts supply market observations and a
store; the package has no live broker connection.

The schema at `@tangleai/trading/schemas/trading` owns the generated declarations
at `@tangleai/trading/contracts`. Every record has a content-derived hyphenated
`id` and canonical SHA-256 `revision`. `createTradingRecord(kind, body)` assigns
both and returns a frozen value. `validateTradingRecord(record)` verifies its
shape, temporal meaning and content identity. Outcomes are `{ valid: true,
value }` or `{ valid: false, issues }`; each issue has a stable `TTRD` code and
JSON Pointer.

```ts
import { admit, latestBarsAsOf, createMemoryTradingStore } from '@tangleai/trading';

const store = createMemoryTradingStore();
const admitted = await admit(observations, session.closeAt);
const latest = await latestBarsAsOf(bars, session.closeAt, manifest.assets);
```

The snippet assumes validated host records. Admission compares `availableAt`
numerically with the cutoff, including equivalent UTC offsets; it never uses
`eventAt` as a substitute. Future observations are counted `TTRD1003` refusals.
The backward as-of join retains every requested asset, with `bar: null` and an
incremented `missing` count where no bar was available. Inputs are detached
before asynchronous validation. `sessionIndex` verifies complete calendar
links and nonoverlapping intervals; interval lookup excludes the exact close,
while `cutoffFor` explicitly returns that close as the decision cutoff.

`createFixtureProviders` builds seven injected seams: calendar, market,
fundamentals, news, social, insiders and profiles. The host loads the corpus and
supplies its explicit `eventAt` and `availableAt` publication envelope. Those
times cover the captured provider revision; each observation still has its own
publication time. Neither timestamp substitutes for the other. The factory
returns `{ providers, snapshots, bindings }`, where each immutable snapshot is
content addressed and each binding selects one provider snapshot.

`createReplayProviders({ manifestId, snapshots, bindings })` verifies that exact
capture. A missing bound snapshot returns `TTRD1007 unavailable`; a snapshot
revision or observation published after the cutoff is counted in `refused`.
There is no live fallback. All seven methods receive the cutoff, including the
calendar, whose revised session schedule must also have been published.

```ts
import { createFixtureProviders, buildSnapshot } from '@tangleai/trading';

const captured = await createFixtureProviders({
  manifestId: manifest.id, eventAt: captureEventAt, availableAt: captureAvailableAt,
  sessions, observations,
});
if (captured.valid) {
  const result = await buildSnapshot({
    manifest, asset, session, portfolio, providers: captured.value.providers,
  });
  if (result.valid) {
    const { snapshot, observations: admitted, sessions: calendar } = result.value;
    // Retain calendar and admitted observations before storing this snapshot.
  }
}
```

`buildSnapshot` returns the immutable snapshot plus its admitted observations
and calendar so a host can persist its references. It independently validates
injected provider responses, rechecks observation identities and publication
times, and sorts citations by `(availableAt, id)`. Partial provider failures
remain in `providerErrors`; an unavailable calendar refuses the whole snapshot.
`staleness` is the number of linked trading sessions since the latest admitted
daily bar, or null when none is available. Daily bars must use their session's
close event. The store recomputes staleness from retained evidence; missing
calendar links and forged ages are refused. Snapshot construction does not
mark a portfolio or execute trades.

The five signal policies `buyAndHold`, `macdCross`, `kdjRsi`,
`zeroMeanReversion` and `smaCross` take identity-verified bars and explicit
`TradingSignalParameters`. Retain those parameters as `manifest.signalParameters`
when running a strategy. Inputs require one chronological revision per asset
and session, admitted before they reach the policy. Each result is an aligned
array with null warm-up and long/flat targets, observation citations and a
publication time no earlier than any input it used. Historical restatements
must be selected at the decision cutoff before constructing the window.

`TRADING_SIGNAL_DEFAULTS` declares causal adjusted OHLC, MACD 12/26/9, KDJ 9/3
with RSI 14 and J/RSI entry thresholds 20/30 and exit thresholds 80/70,
mean reversion over 20 sessions at one sample standard deviation, and SMA 5/20.
Mean reversion enters below mean minus that deviation and exits above the mean.
These are declared comparison settings, not claims of optimal performance.

`adx`, `cci`, `vwap`, `volumeRatio` and `kdj` are direct exports of the native
Jaren kernels. ADX uses TA-Lib seeding and returns `plusDI`, `minusDI`, `adx`;
VWAP accepts aligned reset flags; volume ratio divides current volume by the
preceding period's mean, excluding the current sample. Native KDJ defaults to
14/3 and returns stochastic K/D with J = 3K − 2D; the signal policy explicitly
passes 9/3. Arrays and Float64Array are qualified against pinned Python/ta/TA-Lib
reference vectors, including identical null warm-up and zero-volume gaps.

The injected `TradingStore` has eleven record tables. Retain the manifest and
sessions, put observations, then call `initializePortfolio` with the declared
cash and zero positions. Snapshots reference a retained portfolio and admitted
evidence for their asset and session. `stageArtifact` binds one immutable
artifact to a decision-stage key and restricts citations to that snapshot.

`commitDecision` is the sole financial write boundary. Its input carries
`expectedPortfolioId`, a decision key, decision, optional intent, fills,
double-entry ledger postings, the resulting portfolio and bound `markBarIds`/`actionIds`. Its `mode` is `trade`, `settlement` or `valuation`, with the reserved key stages `broker`, `corporate-action` and `valuation`. The shared planner
checks scope, next-session execution, the predecessor, balanced postings and
the exact cash, quantity, cost-basis and valuation transition. Fills name a retained `sourceBarId`; admission recomputes its next-open price, commission and slippage under the immutable manifest and rechecks every risk limit. Corporate actions must settle before their asset trades; a close valuation seals that session. Whole-share,
long-only market fills cannot overspend cash. An immutable commit marker binds
the complete input and ordered record references. Exact replay verifies those
records and writes zero rows; conflicting bytes or stale predecessors return
`TTRD1006`. Concurrent identical commits apply once.

```ts
import { openTangleDb, createTradingStore } from '@tangleai/store';

const db = await openTangleDb({ path: 'simulation.db' });
const store = createTradingStore(db);
try {
  const result = await store.commitDecision(plan);
  // Inspect result.valid before treating the decision as committed.
} finally {
  await db.close();
}
```

The SQLite adapter and memory store share the same validator and planner. One
immediate database transaction retains the decision marker, intent, fills,
postings and portfolio together; a failure at any write rolls them all back.
Reads return detached records. `TradingPersistence` permits another host
adapter, which must provide equally atomic, serialized transactions.

| Code | Boundary |
|---|---|
| `TTRD1001` | Shape, finite JSON or invalid time |
| `TTRD1002` | Content identity or missing run reference |
| `TTRD1003` | Calendar, availability or future state |
| `TTRD1004` | Evidence or artifact reference |
| `TTRD1005` | Unsupported execution, cash/position refusal or hard risk limit |
| `TTRD1006` | Conflicting replay, ledger or portfolio transition |
| `TTRD1007` | Provider failure or unavailability |
| `TTRD1008` | Stage protocol violation |
| `TTRD1009` | Budget or execution eligibility |

The registered [trading instrument](../../docs/TRADING_BENCHMARK.md) derives
controls from an original synthetic fixture. Its privileged oracle is an
accounting control, not a feasible trading result. The instrument measures
indicator vectors and baseline signal crossings separately from simulated execution
returns. All five baselines execute through the public engine. Model-driven
strategy execution remains outside this surface.

`planFill({ manifest, portfolio, intent, session, bar })` plans one complete
market fill at the next linked session's raw open, including adverse slippage,
commission, balanced postings and a new portfolio. Missing bars return
`TTRD1007`; stops, limits, oversells and overspending return `TTRD1005`.
`markPortfolio` derives session-close marks and reports missing assets; a missing
bar preserves the prior mark. `applyCorporateActions` adjusts split quantities
and cost basis, or credits opening-holder dividends. Pure plans write nothing;
only `commitDecision` can apply them, and each corporate action identity settles
once even when a split has no cash posting. Execution inputs must select one
revision of each economic action and publish it by its known ex-session open;
late or out-of-calendar action inputs refuse before the run writes anything. Positions retain per-asset cash flow
and realized P/L for exact attribution.

`checkRiskPolicy` recomputes ratios from cash, quantities and marks. Its named
limits cover gross/net exposure, single-name concentration, cash floor in portfolio
currency, observed-volume participation, loss against initial capital, instruments
and order kinds. `sizeToPolicy` intersects the permitted quantity interval and
verifies the result using the actual fill planner. It can reduce a proposal or
return `hold`; it never increases it. Whole shares require safe integers. An
explicit fractional-share manifest uses representable floating quantities, with
strict boundary verification. Risk at execution uses the filled asset's raw open
and other retained marks. Later market moves can breach a holding limit without
an admitted order doing so; close valuations retain that result.

`runStrategy({ manifest, sessions, bars, actions, observations, signals, store })`
is the chronological execution loop. The manifest binds an `executionPolicy`
with `strategyId`, `kind` and `entryQuantity`. `signals` is an injected callback
returning a target, publication time and observation citations, or null. Its
frozen context includes admitted observations, one latest eligible bar revision
per historical session, cash and positions. It excludes ex-post marks and equity.
Every asset receives the same close-time financial state before the loop commits
any next-open fill. Long targets enter only when flat; flat targets exit the
held quantity. The hard gate may reduce the request. The first session has no
fill, and the final session has no forced liquidation.

Kinds `oracle` and `leaky` are restricted to fixture mode: oracle explicitly uses
the next session's close as a privileged analytic control, while leaky callback
citations still pass ordinary publication admission and are refused when early.
`do-nothing` holds cash. The result retains daily records, closing portfolios,
fills, costs, rejected orders, refused observation/cutoff pairs and stale marks.
An identical full run writes zero rows. `equityCurve(store, manifestId)` reads
initial cash and committed close valuations. Annualized performance belongs to
the benchmark's native-finance convention layer, not this package.
