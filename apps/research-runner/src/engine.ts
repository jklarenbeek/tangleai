/** Disposable container ownership through Evolve's bounded named-process runner. */
import { mkdir, mkdtemp, chmod, writeFile, rm, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { equalsJson } from '@jarenjs/core/object';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { createProcessRunner, type RunRequest, type RunnerLimits, type ProcessRunnerOptions } from '@tangleai/evolve/host';
import { ok, refuseOne } from '@tangleai/evolve';
import { researchRevisionOf, researchExecutionResult, researchExecutionResponse, researchIssue, researchRefuse, researchValue,
  validateResearchShape, isResearchWorkspacePath, RESEARCH_EXECUTION_LIMITS, RESEARCH_RAW_OUTPUT_PATH, type ResearchExecutorCapability, type ResearchExecutionSettlement,
  type ResearchRawOutput, type ResearchExecutionResponse } from '@tangleai/research';
import { RESEARCH_OUTPUT_COLLECTOR } from './collector.ts';
import { RESEARCH_RUNNER_IMAGE } from './image.ts';
import type { ResearchRunnerRequest } from './host.ts';

type Settlement = Parameters<NonNullable<RunRequest['onSettlement']>>[0];
const encoder = new TextEncoder();
const controllerLimits: RunnerLimits = { legMs: 10000, stdoutBytes: 65536, stderrBytes: 8192 };
const freshSignal = () => new AbortController().signal;
export async function createResearchContainerEngine(options: { stateRoot: string; repositoryRoot: string;
  engine: 'docker' | 'podman'; executable: string; runner?: (options: ProcessRunnerOptions) => ReturnType<typeof createProcessRunner> }) {
  const engine = options.engine, executable = options.executable, runner = options.runner ?? createProcessRunner;
  if (!isAbsolute(executable) || !isAbsolute(options.stateRoot)) throw new TypeError('Engine and state root must be absolute host paths.');
  await mkdir(options.stateRoot, { recursive: true, mode: 0o700 });
  const stateRoot = await realpath(options.stateRoot), repositoryRoot = await realpath(options.repositoryRoot);
  const fromRepository = relative(repositoryRoot, stateRoot);
  if (!fromRepository || fromRepository !== '..' && !fromRepository.startsWith('..' + sep) && !isAbsolute(fromRepository))
    throw new TypeError('Research runner state must live outside the repository.');
  const image = RESEARCH_RUNNER_IMAGE;
  const ownerId = (await researchRevisionOf({ stateRoot })).slice(0, 12);
  async function command(args: string[], limits = controllerLimits, signal = freshSignal()) {
    const expected = [...args]; let settlement: Settlement | undefined;
    const owner = runner({ roots: { base: stateRoot }, env: { allow: [], set: { PATH: dirname(executable) + ':/usr/local/bin:/usr/bin:/bin' } }, limits,
      allow: { engine: { file: executable, cwd: 'base', args: actual => equalsJson(actual, expected) ? ok(true) : refuseOne('TEVO1006', '/args', 'Container command differs from its host-owned argument vector.') } } });
    const outcome = await owner.run({ name: 'engine', args: expected, cwd: stateRoot, signal, onSettlement: value => { settlement = value; } });
    return { outcome, settlement };
  }
  function success(result: Awaited<ReturnType<typeof command>>, action: string) {
    if (!result.outcome.ok || result.outcome.value.exitCode !== 0 || result.settlement?.settlement !== 'closed')
      throw Error('Container engine could not ' + action + ': ' + (result.outcome.ok ? result.outcome.value.stderr : result.outcome.issues[0].detail));
    return result.outcome.value;
  }
  async function capability(signal: AbortSignal): Promise<ResearchExecutorCapability> {
    try {
      const version = success(await command(['version', '--format', '{{.Server.Version}}'], controllerLimits, signal), 'report its version').stdout.trim();
      const info = JSON.parse(success(await command(['info', '--format', '{"cgroup":{{json .CgroupVersion}},"memory":{{json .MemoryLimit}},"swap":{{json .SwapLimit}},"pids":{{json .PidsLimit}},"cpu":{{json .CPUCfsQuota}}}'], controllerLimits, signal), 'report resource controls').stdout);
      if (info.cgroup !== '2' || !info.memory || !info.swap || !info.pids || !info.cpu) throw Error('The engine lacks the required cgroup v2 resource controls.');
      const inspected = JSON.parse(success(await command(['image', 'inspect', image.reference, '--format', '{"id":{{json .Id}},"digests":{{json .RepoDigests}},"os":{{json .Os}},"architecture":{{json .Architecture}}}'], controllerLimits, signal), 'resolve the pinned image').stdout);
      if (!Array.isArray(inspected.digests) || !inspected.digests.some((value: string) => value.endsWith('@' + image.digest))
        || inspected.os !== 'linux' || inspected.architecture !== 'amd64') throw Error('The qualified image digest or platform does not resolve.');
      return { available: true, kind: 'container', engine, version, imageDigests: [image.digest], reason: null };
    } catch (cause) { return { available: false, kind: 'container', engine, version: null, imageDigests: [], reason: cause instanceof Error ? cause.message : String(cause) }; }
  }
  async function pull(signal: AbortSignal) {
    return command(['pull', image.reference], { legMs: 120000, stdoutBytes: 65536, stderrBytes: 65536 }, signal);
  }
  async function run(request: ResearchRunnerRequest, signal: AbortSignal): Promise<ResearchExecutionResponse> {
    const { manifest, workspace } = request, hash = manifest.executionManifestHash;
    if (manifest.imageDigest !== image.digest) return researchExecutionResponse(hash, researchRefuse('TRSH1007', '/imageDigest', 'Container image is not qualified.'));
    if (manifest.network.setup !== 'off' || manifest.network.measured !== 'off' || !manifest.codeArtifactId || !manifest.entrypoint
      || workspace.manifest.entries.some(row => row.role === 'output') || manifest.resources.outputBytes < 8192)
      return researchExecutionResponse(hash, researchRefuse('TRSH1010', '/manifest', 'Container execution requires code, an empty output directory, network-free phases and at least 8192 output bytes.'));
    if (signal.aborted) return researchExecutionResponse(hash, researchRefuse('TRSH1008', '/signal', 'Container request was cancelled before admission.'));
    let qualified = await capability(signal);
    if (!qualified.available) { await pull(signal); qualified = await capability(signal); }
    if (!qualified.available) return researchExecutionResponse(hash, researchRefuse('TRSH1007', '/engine', qualified.reason!));
    const name = 'trsh-' + ownerId + '-' + hash.slice(0, 32), holder = name + '-capture', volume = name + '-output';
    const logBytes = Math.floor(manifest.resources.outputBytes / 4), fileBytes = Math.floor((manifest.resources.outputBytes - 2 * logBytes) / 4096) * 4096;
    const root = await mkdtemp(join(stateRoot, 'workspace-'));
    let writerCreated = false, holderCreated = false, volumeCreated = false, removed = false, cleanup = true;
    let measured: Settlement | undefined, oom = false, files: Array<{ path: string; bytes: Uint8Array }> = [], full = false;
    let failure: unknown, captureComplete = false, captureRefused = false;
    const flags = ['--network', 'none', '--ipc', 'none', '--read-only', '--user', '65534:65534', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--memory', String(manifest.resources.memoryBytes), '--memory-swap', String(manifest.resources.memoryBytes), '--pids-limit', String(manifest.resources.pids),
      '--cpus', String(manifest.resources.cpu), '--log-driver', 'none', '--entrypoint', 'node', '--label', 'tangleai.research=' + hash];
    try {
      if (success(await command(['container', 'ls', '--all', '--filter', 'name=' + name, '--format', '{{.Names}}']), 'check container ownership').stdout.trim()
        || success(await command(['volume', 'ls', '--filter', 'name=' + volume, '--format', '{{.Name}}']), 'check volume ownership').stdout.trim())
        throw Error('An earlier container or volume still owns this execution identity; automatic reuse is refused.');
      for (const entry of workspace.manifest.entries) {
        const destination = join(root, entry.path);
        await mkdir(dirname(destination), { recursive: true, mode: 0o755 });
        await writeFile(destination, workspace.artifacts.find(row => row.artifactId === entry.artifactId)!.bytes, { flag: 'wx', mode: 0o444 });
      }
      await writeFile(join(root, 'execution.json'), JSON.stringify(manifest), { flag: 'wx', mode: 0o444 });
      await mkdir(join(root, 'output'), { mode: 0o755 }); await chmod(root, 0o555);
      volumeCreated = true;
      success(await command(['volume', 'create', '--driver', 'local', '--label', 'tangleai.research=' + hash, '--opt', 'type=tmpfs', '--opt', 'device=tmpfs', '--opt',
        'o=size=' + fileBytes + ',nr_inodes=' + (RESEARCH_EXECUTION_LIMITS.maxOutputFiles * 2 + 1) + ',uid=65534,gid=65534,mode=0700,noexec,nosuid,nodev', volume]), 'create output volume');
      holderCreated = true;
      success(await command(['run', '--detach', '--name', holder, ...flags, '--mount', 'type=volume,source=' + volume + ',destination=/capture,readonly', image.reference,
        '-e', 'setInterval(() => {}, 1000)']), 'start read-only output holder');
      writerCreated = true;
      success(await command(['create', '--name', name, ...flags, '--workdir', '/work', '--mount', 'type=bind,source=' + root + ',destination=/work,readonly',
        '--mount', 'type=volume,source=' + volume + ',destination=/work/output', image.reference, manifest.entrypoint]), 'create measured container');
      const config = JSON.parse(success(await command(['inspect', name, '--format', '{{json .}}']), 'inspect measured container').stdout);
      const mounts = config.Mounts as Array<{ Source: string; Destination: string; RW: boolean; Name?: string }>;
      if (config.Config.User !== '65534:65534' || config.HostConfig.Privileged || !config.HostConfig.ReadonlyRootfs || config.HostConfig.NetworkMode !== 'none'
        || config.HostConfig.PidMode !== '' || config.HostConfig.IpcMode !== 'none' || config.HostConfig.PidsLimit !== manifest.resources.pids || config.HostConfig.Memory !== manifest.resources.memoryBytes
        || config.HostConfig.MemorySwap !== manifest.resources.memoryBytes || config.HostConfig.NanoCpus !== manifest.resources.cpu * 1e9
        || !config.HostConfig.CapDrop?.includes('ALL') || !config.HostConfig.SecurityOpt?.includes('no-new-privileges')
        || config.Config.Image !== image.reference || mounts.length !== 2
        || !mounts.some(row => row.Destination === '/work' && row.Source === root && row.RW === false)
        || !mounts.some(row => row.Destination === '/work/output' && row.Name === volume && row.RW === true))
        throw Error('Created container does not satisfy its declared isolation controls.');
      const started = await command(['start', '--attach', name], { legMs: manifest.resources.wallMs, stdoutBytes: logBytes, stderrBytes: logBytes }, signal);
      measured = started.settlement;
      const state = JSON.parse(success(await command(['inspect', name, '--format', '{{json .State}}']), 'inspect measured exit').stdout);
      oom = state.OOMKilled === true;
      success(await command(['rm', '--force', name]), 'remove measured processes'); removed = true;
      // The separate read-only holder keeps the capped tmpfs alive after every
      // measured writer is gone. Collection never races experiment descendants.
      const captured = JSON.parse(success(await command(['exec', holder, 'node', '-e', RESEARCH_OUTPUT_COLLECTOR, String(fileBytes), String(RESEARCH_EXECUTION_LIMITS.maxOutputFiles)],
        { ...controllerLimits, stdoutBytes: manifest.resources.outputBytes * 4 + 65536 }), 'collect stable output').stdout);
      if (!Array.isArray(captured.files) || captured.files.length > RESEARCH_EXECUTION_LIMITS.maxOutputFiles) throw Error('Collector returned an invalid inventory.');
      files = captured.files.map((row: { path: string; bytes: number[] }) => {
        if (!Array.isArray(row.bytes) || row.bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw Error('Collector returned non-byte data.');
        return { path: row.path, bytes: new Uint8Array(row.bytes) };
      });
      const safe = files.filter((row, index, all) => isResearchWorkspacePath(row.path, RESEARCH_EXECUTION_LIMITS.maxPathBytes)
        && row.path.startsWith('output/') && !all.slice(0, index).some(other => other.path.toLowerCase() === row.path.toLowerCase()));
      captureRefused = captured.complete !== true || safe.length !== files.length;
      files = safe; full = captured.full === true; captureComplete = !captureRefused;
      if (captureRefused) failure = Error(typeof captured.reason === 'string' ? captured.reason : 'Captured output contains an unsafe or colliding path.');
    } catch (cause) { failure = cause; }
    finally {
      if (writerCreated && !removed) { const value = await command(['rm', '--force', name]); cleanup &&= value.outcome.ok && value.outcome.value.exitCode === 0; }
      if (holderCreated) { const value = await command(['rm', '--force', holder]); cleanup &&= value.outcome.ok && value.outcome.value.exitCode === 0; }
      if (volumeCreated) { const value = await command(['volume', 'rm', volume]); cleanup &&= value.outcome.ok && value.outcome.value.exitCode === 0; }
      try { await chmod(root, 0o700); await rm(root, { recursive: true, force: true }); } catch (cause) { cleanup = false; failure ??= cause; }
    }
    if (!cleanup || measured?.settlement === 'unresolved') return researchExecutionResponse(hash,
      researchRefuse('TRSH1008', '/cleanup', 'Container ownership or cleanup remains unresolved.', failure), 'unresolved');
    if (!measured) return researchExecutionResponse(hash, researchRefuse('TRSH1010', '/isolation', 'Container setup did not qualify before measured execution.', failure));
    let output: ResearchRawOutput | null = null;
    const raw = files.find(row => row.path === RESEARCH_RAW_OUTPUT_PATH);
    if (raw) { try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(raw.bytes);
      const parsed = researchValue(validateResearchShape<ResearchRawOutput>('ResearchRawOutput', JSON.parse(text)));
      if (text !== canonicalizeJson(parsed)) throw Error('Raw output must use the declared canonical JSON encoding.');
      output = parsed;
    }
      catch (cause) { failure ??= cause; } }
    const out = encoder.encode(measured.stdout), err = encoder.encode(measured.stderr);
    const truncated = measured.truncated.stdout || measured.truncated.stderr || out.byteLength > logBytes || err.byteLength > logBytes;
    const stopReason = signal.aborted ? 'cancelled' : oom ? 'memory' : full || truncated ? 'output-bytes' : captureRefused ? 'isolation-refused'
      : measured.reason === 'timeout' || measured.reason === 'drain-timeout' ? 'timeout' : 'completed';
    const value: ResearchExecutionSettlement = { exitStatus: measured.exitCode, stdout: out.slice(0, logBytes), stderr: err.slice(0, logBytes), files, output,
      resources: { wallMs: measured.durationMs, cpuMs: null, peakMemoryBytes: null }, stopReason,
      isolation: { kind: 'container', imageDigest: image.digest, verified: true, setupLogArtifactId: null, completeOutput: captureComplete && !full && !truncated },
      error: failure ? researchIssue(captureRefused ? 'TRSH1010' : 'TRSH1008', '/execution', 'Execution or output collection failed.', failure) : null };
    const result = await researchExecutionResult(manifest, value);
    return researchExecutionResponse(hash, result, 'settled');
  }
  return Object.freeze({ capability, run, pull });
}
