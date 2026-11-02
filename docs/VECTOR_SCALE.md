# Graph vector scale

Report `c5070c2c1af887f5f1b3ef78db0a3e805c452d8d682ddaf505d49e53d5c195d2`; dated receipt `7b46d05551f9f1bd9b2c5f266e1e2e478da26c00930a61e1004f5d02678b4171` (2026-11-02T15:50:47.175Z).

Released trigger: 0.40.0 at `2be71c633567e6f1e0598fdc6543259862318013`. The registered target remains complete hybrid p95 ≤ 250 ms at 10,000 source chunks, with 64-dimensional embeddings.

Status: **measured**. Native qualification: **parity-passed**. Decision: **restore-sweep**.

- Complete native hybrid p95 at 10,000 chunks does not meet the registered 250 ms target.

| Source chunks | Entities | Relations | Backend | Complete p50 ms | Complete p95 ms | Peak process RSS bytes |
| ---: | ---: | ---: | --- | ---: | ---: | ---: |
| 100 | 200 | 100 | resident | 9.19 | 13.61 | 581009408 |
| 100 | 200 | 100 | sqlite-sweep | 21.34 | 25.92 | 581009408 |
| 100 | 200 | 100 | sqlite-native | 23.75 | 32.05 | 581009408 |
| 1000 | 2000 | 1000 | resident | 74.71 | 80.31 | 1961144320 |
| 1000 | 2000 | 1000 | sqlite-sweep | 167.28 | 180.26 | 1961144320 |
| 1000 | 2000 | 1000 | sqlite-native | 193.87 | 199.21 | 1961144320 |
| 10000 | 20000 | 10000 | resident | 945.37 | 1130.12 | 8358240256 |
| 10000 | 20000 | 10000 | sqlite-sweep | 2205.34 | 2909.58 | 8630075392 |
| 10000 | 20000 | 10000 | sqlite-native | 2316.37 | 2654.36 | 8630075392 |

The resident oracle reads a detached snapshot of the exact same prepared corpus. Every result is compared, including ordered scores, all rejected candidates, context, citations and graph revision; only timing fields are excluded.

Golden ranking: passed. Seeded random overlap: 11 across 16 probes (registered band 0–32).

Native qualification: 160 seeded rank cases, 8 golden cases, 4 typed-array comparisons, 4 refused probes, 2 no-column fallbacks, 216 complete retrieval comparisons and 2 revision-fence cases. Actual diversions: 0.

Every raw sample is retained in the dated receipt. Fetch time measures awaited store reads, including decoding and projection. Ranking time measures the ranking phase minus its awaited store reads. Complete time surrounds the entire retrieval call, including final validation and copying. SQLite counters measure rows actually delivered by statements, not pages scanned; their elapsed time is nested within fetch time. RSS is the process lifetime high-water mark.

| Source chunks | Prepare ms | Promote ms | Resident snapshot ms | Sweep files bytes | Native files bytes | 64-D migration ms | Embedding calls | Embedded texts |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 681.06 | 4519.71 | 41.06 | 5836800 | 5836800 | 270.02 | 15 | 400 |
| 1000 | 8887.60 | 58987.92 | 492.58 | 42639360 | 42639360 | 408.60 | 127 | 4000 |
| 10000 | 293448.47 | 690214.37 | 6241.16 | 411860992 | 411860992 | 2064.25 | 1251 | 40000 |

Sweep and native storage are sampled with all database handles closed, before and after the 64-dimensional backfill. Sizes include any retained database, write-ahead log and shared-memory files. Native migrations include their real shadow validation, DDL and backfill; write counters and all physical samples remain in the receipt.

| Source chunks | Add 128-D column ms | Initialize stage ms | Prepare full stage ms | Total stage ms | Copied rows | Stage writes | Stage embedding calls | Stage file bytes |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 276.64 | 5791.42 | 10476.30 | 16609.61 | 1003 | 2317 | 15 | 17672336 |
| 1000 | 428.44 | 73293.15 | 142869.29 | 216656.75 | 10003 | 23017 | 127 | 158622344 |
| 10000 | 1979.84 | 868421.93 | 2355866.68 | 3226386.06 | 100003 | 230017 | 1251 | 1568586512 |

The isolated 128-dimensional stage prepares every source through the existing document and graph owners, then explicitly abandons its primary reservation. It does not swap the live benchmark corpus. Staging file sizes are sampled before the staging handle closes and include its journal files; the receipt retains the full operation counters and journal digest. Atomic swap, exact zero-embedding rollback and disposal are separately qualified by the migration tests and disposable example.

Physical provider requests: 0. Untriggered corpora: memory, documents, locomo, ledger.

Runtime: v24.20.0; linux/x64; AMD Ryzen 9 5900HX with Radeon Graphics; 16 logical CPUs. Operational clocks and host data do not enter the canonical report identity.
