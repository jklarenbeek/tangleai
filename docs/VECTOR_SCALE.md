# Graph vector scale

Report `9e52feda76e34eb071817a1ce2043c1c6b35593f87d1a0dfa50c08ffd54b3c22`; dated receipt `334ec710c9e9782d14e13ff0bcbc32dfdd3f0a035676af5e5b0c9b0a75b3f7ed` (2026-10-20T04:40:11.110Z).

Released trigger: 0.40.0 at `2be71c633567e6f1e0598fdc6543259862318013`. The registered target remains complete hybrid p95 ≤ 250 ms at 10,000 source chunks, with 64-dimensional embeddings.

Status: **measured**. Native qualification: **parity-passed**. Decision: **restore-sweep**.

- Complete native hybrid p95 at 10,000 chunks does not meet the registered 250 ms target.

| Source chunks | Entities | Relations | Backend | Complete p50 ms | Complete p95 ms | Peak process RSS bytes |
| ---: | ---: | ---: | --- | ---: | ---: | ---: |
| 100 | 200 | 100 | resident | 11.19 | 15.74 | 516194304 |
| 100 | 200 | 100 | sqlite-sweep | 30.13 | 36.24 | 536555520 |
| 100 | 200 | 100 | sqlite-native | 37.21 | 44.32 | 545742848 |
| 1000 | 2000 | 1000 | resident | 88.95 | 105.63 | 1980858368 |
| 1000 | 2000 | 1000 | sqlite-sweep | 281.83 | 301.56 | 1980858368 |
| 1000 | 2000 | 1000 | sqlite-native | 303.97 | 439.61 | 1980858368 |
| 10000 | 20000 | 10000 | resident | 995.42 | 1310.41 | 8387833856 |
| 10000 | 20000 | 10000 | sqlite-sweep | 4384.46 | 6321.13 | 8631902208 |
| 10000 | 20000 | 10000 | sqlite-native | 4779.28 | 5513.07 | 8631902208 |

The resident oracle reads a detached snapshot of the exact same prepared corpus. Every result is compared, including ordered scores, all rejected candidates, context, citations and graph revision; only timing fields are excluded.

Golden ranking: passed. Seeded random overlap: 11 across 16 probes (registered band 0–32).

Native qualification: 160 seeded rank cases, 8 golden cases, 4 typed-array comparisons, 4 refused probes, 2 no-column fallbacks, 216 complete retrieval comparisons and 2 revision-fence cases. Actual diversions: 0.

Every raw sample is retained in the dated receipt. Fetch time measures awaited store reads, including decoding and projection. Ranking time measures the ranking phase minus its awaited store reads. Complete time surrounds the entire retrieval call, including final validation and copying. SQLite counters measure rows actually delivered by statements, not pages scanned; their elapsed time is nested within fetch time. RSS is the process lifetime high-water mark.

| Source chunks | Prepare ms | Promote ms | Resident snapshot ms | Sweep files bytes | Native files bytes | 64-D migration ms | Embedding calls | Embedded texts |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 922.76 | 6000.56 | 48.78 | 5836800 | 5836800 | 277.29 | 15 | 400 |
| 1000 | 13066.36 | 76978.06 | 618.49 | 42639360 | 42639360 | 389.89 | 127 | 4000 |
| 10000 | 336005.42 | 942077.25 | 6884.12 | 411860992 | 411860992 | 2698.16 | 1251 | 40000 |

Sweep and native storage are sampled with all database handles closed, before and after the 64-dimensional backfill. Sizes include any retained database, write-ahead log and shared-memory files. Native migrations include their real shadow validation, DDL and backfill; write counters and all physical samples remain in the receipt.

| Source chunks | Add 128-D column ms | Initialize stage ms | Prepare full stage ms | Total stage ms | Copied rows | Stage writes | Stage embedding calls | Stage file bytes |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 217.37 | 8359.48 | 15370.29 | 24004.31 | 1003 | 2317 | 15 | 17672336 |
| 1000 | 385.52 | 100863.95 | 206041.40 | 307353.07 | 10003 | 23017 | 127 | 158622344 |
| 10000 | 2546.41 | 1282512.91 | 2772522.41 | 4057859.98 | 100003 | 230017 | 1251 | 1568586512 |

The isolated 128-dimensional stage prepares every source through the existing document and graph owners, then explicitly abandons its primary reservation. It does not swap the live benchmark corpus. Staging file sizes are sampled before the staging handle closes and include its journal files; the receipt retains the full operation counters and journal digest. Atomic swap, exact zero-embedding rollback and disposal are separately qualified by the migration tests and disposable example.

Physical provider requests: 0. Untriggered corpora: memory, documents, locomo, ledger.

Runtime: v24.20.0; linux/x64; Intel(R) Xeon(R) Processor @ 2.10GHz; 4 logical CPUs. Operational clocks and host data do not enter the canonical report identity.
