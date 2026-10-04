/** Local engine qualification; unavailable engines are an explicit skip, never a simulated pass. */
import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sleep } from '@jarenjs/core/retry';
import { createProcessRunner } from '@tangleai/evolve/host';
import { ok, refuseOne } from '@tangleai/evolve';
import { openTangleDb } from '@tangleai/store';
import { createResearchWorkspace, buildExecutionManifest, researchValue, researchRevisionOf, createRemoteResearchExecutor, validateResearchExecutionResult } from '@tangleai/research';
import { loadResearchFixture } from '../benchmark/lib/research-fixture.ts';
import { createResearchContainerEngine } from '../apps/research-runner/src/engine.ts';
import { createFencedResearchBackend } from '../apps/research-runner/src/effects.ts';
import { createResearchRunner } from '../apps/research-runner/src/host.ts';
import { RESEARCH_RUNNER_IMAGE } from '../apps/research-runner/src/image.ts';

export async function researchRunnerSmoke() {
  const directory = await mkdtemp(join(tmpdir(), 'tangle-research-smoke-')), failures: string[] = [];
  const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
  let db: Awaited<ReturnType<typeof openTangleDb>> | undefined;
  try {
    let selected: { name: 'docker' | 'podman'; path: string } | undefined;
    for (const name of ['docker', 'podman'] as const) {
      const candidates = [...new Set((process.env.PATH ?? '').split(delimiter).filter(Boolean).map(path => join(path, name)))];
      for (const path of candidates) {
        try { await access(path, constants.X_OK); } catch { continue; }
        const runner = createProcessRunner({ roots: { base: directory }, env: { allow: [], set: { PATH: process.env.PATH ?? '/usr/bin:/bin' } },
          limits: { legMs: 5000, stdoutBytes: 4096, stderrBytes: 4096 }, allow: { version: { file: path, cwd: 'base',
            args: args => JSON.stringify(args) === JSON.stringify(['version', '--format', '{{.Server.Version}}']) ? ok(true) : refuseOne('TEVO1006', '/args', 'Unexpected version probe.') } } });
        const result = await runner.run({ name: 'version', args: ['version', '--format', '{{.Server.Version}}'], cwd: directory });
        if (result.ok && result.value.exitCode === 0 && result.value.stdout.trim()) { selected = { name, path }; break; }
        failures.push(name + ': ' + (result.ok ? result.value.stderr.trim() : result.issues[0].detail)); break;
      }
      if (selected) break;
    }
    if (!selected) return { status: 'skipped', reason: 'Neither Docker nor Podman answered a bounded server-version probe.', details: failures };
    const engine = await createResearchContainerEngine({ stateRoot: directory, repositoryRoot, engine: selected.name, executable: selected.path });
    let capability = await engine.capability(new AbortController().signal);
    if (!capability.available) {
      const pulled = await engine.pull(new AbortController().signal); assert.ok(pulled.outcome.ok && pulled.outcome.value.exitCode === 0, JSON.stringify(pulled));
      capability = await engine.capability(new AbortController().signal);
    }
    assert.equal(capability.available, true, JSON.stringify(capability));
    const fixture = await loadResearchFixture(repositoryRoot), topic = fixture.topics.find(row => row.id === 'kmeans-seeding')!;
    const encode = (value: string) => new TextEncoder().encode(value);
    const raw = 'writeFileSync("output/raw.json",JSON.stringify({assignments:[0],centroids:[[0,0]],iterations:0,kind:"clusters"}));';
    const imports = 'import {writeFileSync,symlinkSync} from "node:fs";';
    const cases = [
      { id: 'completed', source: imports + 'console.log("retained-standard-output");' + raw, status: 'ok', stop: 'completed' },
      { id: 'exception', source: 'throw Error("retained-program-error");', status: 'failed', stop: 'completed' },
      { id: 'timeout', source: 'console.log("retained-before-timeout");setInterval(()=>{},1000);', status: 'failed', stop: 'timeout' },
      { id: 'stdout-cap', source: 'process.stdout.write("x".repeat(1048576));setInterval(()=>{},1000);', status: 'failed', stop: 'output-bytes' },
      { id: 'filesystem-cap', source: imports + 'writeFileSync("output/flood",new Uint8Array(2097152));', status: 'failed', stop: 'output-bytes' },
      { id: 'symlink-refusal', source: imports + 'writeFileSync("output/a-kept","partial-output");symlinkSync("/etc/passwd","output/escape");' + raw, status: 'failed', stop: 'isolation-refused' },
      { id: 'malformed-output', source: imports + 'writeFileSync("output/raw.json","invalid raw output");', status: 'failed', stop: 'completed' },
    ];
    db = await openTangleDb({ path: join(directory, 'state.sqlite'), jobs: { now: Date.now, random: () => 0.5 } });
    let executed = 0, engineDiagnostic: unknown = null;
    const backend = createFencedResearchBackend({ db, owner: 'research-smoke', engine: { capability: engine.capability,
      run: async (...args) => {
        executed++;
        const result = await engine.run(...args);
        const checked = result.outcome.valid ? await validateResearchExecutionResult({ run: result.outcome.value.run,
          artifacts: result.outcome.value.artifacts.map(row => ({ artifactId: row.artifactId, bytes: new Uint8Array(row.bytes) })) },
        args[0].manifest, args[0].workspace, args[0]) : result.outcome;
        engineDiagnostic = { settlement: result.settlement, validation: checked.valid ? 'valid' : checked,
          error: result.outcome.valid ? result.outcome.value.run.error : null };
        return result;
      } } });
    const host = createResearchRunner({ hostname: '127.0.0.1', imageDigests: [RESEARCH_RUNNER_IMAGE.digest], backend, now: Date.now, sleep, timeoutSignal: AbortSignal.timeout });
    const remote = createRemoteResearchExecutor({ endpoint: 'http://127.0.0.1:8020', now: Date.now, sleep,
      fetch: async (url, init) => host.fetch(new Request(url, init)) });
    const rows = [];
    try {
      for (const item of cases) {
        const workspace = researchValue(await createResearchWorkspace({ projectId: topic.contract.projectId,
          datasetIds: topic.contract.datasets.map(row => row.id), splitIds: [...topic.contract.splits.train, ...topic.contract.splits.test], files: [
            ...topic.plan.inputPaths.map(path => ({ path, bytes: fixture.files.get(path)!, mode: 'read-only' as const, role: 'input' as const })),
            { path: 'evaluation/registry.json', bytes: encode(JSON.stringify(topic.plan.evaluator)), mode: 'read-only', role: 'evaluator' },
            { path: 'code/main.mjs', bytes: encode(item.source), mode: 'read-only', role: 'code' },
          ] }));
        const manifest = researchValue(await buildExecutionManifest({ contract: topic.contract, plan: topic.plan, workspace,
          branchId: 'runner-smoke-' + item.id, condition: topic.plan.conditions[0].id, seed: topic.contract.replicatePolicy.seeds[0], imageDigest: RESEARCH_RUNNER_IMAGE.digest,
          dependencyLockHash: await researchRevisionOf({ image: RESEARCH_RUNNER_IMAGE, dependencies: [] }),
          resources: { cpu: 1, memoryBytes: 67108864, pids: 16, wallMs: item.id === 'timeout' ? 400 : 5000, outputBytes: 65536 },
          codeArtifactId: workspace.manifest.entries.find(row => row.role === 'code')!.artifactId }));
        const context = { contract: topic.contract, plan: topic.plan, signal: new AbortController().signal };
        const result = await remote.run(manifest, workspace, context);
        assert.equal(result.valid, true, item.id + ': ' + JSON.stringify({ result, engineDiagnostic }));
        if (!result.valid) throw Error('Invalid smoke receipt');
        assert.equal(result.value.run.status, item.status, item.id + ': ' + JSON.stringify(result.value.run));
        assert.equal(result.value.run.stopReason, item.stop, item.id);
        const replay = await remote.run(manifest, workspace, context); assert.deepEqual(replay, result, item.id + ' replay');
        rows.push({ case: item.id, runId: result.value.run.id, status: result.value.run.status, stopReason: result.value.run.stopReason,
          exitStatus: result.value.run.exitStatus, outputFiles: result.value.run.outputInventory!.length, retainedBytes: result.value.artifacts.reduce((sum, row) => sum + row.bytes.byteLength, 0),
          wallMs: result.value.run.resources!.wallMs, imageDigest: result.value.run.isolation!.imageDigest, isolationVerified: result.value.run.isolation!.verified });
      }
      assert.equal(executed, cases.length, 'Every second request must replay its existing fence.');
      return { status: 'passed', capability, transport: 'in-process HTTP handler with native single-send client', executions: executed, replayExecutions: 0, rows };
    } finally { await remote.close(); await host.close(); }
  } finally { await db?.close(); await rm(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await researchRunnerSmoke(), null, 2));
