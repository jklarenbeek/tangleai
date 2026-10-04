# Research runner

This private optional Bun host executes frozen research workspaces in disposable
containers. Start it with `npm start --workspace @tangleai/research-runner` and
probe `http://127.0.0.1:8020/capability`. Bun 1.4.2 or later and a local Docker
daemon with cgroup v2 CPU, memory, swap and process limits are required. An absent
engine is reported as `available: false` with a reason. Podman can be selected,
but must pass the same capability and container-configuration checks; support is
not inferred from its executable being installed.

`TANGLE_RESEARCH_HOST`, `TANGLE_RESEARCH_PORT`, `TANGLE_RESEARCH_STATE` and
`TANGLE_RESEARCH_ENGINE` select the listener, durable state and engine. Defaults
are loopback, 8020, `~/.local/state/tangleai/research-runner` and `docker`.
`TANGLE_RESEARCH_TOKEN` is required for any non-loopback listener. Remote clients
require HTTPS and a token; terminate TLS at the operator's proxy. State must be
outside the repository and retained across restarts because it contains the
existing Evolve effect fence.

`POST /run` accepts the closed `ResearchExecutionRequest` archive from
`createRemoteResearchExecutor`. Admission allows one active request and eight
queued requests, limits input to 20 MiB and body reading to ten seconds, and
checks all content addresses before any engine operation. Only the Node image
pinned in `src/image.ts` is accepted. A missing local image is pulled by digest
before the experiment begins. Both experiment phases are network-free; logged
network setup is currently refused. A capability probe does not pull an image.

Experiments receive read-only `/work`, including `execution.json` and the frozen
feature files. Only `/work/output` is writable. There is no repository, host
environment, host secret, database or engine socket in the experiment. The
container runs as uid/gid 65534 with a read-only root, no capabilities, no new
privileges and manifest-bound CPU, memory, process and wall limits. The output
allowance is partitioned: one quarter each for stdout and stderr, with the
remaining half rounded down to a 4096-byte capped tmpfs. The minimum allowance
is 8192 bytes. File and inode counts are bounded. A separate read-only holder
keeps this filesystem alive while the measured container and its descendants
are removed, then a fixed collector inventories regular files without following
links. Valid partial files and bounded logs survive failed runs. CPU time and
peak RSS are `null` when unmeasured; wall time remains precise and charged
milliseconds round up.

The entrypoint must write canonical JSON for `ResearchRawOutput` to
`output/raw.json`, using lexicographically ordered keys and no trailing newline.
This contains raw assignments or rankings, never registered metrics. The
independent injected evaluator runs outside the experiment with hidden labels.
Authored code and fixture program ids use the same public executor seam; this
host accepts authored entrypoints. A host that also runs trusted fixtures routes
program-id manifests to `createFixtureExecutor`. That executor refuses authored
code and never claims container isolation.

The durable intent precedes engine dispatch. Repeating an identical settled
manifest replays its receipt without launching another container. Lost results
or uncertain cleanup remain unresolved and cannot automatically run again.
An operator must inspect the existing fence and labelled engine resources to
reconcile such an attempt; deleting the state directory is not a retry protocol.
The remote adapter makes one physical send and retains uncertainty explicitly.

Run `npm run research:runner:smoke` for local qualification. It states a skip
only when neither Docker nor Podman answers its bounded version probe. Otherwise
it exercises real containers, the HTTP handler, the single-send client and the
durable fence, checking successful output, exceptions, timeout, log/filesystem
caps, unsafe links, malformed raw output and zero-execution replay. Its output
records engine version and exact digest. This is infrastructure conformance,
not scientific efficacy or live model quality.

An optional Linux amd64 host image builds with
`docker build -f apps/research-runner/Dockerfile -t tangle-research-runner .`.
Its non-root host process needs operator-granted access to the local daemon
socket and a writable state bind mount. Bind state at the **same absolute path**
inside and outside the host image and set `TANGLE_RESEARCH_STATE` to that path:
the daemon resolves experiment bind sources on its own host. Supply the socket's
group with `--group-add`, a token and an explicit loopback published port. Engine
access belongs only to this trusted controller; the experiment containers it
creates receive none. The dedicated Docker build context excludes environment
files, dependency directories and the rest of the repository.
