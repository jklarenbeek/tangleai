# Graph vector scale

Report `27bd953cf23b66a956cb46c32946b699b274a7d04dd326b6a930dd1f6de97994`; dated receipt `fecfea89fde43904b3cf8433b45de9c58378936b79f141555a3c9ca1ff6e75e7` (2026-10-09T15:43:20.389Z).

Released trigger: 0.40.0 at `2be71c633567e6f1e0598fdc6543259862318013`. The registered target remains complete hybrid p95 ≤ 250 ms at 10,000 source chunks, with 64-dimensional embeddings.

Status: **measured**. Native qualification: **parity-passed**. Decision: **restore-sweep**.

- Complete native hybrid p95 at 10,000 chunks does not meet the registered 250 ms target.

| Source chunks | Entities | Relations | Backend | Complete p50 ms | Complete p95 ms | Peak process RSS bytes |
| ---: | ---: | ---: | --- | ---: | ---: | ---: |
| 100 | 200 | 100 | resident | 9.56 | 11.38 | 532525056 |
| 100 | 200 | 100 | sqlite-sweep | 27.40 | 29.66 | 533282816 |
| 100 | 200 | 100 | sqlite-native | 31.64 | 36.39 | 538697728 |
| 1000 | 2000 | 1000 | resident | 70.25 | 76.49 | 1944850432 |
| 1000 | 2000 | 1000 | sqlite-sweep | 217.43 | 281.53 | 1944850432 |
| 1000 | 2000 | 1000 | sqlite-native | 240.74 | 249.25 | 1967439872 |
| 10000 | 20000 | 10000 | resident | 886.79 | 1138.19 | 8594423808 |
| 10000 | 20000 | 10000 | sqlite-sweep | 2741.81 | 2977.23 | 8893923328 |
| 10000 | 20000 | 10000 | sqlite-native | 2836.67 | 3112.47 | 8893923328 |

The resident oracle reads a detached snapshot of the exact same prepared corpus. Every result is compared, including ordered scores, all rejected candidates, context, citations and graph revision; only timing fields are excluded.

Golden ranking: passed. Seeded random overlap: 11 across 16 probes (registered band 0–32).

Native qualification: 160 seeded rank cases, 8 golden cases, 4 typed-array comparisons, 4 refused probes, 2 no-column fallbacks, 216 complete retrieval comparisons and 2 revision-fence cases. Actual diversions: 0.

Every raw sample is retained in the dated receipt. Fetch time measures awaited store reads, including decoding and projection. Ranking time measures the ranking phase minus its awaited store reads. Complete time surrounds the entire retrieval call, including final validation and copying. SQLite counters measure rows actually delivered by statements, not pages scanned; their elapsed time is nested within fetch time. RSS is the process lifetime high-water mark.

| Source chunks | Prepare ms | Promote ms | Resident snapshot ms | Sweep files bytes | Native files bytes | 64-D migration ms | Embedding calls | Embedded texts |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 610.90 | 4695.19 | 36.49 | 5836800 | 5836800 | 182.49 | 15 | 400 |
| 1000 | 8820.12 | 60715.37 | 477.84 | 42639360 | 42639360 | 298.99 | 127 | 4000 |
| 10000 | 291046.17 | 768812.62 | 5730.24 | 411860992 | 411860992 | 1855.70 | 1251 | 40000 |

Sweep and native storage are sampled with all database handles closed, before and after the 64-dimensional backfill. Sizes include any retained database, write-ahead log and shared-memory files. Native migrations include their real shadow validation, DDL and backfill; write counters and all physical samples remain in the receipt.

| Source chunks | Add 128-D column ms | Initialize stage ms | Prepare full stage ms | Total stage ms | Copied rows | Stage writes | Stage embedding calls | Stage file bytes |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 182.84 | 6353.78 | 10995.12 | 17580.75 | 1003 | 2317 | 15 | 17672336 |
| 1000 | 298.77 | 74564.65 | 165166.68 | 240080.31 | 10003 | 23017 | 127 | 158622344 |
| 10000 | 1731.04 | 844912.64 | 1801314.01 | 2648053.39 | 100003 | 230017 | 1251 | 1568586512 |

The isolated 128-dimensional stage prepares every source through the existing document and graph owners, then explicitly abandons its primary reservation. It does not swap the live benchmark corpus. Staging file sizes are sampled before the staging handle closes and include its journal files; the receipt retains the full operation counters and journal digest. Atomic swap, exact zero-embedding rollback and disposal are separately qualified by the migration tests and disposable example.

Physical provider requests: 0. Untriggered corpora: memory, documents, locomo, ledger.

Runtime: v24.20.0; linux/x64; AMD Ryzen 9 5900HX with Radeon Graphics; 16 logical CPUs. Operational clocks and host data do not enter the canonical report identity.
