# Training service protocol

`createHttpTrainingBackend` binds an injected HTTP transport to the five
operations in the [version 1 contract](../schemas/training-service.contract.json).
The wire reuses the same closed records as `TrainingBackend`.

| Operation | Request | Response |
| --- | --- | --- |
| `training.capabilities` | `GET /capabilities` | `TrainingCapabilities` |
| `training.submit` | `POST /jobs`, JSON `TrainingSpec` | `BackendJob` |
| `training.inspect` | `GET /jobs/{jobId}` | `BackendJobState` |
| `training.cancel` | `POST /jobs/{jobId}/cancel` | Terminal `BackendJobState` |
| `training.materialize` | `GET /jobs/{jobId}/artifact` | `ArtifactReceipt` |

Paths are relative to the service base, including its path prefix. Successful
responses are JSON with status 200. The native contract owns path encoding,
validation and required idempotency. A `serveHttp` host must supply its native
idempotency ledger. Production hosts must make that ledger durable and settle
job admission atomically with it.

Submission sends the canonical specification digest as `Idempotency-Key`.
The same key and body must return the original job through service restart;
a different body under that key must refuse. Cancellation uses
`<specDigest>:cancel` and returns `cancelled` or the terminal state already
reached. Terminal states cannot regress.

Capabilities list exact content-addressed base artifact IDs, methods, artifact
kinds, resumability and `trainable`. Base checksum, tokenizer and chat template
are pinned by the specification. The receipt echoes base checksum, dataset ID
and exact specification digest, which also binds manifest, seed, precision and
hyperparameters. Observations expose cumulative `spend` (nullable when unknown),
`logRefs` and `metricsRef`. Receipts use `storageUri`, raw-byte `sha256`,
`sizeBytes`, `deterministic` and the served inference runtime. Version 1 has no
separate `usage`, percentage-progress or nondeterminism-description object;
unsupported extra fields refuse.

## Host binding

```ts
const opened = createHttpTrainingBackend({
  base: 'https://training.example/v1', fetch: hostFetch,
  credential: readCredential, clock: hostClock,
  runtime: { provider: 'local', base: 'https://inference.example/v1', servedModel: 'base' },
  budget: { maxRequests: 64, maxJobs: 4, maxBytes: 64 * 1024 * 1024,
    maxResponseBytes: 1024 * 1024, maxWallMs: 60000, maxSpend: 5 },
});
if (!opened.ok) return opened;
const backend = opened.value;
```

Configuration refusal is a `TEXP1001` value without the supplied URL or secret.
The base must use HTTP or HTTPS without userinfo, query or fragment. The host
chooses its trusted service and DNS/network policy through `hostFetch`; local
addresses are supported. Redirects refuse. Artifact downloads must use the same
origin and credential-free URLs, with no saved query credentials or fragments.

The credential function is called for each request. Its value is used only in
that request's Authorization header. Responses echoing it refuse before
projection. Transport exceptions and server error bodies become fixed messages;
records, receipts and counters retain no credentials or copied server logs.

`maxRequests` counts injected transport calls, including artifact downloads.
JSON and artifact streams have separate byte bounds. The wall ceiling includes
credential lookup and body reads across the adapter lifetime. A specification's
shorter wall ceiling also applies from that host session's start. The outer
durable pipeline retains its deadline across restarts. The injected transport
must honor AbortSignal for prompt physical cancellation.

A finite host spend ceiling requires finite ceilings in all submitted or
restored specifications. Their full ceilings are reserved for this adapter's
lifetime and are never recycled after uncertainty. Cumulative observed cost
cannot decrease. Unknown cost cannot satisfy a finite ceiling; materialization
also refuses unknown aggregate cost across bound jobs. The service must enforce
the submitted ceilings itself: detecting overspend does not reverse a charge.

The adapter retains one promise per specification, including ambiguous or failed
submissions. Duplicates make no second POST within that instance. Capacity
exhaustion refuses without evicting idempotency bindings. After restart, call
`bindJob(spec, job)` with the checked durable run before resuming its DAG. It
performs no HTTP request. Uncertain submissions require the host's independent
lookup by digest and explicit reconciliation in the existing job runner.

Network failures, 429 and 5xx increment `failures.transport`. An affected job
becomes `unknown`, with unknown cost; a later `queued` response cannot reset it.
Native `parseRetryAfter` accepts seconds and HTTP dates. Calls before that
deadline return without dispatch. There is no adapter retry loop; the durable
job runner owns further attempts and the pipeline owns polling cadence.

Malformed replies, incompatible capabilities, ancestry/checksum mismatches and
budget failures refuse `TEXP1008`. A capability document with `trainable: false`,
or a missing training route (404/405), is inference-only: no submission POST is
sent. Unreachable or malformed capabilities throw a fixed `TEXP1008` exception
because the settled capability method returns a document, not a result union.

`materialize` requires a confirmed complete job, verifies exact ancestry before
download and calls `verifyArtifactReceipt` to recompute byte size and SHA-256.
The durable pipeline independently verifies through `backend.readBytes` before
atomic registration, performing a fresh bounded download. The adapter returns
a receipt and has no store or activation authority.

## Reference trainer requirements

The trainer is separately installed host software. A PEFT/LoRA implementation
must pin its library/runtime versions, immutable base revision and checksum,
tokenizer, chat template, seed, precision, rank, learning rate and epoch count.
Keep base weights read-only. Resolve the exact dataset manifest from controlled
storage; refuse changed bytes, leakage, incompatible templates or unavailable
resource reservations before accepting a job.

Publish adapter bytes at an immutable location after the complete write and
checksum those exact bytes. Bind the inference endpoint and provider to the
host configuration and report the actual served model. Report determinism
honestly. Persist terminal states, cumulative cost and controlled log/metric
references. Enforce time, record, byte and spend limits inside the service;
preserve cancellation through restart. This package has no trainer dependency.

## Frozen training plans

`node benchmark/cgt.ts --live --train` renders a plan with zero requests.
The single injected `readTrainingEnv` reader accepts these variables:

| Suffix after `TANGLE_TRAINING_` | Value |
| --- | --- |
| `BASE` | Credential-free service base |
| `API_KEY` | Write-only service credential |
| `DATASET_ID`, `MANIFEST_DIGEST` | Exact lowercase SHA-256 identities |
| `BASE_ARTIFACT_ID`, `BASE_CHECKSUM` | Exact base identity and checksum |
| `METHOD` | `lora`, `full` or `knowledge-edit`; service support remains required |
| `MAX_SPEND` | Explicit finite nonnegative decimal ceiling |
| `MAX_WALL_MS` | Explicit positive safe integer |

Missing variables produce a stated skip; malformed values refuse without being
printed. The `planId` binds source, fixture, identities, method and ceilings.
Credential rotation does not change it. A wrong `--authorize <planId>` refuses
even when configuration is missing. A matching configured plan reports
`implementation-missing`: the command has no live training driver and remains
non-executable. Scripted fixtures and an in-process native server establish
protocol conformance with zero physical requests. Live training and model
quality remain not-run.
