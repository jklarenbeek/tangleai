# @tangleai/trading

Closed trading records, point-in-time providers, deterministic signals and
atomic simulated portfolio persistence. Importing the package performs no
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
double-entry ledger postings and the resulting portfolio. The shared planner
checks scope, next-session execution, the predecessor, balanced postings and
the exact cash, quantity, cost-basis and valuation transition. Whole-share,
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
| `TTRD1005` | Unsupported execution form |
| `TTRD1006` | Conflicting replay, ledger or portfolio transition |
| `TTRD1007` | Provider failure or unavailability |
| `TTRD1008` | Stage protocol violation |
| `TTRD1009` | Budget or execution eligibility |

The registered [trading instrument](../../docs/TRADING_BENCHMARK.md) derives
controls from an original synthetic fixture. Its privileged oracle is an
accounting control, not a feasible trading result. The instrument measures
indicator vectors and baseline signal crossings separately from execution
returns. Shared broker simulation and model-driven strategy execution remain
outside this surface.
