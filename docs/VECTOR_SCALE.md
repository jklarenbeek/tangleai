# Graph vector scale

Report `36f9163a95a1b541701dc5b4ff0c33c90aa8515a479773e6f14c74c2c833e9f8`; dated receipt `c3a0251cab5dbe6e90fb14436f61a466aebc18794dd3082c2a128ebe7fdb3822` (2026-11-02T07:10:30.267Z).

Released trigger: 0.40.0 at `2be71c633567e6f1e0598fdc6543259862318013`. The registered target remains complete hybrid p95 ≤ 250 ms at 10,000 source chunks, with 64-dimensional embeddings.

Status: **measured**. Native qualification: **parity-passed**. Decision: **restore-sweep**.

- Complete native hybrid p95 at 10,000 chunks does not meet the registered 250 ms target.

| Source chunks | Entities | Relations | Backend | Complete p50 ms | Complete p95 ms | Peak process RSS bytes |
| ---: | ---: | ---: | --- | ---: | ---: | ---: |
| 100 | 200 | 100 | resident | 9.12 | 13.08 | 571686912 |
| 100 | 200 | 100 | sqlite-sweep | 19.69 | 22.14 | 571686912 |
| 100 | 200 | 100 | sqlite-native | 23.09 | 28.93 | 571686912 |
| 1000 | 2000 | 1000 | resident | 80.43 | 85.40 | 1931608064 |
| 1000 | 2000 | 1000 | sqlite-sweep | 170.14 | 196.95 | 1931608064 |
| 1000 | 2000 | 1000 | sqlite-native | 215.81 | 246.63 | 1931608064 |
| 10000 | 20000 | 10000 | resident | 875.30 | 1096.57 | 8330084352 |
| 10000 | 20000 | 10000 | sqlite-sweep | 2097.25 | 2324.39 | 8580661248 |
| 10000 | 20000 | 10000 | sqlite-native | 2305.00 | 3498.18 | 8580661248 |

The resident oracle reads a detached snapshot of the exact same prepared corpus. Every result is compared, including ordered scores, all rejected candidates, context, citations and graph revision; only timing fields are excluded.

Golden ranking: passed. Seeded random overlap: 11 across 16 probes (registered band 0–32).

Native qualification: 160 seeded rank cases, 8 golden cases, 4 typed-array comparisons, 4 refused probes, 2 no-column fallbacks, 216 complete retrieval comparisons and 2 revision-fence cases. Actual diversions: 0.

Every raw sample is retained in the dated receipt. Fetch time measures awaited store reads, including decoding and projection. Ranking time measures the ranking phase minus its awaited store reads. Complete time surrounds the entire retrieval call, including final validation and copying. SQLite counters measure rows actually delivered by statements, not pages scanned; their elapsed time is nested within fetch time. RSS is the process lifetime high-water mark.

| Source chunks | Prepare ms | Promote ms | Resident snapshot ms | Sweep files bytes | Native files bytes | 64-D migration ms | Embedding calls | Embedded texts |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 622.13 | 4312.98 | 40.11 | 5836800 | 5836800 | 268.47 | 15 | 400 |
| 1000 | 9071.12 | 60007.88 | 547.49 | 42639360 | 42639360 | 431.47 | 127 | 4000 |
| 10000 | 290669.50 | 684283.10 | 5719.35 | 411860992 | 411860992 | 2258.85 | 1251 | 40000 |

Sweep and native storage are sampled with all database handles closed, before and after the 64-dimensional backfill. Sizes include any retained database, write-ahead log and shared-memory files. Native migrations include their real shadow validation, DDL and backfill; write counters and all physical samples remain in the receipt.

| Source chunks | Add 128-D column ms | Initialize stage ms | Prepare full stage ms | Total stage ms | Copied rows | Stage writes | Stage embedding calls | Stage file bytes |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 270.61 | 5424.38 | 9988.79 | 15752.66 | 1003 | 2317 | 15 | 17672336 |
| 1000 | 483.03 | 80074.94 | 145128.51 | 225760.26 | 10003 | 23017 | 127 | 158622344 |
| 10000 | 2255.44 | 902226.50 | 1869636.12 | 2774233.26 | 100003 | 230017 | 1251 | 1568586512 |

The isolated 128-dimensional stage prepares every source through the existing document and graph owners, then explicitly abandons its primary reservation. It does not swap the live benchmark corpus. Staging file sizes are sampled before the staging handle closes and include its journal files; the receipt retains the full operation counters and journal digest. Atomic swap, exact zero-embedding rollback and disposal are separately qualified by the migration tests and disposable example.

Physical provider requests: 0. Untriggered corpora: memory, documents, locomo, ledger.

Runtime: v24.20.0; linux/x64; AMD Ryzen 9 5900HX with Radeon Graphics; 16 logical CPUs. Operational clocks and host data do not enter the canonical report identity.
