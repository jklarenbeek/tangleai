# @tangleai/trading

Closed trading records, point-in-time admission and atomic simulated portfolio
persistence. Importing the package performs no filesystem, network or database
work. Hosts supply market observations and a store; the package has no live
broker connection.

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
accounting control, not a feasible trading result. The current package stores
and validates simulated state; provider orchestration and strategy execution
are outside this surface.
