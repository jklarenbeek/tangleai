# Graph vector scale

Report `7b93feb37591698f2204d227c75af7c37b4dd3fa16e2744c235a9ab42a63939b`; dated receipt `d6cc85198075cc14289918c46ead3fd49f715eddc40f1848723b4ff9a4f83660` (2026-11-05T06:40:03.214Z).

Released trigger: 0.40.0 at `2be71c633567e6f1e0598fdc6543259862318013`. The registered target remains complete hybrid p95 ≤ 250 ms at 10,000 source chunks, with 64-dimensional embeddings.

Status: **measured**. Native qualification: **parity-passed**. Decision: **restore-sweep**.

- Complete native hybrid p95 at 10,000 chunks does not meet the registered 250 ms target.

| Source chunks | Entities | Relations | Backend | Complete p50 ms | Complete p95 ms | Peak process RSS bytes |
| ---: | ---: | ---: | --- | ---: | ---: | ---: |
| 100 | 200 | 100 | resident | 10.32 | 12.26 | 571850752 |
| 100 | 200 | 100 | sqlite-sweep | 22.43 | 27.70 | 571850752 |
| 100 | 200 | 100 | sqlite-native | 25.78 | 31.93 | 571850752 |
| 1000 | 2000 | 1000 | resident | 75.95 | 79.45 | 2095595520 |
| 1000 | 2000 | 1000 | sqlite-sweep | 175.06 | 188.67 | 2095595520 |
| 1000 | 2000 | 1000 | sqlite-native | 202.88 | 228.70 | 2109100032 |
| 10000 | 20000 | 10000 | resident | 969.77 | 1294.61 | 8397320192 |
| 10000 | 20000 | 10000 | sqlite-sweep | 2235.01 | 2613.34 | 8666058752 |
| 10000 | 20000 | 10000 | sqlite-native | 2417.06 | 2755.29 | 8666058752 |

The resident oracle reads a detached snapshot of the exact same prepared corpus. Every result is compared, including ordered scores, all rejected candidates, context, citations and graph revision; only timing fields are excluded.

Golden ranking: passed. Seeded random overlap: 11 across 16 probes (registered band 0–32).

Native qualification: 160 seeded rank cases, 8 golden cases, 4 typed-array comparisons, 4 refused probes, 2 no-column fallbacks, 216 complete retrieval comparisons and 2 revision-fence cases. Actual diversions: 0.

Every raw sample is retained in the dated receipt. Fetch time measures awaited store reads, including decoding and projection. Ranking time measures the ranking phase minus its awaited store reads. Complete time surrounds the entire retrieval call, including final validation and copying. SQLite counters measure rows actually delivered by statements, not pages scanned; their elapsed time is nested within fetch time. RSS is the process lifetime high-water mark.

| Source chunks | Prepare ms | Promote ms | Resident snapshot ms | Sweep files bytes | Native files bytes | 64-D migration ms | Embedding calls | Embedded texts |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 702.02 | 4578.07 | 43.00 | 5836800 | 5836800 | 284.49 | 15 | 400 |
| 1000 | 8722.53 | 59542.72 | 459.83 | 42639360 | 42639360 | 415.54 | 127 | 4000 |
| 10000 | 306095.79 | 718200.88 | 5992.82 | 411860992 | 411860992 | 2051.57 | 1251 | 40000 |

Sweep and native storage are sampled with all database handles closed, before and after the 64-dimensional backfill. Sizes include any retained database, write-ahead log and shared-memory files. Native migrations include their real shadow validation, DDL and backfill; write counters and all physical samples remain in the receipt.

| Source chunks | Add 128-D column ms | Initialize stage ms | Prepare full stage ms | Total stage ms | Copied rows | Stage writes | Stage embedding calls | Stage file bytes |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 303.55 | 5939.05 | 10326.50 | 16632.81 | 1003 | 2317 | 15 | 17672336 |
| 1000 | 439.08 | 75819.71 | 147642.70 | 223968.01 | 10003 | 23017 | 127 | 158622344 |
| 10000 | 1951.71 | 864161.17 | 1789022.95 | 2655238.72 | 100003 | 230017 | 1251 | 1568586512 |

The isolated 128-dimensional stage prepares every source through the existing document and graph owners, then explicitly abandons its primary reservation. It does not swap the live benchmark corpus. Staging file sizes are sampled before the staging handle closes and include its journal files; the receipt retains the full operation counters and journal digest. Atomic swap, exact zero-embedding rollback and disposal are separately qualified by the migration tests and disposable example.

Physical provider requests: 0. Untriggered corpora: memory, documents, locomo, ledger.

Runtime: v24.20.0; linux/x64; AMD Ryzen 9 5900HX with Radeon Graphics; 16 logical CPUs. Operational clocks and host data do not enter the canonical report identity.
