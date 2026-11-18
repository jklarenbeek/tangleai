# Graph vector scale

Report `722ca3d42382f900b7270d2b6cb3df5cdd3007488f7fc22663ca90091406d91e`; dated receipt `79ead2404564b9104256690427b6e85de479c3664812cd0adca9bfe022f5f3f6` (2026-11-18T20:58:25.172Z).

Released trigger: 0.40.0 at `2be71c633567e6f1e0598fdc6543259862318013`. The registered target remains complete hybrid p95 ≤ 250 ms at 10,000 source chunks, with 64-dimensional embeddings.

Status: **measured**. Native qualification: **parity-passed**. Decision: **restore-sweep**.

- Complete native hybrid p95 at 10,000 chunks does not meet the registered 250 ms target.

| Source chunks | Entities | Relations | Backend | Complete p50 ms | Complete p95 ms | Peak process RSS bytes |
| ---: | ---: | ---: | --- | ---: | ---: | ---: |
| 100 | 200 | 100 | resident | 8.81 | 11.93 | 589307904 |
| 100 | 200 | 100 | sqlite-sweep | 20.52 | 24.08 | 589307904 |
| 100 | 200 | 100 | sqlite-native | 23.52 | 25.21 | 589307904 |
| 1000 | 2000 | 1000 | resident | 70.90 | 73.49 | 1962598400 |
| 1000 | 2000 | 1000 | sqlite-sweep | 156.87 | 191.27 | 1972928512 |
| 1000 | 2000 | 1000 | sqlite-native | 185.01 | 190.81 | 1988395008 |
| 10000 | 20000 | 10000 | resident | 870.92 | 1033.20 | 8403697664 |
| 10000 | 20000 | 10000 | sqlite-sweep | 1847.07 | 2096.64 | 8696672256 |
| 10000 | 20000 | 10000 | sqlite-native | 2100.28 | 2337.31 | 8696672256 |

The resident oracle reads a detached snapshot of the exact same prepared corpus. Every result is compared, including ordered scores, all rejected candidates, context, citations and graph revision; only timing fields are excluded.

Golden ranking: passed. Seeded random overlap: 11 across 16 probes (registered band 0–32).

Native qualification: 160 seeded rank cases, 8 golden cases, 4 typed-array comparisons, 4 refused probes, 2 no-column fallbacks, 216 complete retrieval comparisons and 2 revision-fence cases. Actual diversions: 0.

Every raw sample is retained in the dated receipt. Fetch time measures awaited store reads, including decoding and projection. Ranking time measures the ranking phase minus its awaited store reads. Complete time surrounds the entire retrieval call, including final validation and copying. SQLite counters measure rows actually delivered by statements, not pages scanned; their elapsed time is nested within fetch time. RSS is the process lifetime high-water mark.

| Source chunks | Prepare ms | Promote ms | Resident snapshot ms | Sweep files bytes | Native files bytes | 64-D migration ms | Embedding calls | Embedded texts |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 623.90 | 4364.50 | 42.78 | 5836800 | 5836800 | 266.96 | 15 | 400 |
| 1000 | 8349.94 | 55883.62 | 455.60 | 42639360 | 42639360 | 393.32 | 127 | 4000 |
| 10000 | 278405.44 | 650260.08 | 5198.26 | 411860992 | 411860992 | 2025.27 | 1251 | 40000 |

Sweep and native storage are sampled with all database handles closed, before and after the 64-dimensional backfill. Sizes include any retained database, write-ahead log and shared-memory files. Native migrations include their real shadow validation, DDL and backfill; write counters and all physical samples remain in the receipt.

| Source chunks | Add 128-D column ms | Initialize stage ms | Prepare full stage ms | Total stage ms | Copied rows | Stage writes | Stage embedding calls | Stage file bytes |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 283.23 | 5594.64 | 10044.74 | 15987.12 | 1003 | 2317 | 15 | 17672336 |
| 1000 | 426.22 | 70471.27 | 137911.16 | 208873.35 | 10003 | 23017 | 127 | 158622344 |
| 10000 | 1927.52 | 861772.38 | 1836622.50 | 2700420.27 | 100003 | 230017 | 1251 | 1568586512 |

The isolated 128-dimensional stage prepares every source through the existing document and graph owners, then explicitly abandons its primary reservation. It does not swap the live benchmark corpus. Staging file sizes are sampled before the staging handle closes and include its journal files; the receipt retains the full operation counters and journal digest. Atomic swap, exact zero-embedding rollback and disposal are separately qualified by the migration tests and disposable example.

Physical provider requests: 0. Untriggered corpora: memory, documents, locomo, ledger.

Runtime: v24.20.0; linux/x64; AMD Ryzen 9 5900HX with Radeon Graphics; 16 logical CPUs. Operational clocks and host data do not enter the canonical report identity.
