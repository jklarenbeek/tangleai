# Graph vector scale

Report `3b619bc02c3b20f849997d135e2dda96b9a60e6a453ef3af979d63dcb61710cd`; dated receipt `754104dfea90d94463afdf036c32864c34091d84321ff6f9cfea81fd3217ba8a` (2026-11-06T15:31:48.268Z).

Released trigger: 0.40.0 at `2be71c633567e6f1e0598fdc6543259862318013`. The registered target remains complete hybrid p95 ≤ 250 ms at 10,000 source chunks, with 64-dimensional embeddings.

Status: **measured**. Native qualification: **parity-passed**. Decision: **restore-sweep**.

- Complete native hybrid p95 at 10,000 chunks does not meet the registered 250 ms target.

| Source chunks | Entities | Relations | Backend | Complete p50 ms | Complete p95 ms | Peak process RSS bytes |
| ---: | ---: | ---: | --- | ---: | ---: | ---: |
| 100 | 200 | 100 | resident | 11.47 | 14.65 | 571121664 |
| 100 | 200 | 100 | sqlite-sweep | 24.80 | 31.62 | 571121664 |
| 100 | 200 | 100 | sqlite-native | 30.94 | 42.56 | 571121664 |
| 1000 | 2000 | 1000 | resident | 80.40 | 83.78 | 1977839616 |
| 1000 | 2000 | 1000 | sqlite-sweep | 176.24 | 185.22 | 1977839616 |
| 1000 | 2000 | 1000 | sqlite-native | 204.56 | 216.25 | 1982406656 |
| 10000 | 20000 | 10000 | resident | 1060.98 | 1261.98 | 8203251712 |
| 10000 | 20000 | 10000 | sqlite-sweep | 2733.30 | 3292.97 | 8293072896 |
| 10000 | 20000 | 10000 | sqlite-native | 3021.81 | 3925.50 | 8293072896 |

The resident oracle reads a detached snapshot of the exact same prepared corpus. Every result is compared, including ordered scores, all rejected candidates, context, citations and graph revision; only timing fields are excluded.

Golden ranking: passed. Seeded random overlap: 11 across 16 probes (registered band 0–32).

Native qualification: 160 seeded rank cases, 8 golden cases, 4 typed-array comparisons, 4 refused probes, 2 no-column fallbacks, 216 complete retrieval comparisons and 2 revision-fence cases. Actual diversions: 0.

Every raw sample is retained in the dated receipt. Fetch time measures awaited store reads, including decoding and projection. Ranking time measures the ranking phase minus its awaited store reads. Complete time surrounds the entire retrieval call, including final validation and copying. SQLite counters measure rows actually delivered by statements, not pages scanned; their elapsed time is nested within fetch time. RSS is the process lifetime high-water mark.

| Source chunks | Prepare ms | Promote ms | Resident snapshot ms | Sweep files bytes | Native files bytes | 64-D migration ms | Embedding calls | Embedded texts |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 969.05 | 5609.98 | 56.44 | 5836800 | 5836800 | 328.15 | 15 | 400 |
| 1000 | 9104.71 | 61580.88 | 504.83 | 42639360 | 42639360 | 536.51 | 127 | 4000 |
| 10000 | 315613.75 | 787133.18 | 6448.71 | 411860992 | 411860992 | 2286.60 | 1251 | 40000 |

Sweep and native storage are sampled with all database handles closed, before and after the 64-dimensional backfill. Sizes include any retained database, write-ahead log and shared-memory files. Native migrations include their real shadow validation, DDL and backfill; write counters and all physical samples remain in the receipt.

| Source chunks | Add 128-D column ms | Initialize stage ms | Prepare full stage ms | Total stage ms | Copied rows | Stage writes | Stage embedding calls | Stage file bytes |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 346.41 | 7036.37 | 12902.35 | 20354.16 | 1003 | 2317 | 15 | 17672336 |
| 1000 | 439.40 | 77731.44 | 151248.54 | 229487.93 | 10003 | 23017 | 127 | 158622344 |
| 10000 | 2219.39 | 924183.17 | 1870774.45 | 2797299.99 | 100003 | 230017 | 1251 | 1568586512 |

The isolated 128-dimensional stage prepares every source through the existing document and graph owners, then explicitly abandons its primary reservation. It does not swap the live benchmark corpus. Staging file sizes are sampled before the staging handle closes and include its journal files; the receipt retains the full operation counters and journal digest. Atomic swap, exact zero-embedding rollback and disposal are separately qualified by the migration tests and disposable example.

Physical provider requests: 0. Untriggered corpora: memory, documents, locomo, ledger.

Runtime: v24.20.0; linux/x64; AMD Ryzen 9 5900HX with Radeon Graphics; 16 logical CPUs. Operational clocks and host data do not enter the canonical report identity.
