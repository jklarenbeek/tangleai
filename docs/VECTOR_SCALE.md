# Graph vector scale

Report `ee5843dccc117db782019e31aaf8034a9c4a58341d4c838372714108654c20e0`; dated receipt `838ea6302144a4252b70f80ada583f1be0d6ac9e12e2a7ad2dc1b62ea6fc086c` (2026-11-02T23:22:40.112Z).

Released trigger: 0.40.0 at `2be71c633567e6f1e0598fdc6543259862318013`. The registered target remains complete hybrid p95 ≤ 250 ms at 10,000 source chunks, with 64-dimensional embeddings.

Status: **measured**. Native qualification: **parity-passed**. Decision: **restore-sweep**.

- Complete native hybrid p95 at 10,000 chunks does not meet the registered 250 ms target.

| Source chunks | Entities | Relations | Backend | Complete p50 ms | Complete p95 ms | Peak process RSS bytes |
| ---: | ---: | ---: | --- | ---: | ---: | ---: |
| 100 | 200 | 100 | resident | 9.04 | 13.04 | 589774848 |
| 100 | 200 | 100 | sqlite-sweep | 20.60 | 25.26 | 589774848 |
| 100 | 200 | 100 | sqlite-native | 23.45 | 28.23 | 590061568 |
| 1000 | 2000 | 1000 | resident | 79.88 | 82.43 | 1935781888 |
| 1000 | 2000 | 1000 | sqlite-sweep | 157.05 | 172.15 | 1935781888 |
| 1000 | 2000 | 1000 | sqlite-native | 183.30 | 220.29 | 1935781888 |
| 10000 | 20000 | 10000 | resident | 871.75 | 1078.69 | 8390750208 |
| 10000 | 20000 | 10000 | sqlite-sweep | 2138.26 | 2404.84 | 8645906432 |
| 10000 | 20000 | 10000 | sqlite-native | 2272.46 | 2616.19 | 8645906432 |

The resident oracle reads a detached snapshot of the exact same prepared corpus. Every result is compared, including ordered scores, all rejected candidates, context, citations and graph revision; only timing fields are excluded.

Golden ranking: passed. Seeded random overlap: 11 across 16 probes (registered band 0–32).

Native qualification: 160 seeded rank cases, 8 golden cases, 4 typed-array comparisons, 4 refused probes, 2 no-column fallbacks, 216 complete retrieval comparisons and 2 revision-fence cases. Actual diversions: 0.

Every raw sample is retained in the dated receipt. Fetch time measures awaited store reads, including decoding and projection. Ranking time measures the ranking phase minus its awaited store reads. Complete time surrounds the entire retrieval call, including final validation and copying. SQLite counters measure rows actually delivered by statements, not pages scanned; their elapsed time is nested within fetch time. RSS is the process lifetime high-water mark.

| Source chunks | Prepare ms | Promote ms | Resident snapshot ms | Sweep files bytes | Native files bytes | 64-D migration ms | Embedding calls | Embedded texts |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 644.08 | 4365.62 | 41.09 | 5836800 | 5836800 | 260.84 | 15 | 400 |
| 1000 | 8742.85 | 57689.77 | 496.98 | 42639360 | 42639360 | 394.02 | 127 | 4000 |
| 10000 | 289326.25 | 663684.19 | 5588.58 | 411860992 | 411860992 | 2037.82 | 1251 | 40000 |

Sweep and native storage are sampled with all database handles closed, before and after the 64-dimensional backfill. Sizes include any retained database, write-ahead log and shared-memory files. Native migrations include their real shadow validation, DDL and backfill; write counters and all physical samples remain in the receipt.

| Source chunks | Add 128-D column ms | Initialize stage ms | Prepare full stage ms | Total stage ms | Copied rows | Stage writes | Stage embedding calls | Stage file bytes |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 277.87 | 5612.61 | 10195.77 | 16150.85 | 1003 | 2317 | 15 | 17672336 |
| 1000 | 422.79 | 71930.37 | 140160.05 | 212574.75 | 10003 | 23017 | 127 | 158622344 |
| 10000 | 1977.72 | 876439.56 | 1864030.23 | 2742563.89 | 100003 | 230017 | 1251 | 1568586512 |

The isolated 128-dimensional stage prepares every source through the existing document and graph owners, then explicitly abandons its primary reservation. It does not swap the live benchmark corpus. Staging file sizes are sampled before the staging handle closes and include its journal files; the receipt retains the full operation counters and journal digest. Atomic swap, exact zero-embedding rollback and disposal are separately qualified by the migration tests and disposable example.

Physical provider requests: 0. Untriggered corpora: memory, documents, locomo, ledger.

Runtime: v24.20.0; linux/x64; AMD Ryzen 9 5900HX with Radeon Graphics; 16 logical CPUs. Operational clocks and host data do not enter the canonical report identity.
