# JarenJS host strategy benchmark

Measured 2026-09-15 on linux/x64, JarenJS 0.90.6.
Reproduce with `npm run benchmark:jaren`. Instrument:
[benchmark/jaren-strategies.ts](../benchmark/jaren-strategies.ts).
Raw reports: [Node](../benchmark/results/jaren-strategies-node.json),
[Bun](../benchmark/results/jaren-strategies-bun.json).

Both strategies use the suite database and real in-memory SQLite: the previous
path loads all 5,000 synthetic run records, sorts them in JavaScript and keeps
50; the shipped path consumes an ordered database cursor and closes it after
50. IDs must match on every one of 25 timed repetitions, after one warm-up.
The cursor reports row streaming. Payloads and unique timestamps are fixed.

| Runtime | Previous p95 ms | Bounded p95 ms | p95 speedup | Host rows per read |
|---|---:|---:|---:|---:|
| node 24.20.0 | 14.881 | 9.114 | 1.63× | 5000 → 50 |
| bun 1.4.0 | 11.929 | 10.986 | 1.09× | 5000 → 50 |

The main gain is bounded host materialization. SQLite may still scan and sort
all rows: these are not visited-row counts or an index claim. Strategy order
is fixed; timings are a dated diagnostic, not a CI threshold. Bun's result is
published alongside Node's, including any regression or near parity. This comparison
measures neither persistent-disk throughput nor vector or model quality.

The refreshed keyless MAS report records 11/11 runtime
oracles, 7/7 registered refusals,
7/7 suite probes and
6/6 durability checks.
CONFIG records 45/45 holding cases.
See [MAS](MAS_RUNTIME_BENCHMARK.md), [grounding](GROUNDING_BENCHMARK.md),
[document chunking](DOCUMENT_BENCHMARK.md) and [LoCoMo](LOCOMO_BENCHMARK.md)
for their own definitions and denominators. The separately dated
[paid refresh](PAID_REFRESH.md) exercises the configured OpenRouter models;
historical paid runs retain their original identities and results.

The [integration audit](JARENJS_INTEGRATION.md) explains why the upstream
labelled retrieval measurements keep exact search and recursive chunking as
the defaults, and which published facilities apply to this host.
