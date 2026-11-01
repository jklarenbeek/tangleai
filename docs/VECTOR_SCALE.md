# Graph vector scale

Report `ba4029ad2abcb296e8eda4d2a55faa6535fd9561341c41ae37a875369de71344`; dated receipt `af5c9d9f1a4eb11d4b3039a35ec41977ef9e4553da69a60acc91a4fbdd1166c8` (2026-11-01T10:11:44.904Z).

Released trigger: 0.40.0 at `2be71c633567e6f1e0598fdc6543259862318013`. The registered target remains complete hybrid p95 ≤ 250 ms at 10,000 source chunks, with 64-dimensional embeddings.

Status: **measured**. Native qualification: **parity-passed**. Decision: **restore-sweep**.

- Complete native hybrid p95 at 10,000 chunks does not meet the registered 250 ms target.

| Source chunks | Entities | Relations | Backend | Complete p50 ms | Complete p95 ms | Peak process RSS bytes |
| ---: | ---: | ---: | --- | ---: | ---: | ---: |
| 100 | 200 | 100 | resident | 9.81 | 14.03 | 559792128 |
| 100 | 200 | 100 | sqlite-sweep | 21.40 | 23.82 | 559792128 |
| 100 | 200 | 100 | sqlite-native | 25.12 | 31.88 | 559792128 |
| 1000 | 2000 | 1000 | resident | 78.03 | 82.45 | 1995821056 |
| 1000 | 2000 | 1000 | sqlite-sweep | 167.98 | 179.04 | 1995821056 |
| 1000 | 2000 | 1000 | sqlite-native | 195.97 | 210.22 | 2002362368 |
| 10000 | 20000 | 10000 | resident | 908.95 | 1029.97 | 8137629696 |
| 10000 | 20000 | 10000 | sqlite-sweep | 2199.54 | 2567.79 | 8420192256 |
| 10000 | 20000 | 10000 | sqlite-native | 2419.30 | 3146.62 | 8420192256 |

The resident oracle reads a detached snapshot of the exact same prepared corpus. Every result is compared, including ordered scores, all rejected candidates, context, citations and graph revision; only timing fields are excluded.

Golden ranking: passed. Seeded random overlap: 11 across 16 probes (registered band 0–32).

Native qualification: 160 seeded rank cases, 8 golden cases, 4 typed-array comparisons, 4 refused probes, 2 no-column fallbacks, 216 complete retrieval comparisons and 2 revision-fence cases. Actual diversions: 0.

Every raw sample is retained in the dated receipt. Fetch time measures awaited store reads, including decoding and projection. Ranking time measures the ranking phase minus its awaited store reads. Complete time surrounds the entire retrieval call, including final validation and copying. SQLite counters measure rows actually delivered by statements, not pages scanned; their elapsed time is nested within fetch time. RSS is the process lifetime high-water mark.

| Source chunks | Prepare ms | Promote ms | Resident snapshot ms | Sweep files bytes | Native files bytes | 64-D migration ms | Embedding calls | Embedded texts |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 696.39 | 5233.72 | 40.68 | 5836800 | 5836800 | 280.80 | 15 | 400 |
| 1000 | 8950.40 | 64107.54 | 501.49 | 42639360 | 42639360 | 409.41 | 127 | 4000 |
| 10000 | 297635.78 | 740497.32 | 5090.00 | 411860992 | 411860992 | 2147.63 | 1251 | 40000 |

Sweep and native storage are sampled with all database handles closed, before and after the 64-dimensional backfill. Sizes include any retained database, write-ahead log and shared-memory files. Native migrations include their real shadow validation, DDL and backfill; write counters and all physical samples remain in the receipt.

| Source chunks | Add 128-D column ms | Initialize stage ms | Prepare full stage ms | Total stage ms | Copied rows | Stage writes | Stage embedding calls | Stage file bytes |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 287.49 | 6362.41 | 11482.62 | 18200.27 | 1003 | 2317 | 15 | 17672336 |
| 1000 | 426.41 | 77679.07 | 151152.17 | 229320.89 | 10003 | 23017 | 127 | 158622344 |
| 10000 | 2468.58 | 1468952.99 | 2155526.45 | 3627082.99 | 100003 | 230017 | 1251 | 1568586512 |

The isolated 128-dimensional stage prepares every source through the existing document and graph owners, then explicitly abandons its primary reservation. It does not swap the live benchmark corpus. Staging file sizes are sampled before the staging handle closes and include its journal files; the receipt retains the full operation counters and journal digest. Atomic swap, exact zero-embedding rollback and disposal are separately qualified by the migration tests and disposable example.

Physical provider requests: 0. Untriggered corpora: memory, documents, locomo, ledger.

Runtime: v24.20.0; linux/x64; AMD Ryzen 9 5900HX with Radeon Graphics; 16 logical CPUs. Operational clocks and host data do not enter the canonical report identity.
