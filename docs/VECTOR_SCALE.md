# Graph vector scale

Report `f30dd88490ca7659d9822e0cc414f407f179b0753104ef6cab6d91d41c74a619`; dated receipt `61003dbea70a35663ef64455136914a7c369173aae961cb6ac6fb304fda5b94c` (2026-11-04T21:13:10.138Z).

Released trigger: 0.40.0 at `2be71c633567e6f1e0598fdc6543259862318013`. The registered target remains complete hybrid p95 ≤ 250 ms at 10,000 source chunks, with 64-dimensional embeddings.

Status: **measured**. Native qualification: **parity-passed**. Decision: **restore-sweep**.

- Complete native hybrid p95 at 10,000 chunks does not meet the registered 250 ms target.

| Source chunks | Entities | Relations | Backend | Complete p50 ms | Complete p95 ms | Peak process RSS bytes |
| ---: | ---: | ---: | --- | ---: | ---: | ---: |
| 100 | 200 | 100 | resident | 12.17 | 15.15 | 570163200 |
| 100 | 200 | 100 | sqlite-sweep | 24.18 | 30.09 | 570163200 |
| 100 | 200 | 100 | sqlite-native | 26.67 | 29.91 | 570163200 |
| 1000 | 2000 | 1000 | resident | 79.94 | 85.47 | 2328252416 |
| 1000 | 2000 | 1000 | sqlite-sweep | 172.43 | 183.51 | 2328252416 |
| 1000 | 2000 | 1000 | sqlite-native | 200.46 | 208.03 | 2328252416 |
| 10000 | 20000 | 10000 | resident | 1028.22 | 1164.03 | 8372015104 |
| 10000 | 20000 | 10000 | sqlite-sweep | 2509.90 | 3041.94 | 8372015104 |
| 10000 | 20000 | 10000 | sqlite-native | 2598.00 | 3040.25 | 8373022720 |

The resident oracle reads a detached snapshot of the exact same prepared corpus. Every result is compared, including ordered scores, all rejected candidates, context, citations and graph revision; only timing fields are excluded.

Golden ranking: passed. Seeded random overlap: 11 across 16 probes (registered band 0–32).

Native qualification: 160 seeded rank cases, 8 golden cases, 4 typed-array comparisons, 4 refused probes, 2 no-column fallbacks, 216 complete retrieval comparisons and 2 revision-fence cases. Actual diversions: 0.

Every raw sample is retained in the dated receipt. Fetch time measures awaited store reads, including decoding and projection. Ranking time measures the ranking phase minus its awaited store reads. Complete time surrounds the entire retrieval call, including final validation and copying. SQLite counters measure rows actually delivered by statements, not pages scanned; their elapsed time is nested within fetch time. RSS is the process lifetime high-water mark.

| Source chunks | Prepare ms | Promote ms | Resident snapshot ms | Sweep files bytes | Native files bytes | 64-D migration ms | Embedding calls | Embedded texts |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 668.44 | 4826.58 | 48.15 | 5836800 | 5836800 | 297.07 | 15 | 400 |
| 1000 | 8634.53 | 59441.38 | 485.24 | 42639360 | 42639360 | 422.80 | 127 | 4000 |
| 10000 | 312886.54 | 757240.74 | 6221.35 | 411860992 | 411860992 | 2432.29 | 1251 | 40000 |

Sweep and native storage are sampled with all database handles closed, before and after the 64-dimensional backfill. Sizes include any retained database, write-ahead log and shared-memory files. Native migrations include their real shadow validation, DDL and backfill; write counters and all physical samples remain in the receipt.

| Source chunks | Add 128-D column ms | Initialize stage ms | Prepare full stage ms | Total stage ms | Copied rows | Stage writes | Stage embedding calls | Stage file bytes |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 331.45 | 5983.92 | 10435.36 | 16816.93 | 1003 | 2317 | 15 | 17672336 |
| 1000 | 432.21 | 75313.26 | 147367.88 | 223177.53 | 10003 | 23017 | 127 | 158622344 |
| 10000 | 2260.60 | 1378389.03 | 1922067.44 | 3302819.81 | 100003 | 230017 | 1251 | 1568586512 |

The isolated 128-dimensional stage prepares every source through the existing document and graph owners, then explicitly abandons its primary reservation. It does not swap the live benchmark corpus. Staging file sizes are sampled before the staging handle closes and include its journal files; the receipt retains the full operation counters and journal digest. Atomic swap, exact zero-embedding rollback and disposal are separately qualified by the migration tests and disposable example.

Physical provider requests: 0. Untriggered corpora: memory, documents, locomo, ledger.

Runtime: v24.20.0; linux/x64; AMD Ryzen 9 5900HX with Radeon Graphics; 16 logical CPUs. Operational clocks and host data do not enter the canonical report identity.
