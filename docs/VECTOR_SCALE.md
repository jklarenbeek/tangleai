# Graph vector scale

Report `faad0ad39d25fd841088f66cd229c2494c928a2d1549d618828a5fe5b09c27a8`; dated receipt `7f25f732845a3fa1f98dc47d841717eb3864ef9dbc94064a37914cc65c8d17a1` (2026-10-31T14:26:46.426Z).

Released trigger: 0.40.0 at `2be71c633567e6f1e0598fdc6543259862318013`. The registered target remains complete hybrid p95 ≤ 250 ms at 10,000 source chunks, with 64-dimensional embeddings.

Status: **measured**. Native qualification: **parity-passed**. Decision: **restore-sweep**.

- Complete native hybrid p95 at 10,000 chunks does not meet the registered 250 ms target.

| Source chunks | Entities | Relations | Backend | Complete p50 ms | Complete p95 ms | Peak process RSS bytes |
| ---: | ---: | ---: | --- | ---: | ---: | ---: |
| 100 | 200 | 100 | resident | 11.45 | 14.24 | 564789248 |
| 100 | 200 | 100 | sqlite-sweep | 24.15 | 31.19 | 564789248 |
| 100 | 200 | 100 | sqlite-native | 28.98 | 40.02 | 564789248 |
| 1000 | 2000 | 1000 | resident | 75.91 | 79.53 | 1922064384 |
| 1000 | 2000 | 1000 | sqlite-sweep | 160.47 | 172.44 | 1922064384 |
| 1000 | 2000 | 1000 | sqlite-native | 185.64 | 191.77 | 1923145728 |
| 10000 | 20000 | 10000 | resident | 1071.74 | 1205.99 | 8129896448 |
| 10000 | 20000 | 10000 | sqlite-sweep | 2675.76 | 3006.32 | 8377704448 |
| 10000 | 20000 | 10000 | sqlite-native | 2430.35 | 3376.54 | 8377704448 |

The resident oracle reads a detached snapshot of the exact same prepared corpus. Every result is compared, including ordered scores, all rejected candidates, context, citations and graph revision; only timing fields are excluded.

Golden ranking: passed. Seeded random overlap: 11 across 16 probes (registered band 0–32).

Native qualification: 160 seeded rank cases, 8 golden cases, 4 typed-array comparisons, 4 refused probes, 2 no-column fallbacks, 216 complete retrieval comparisons and 2 revision-fence cases. Actual diversions: 0.

Every raw sample is retained in the dated receipt. Fetch time measures awaited store reads, including decoding and projection. Ranking time measures the ranking phase minus its awaited store reads. Complete time surrounds the entire retrieval call, including final validation and copying. SQLite counters measure rows actually delivered by statements, not pages scanned; their elapsed time is nested within fetch time. RSS is the process lifetime high-water mark.

| Source chunks | Prepare ms | Promote ms | Resident snapshot ms | Sweep files bytes | Native files bytes | 64-D migration ms | Embedding calls | Embedded texts |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 772.74 | 5728.62 | 49.02 | 5836800 | 5836800 | 292.36 | 15 | 400 |
| 1000 | 10037.26 | 62366.90 | 486.38 | 42639360 | 42639360 | 392.26 | 127 | 4000 |
| 10000 | 323935.89 | 773585.55 | 6215.88 | 411860992 | 411860992 | 2439.39 | 1251 | 40000 |

Sweep and native storage are sampled with all database handles closed, before and after the 64-dimensional backfill. Sizes include any retained database, write-ahead log and shared-memory files. Native migrations include their real shadow validation, DDL and backfill; write counters and all physical samples remain in the receipt.

| Source chunks | Add 128-D column ms | Initialize stage ms | Prepare full stage ms | Total stage ms | Copied rows | Stage writes | Stage embedding calls | Stage file bytes |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 355.18 | 6854.67 | 12293.83 | 19572.26 | 1003 | 2317 | 15 | 17672336 |
| 1000 | 410.67 | 79194.42 | 162403.84 | 242072.70 | 10003 | 23017 | 127 | 158622344 |
| 10000 | 1956.92 | 968405.84 | 2428934.23 | 3399437.66 | 100003 | 230017 | 1251 | 1568586512 |

The isolated 128-dimensional stage prepares every source through the existing document and graph owners, then explicitly abandons its primary reservation. It does not swap the live benchmark corpus. Staging file sizes are sampled before the staging handle closes and include its journal files; the receipt retains the full operation counters and journal digest. Atomic swap, exact zero-embedding rollback and disposal are separately qualified by the migration tests and disposable example.

Physical provider requests: 0. Untriggered corpora: memory, documents, locomo, ledger.

Runtime: v24.20.0; linux/x64; AMD Ryzen 9 5900HX with Radeon Graphics; 16 logical CPUs. Operational clocks and host data do not enter the canonical report identity.
