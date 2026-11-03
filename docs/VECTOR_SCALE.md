# Graph vector scale

Report `68befd1af5661d2db3960396125860be7d5d3f460c5a0b85cd698858c425deaa`; dated receipt `ee05a6a6cf75286db97b25b59d113c64a25bb21523e1ccb460b9fb6f4c0a72b7` (2026-11-03T12:55:30.091Z).

Released trigger: 0.40.0 at `2be71c633567e6f1e0598fdc6543259862318013`. The registered target remains complete hybrid p95 ≤ 250 ms at 10,000 source chunks, with 64-dimensional embeddings.

Status: **measured**. Native qualification: **parity-passed**. Decision: **restore-sweep**.

- Complete native hybrid p95 at 10,000 chunks does not meet the registered 250 ms target.

| Source chunks | Entities | Relations | Backend | Complete p50 ms | Complete p95 ms | Peak process RSS bytes |
| ---: | ---: | ---: | --- | ---: | ---: | ---: |
| 100 | 200 | 100 | resident | 9.24 | 12.00 | 584810496 |
| 100 | 200 | 100 | sqlite-sweep | 20.14 | 24.65 | 584810496 |
| 100 | 200 | 100 | sqlite-native | 23.47 | 27.05 | 584810496 |
| 1000 | 2000 | 1000 | resident | 72.76 | 76.34 | 1926324224 |
| 1000 | 2000 | 1000 | sqlite-sweep | 161.29 | 202.55 | 1940209664 |
| 1000 | 2000 | 1000 | sqlite-native | 194.25 | 239.94 | 1940209664 |
| 10000 | 20000 | 10000 | resident | 896.58 | 1147.55 | 8395546624 |
| 10000 | 20000 | 10000 | sqlite-sweep | 2359.18 | 2575.47 | 8657694720 |
| 10000 | 20000 | 10000 | sqlite-native | 2705.24 | 3216.59 | 8657694720 |

The resident oracle reads a detached snapshot of the exact same prepared corpus. Every result is compared, including ordered scores, all rejected candidates, context, citations and graph revision; only timing fields are excluded.

Golden ranking: passed. Seeded random overlap: 11 across 16 probes (registered band 0–32).

Native qualification: 160 seeded rank cases, 8 golden cases, 4 typed-array comparisons, 4 refused probes, 2 no-column fallbacks, 216 complete retrieval comparisons and 2 revision-fence cases. Actual diversions: 0.

Every raw sample is retained in the dated receipt. Fetch time measures awaited store reads, including decoding and projection. Ranking time measures the ranking phase minus its awaited store reads. Complete time surrounds the entire retrieval call, including final validation and copying. SQLite counters measure rows actually delivered by statements, not pages scanned; their elapsed time is nested within fetch time. RSS is the process lifetime high-water mark.

| Source chunks | Prepare ms | Promote ms | Resident snapshot ms | Sweep files bytes | Native files bytes | 64-D migration ms | Embedding calls | Embedded texts |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 623.10 | 4336.67 | 42.34 | 5836800 | 5836800 | 264.99 | 15 | 400 |
| 1000 | 8580.04 | 57861.02 | 472.14 | 42639360 | 42639360 | 407.96 | 127 | 4000 |
| 10000 | 296591.26 | 684895.00 | 5906.42 | 411860992 | 411860992 | 2126.64 | 1251 | 40000 |

Sweep and native storage are sampled with all database handles closed, before and after the 64-dimensional backfill. Sizes include any retained database, write-ahead log and shared-memory files. Native migrations include their real shadow validation, DDL and backfill; write counters and all physical samples remain in the receipt.

| Source chunks | Add 128-D column ms | Initialize stage ms | Prepare full stage ms | Total stage ms | Copied rows | Stage writes | Stage embedding calls | Stage file bytes |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 330.19 | 5636.29 | 10173.21 | 16202.21 | 1003 | 2317 | 15 | 17672336 |
| 1000 | 430.44 | 73481.28 | 143059.41 | 217035.72 | 10003 | 23017 | 127 | 158622344 |
| 10000 | 2103.76 | 917812.95 | 1854781.47 | 2774859.83 | 100003 | 230017 | 1251 | 1568586512 |

The isolated 128-dimensional stage prepares every source through the existing document and graph owners, then explicitly abandons its primary reservation. It does not swap the live benchmark corpus. Staging file sizes are sampled before the staging handle closes and include its journal files; the receipt retains the full operation counters and journal digest. Atomic swap, exact zero-embedding rollback and disposal are separately qualified by the migration tests and disposable example.

Physical provider requests: 0. Untriggered corpora: memory, documents, locomo, ledger.

Runtime: v24.20.0; linux/x64; AMD Ryzen 9 5900HX with Radeon Graphics; 16 logical CPUs. Operational clocks and host data do not enter the canonical report identity.
