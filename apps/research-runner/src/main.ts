/** Private optional Bun host; credentials and engine access never enter experiment containers. */
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sleep } from '@jarenjs/core/retry';
import { openTangleDb } from '@tangleai/store';
import { researchExecutionResponse, researchRefuse } from '@tangleai/research';
import { createResearchContainerEngine } from './engine.ts';
import { createFencedResearchBackend } from './effects.ts';
import { createResearchRunner, type ResearchRunnerBackend } from './host.ts';
import { RESEARCH_RUNNER_IMAGE } from './image.ts';

export async function startResearchRunner() {
  const runtime = (globalThis as any).Bun;
  const [major, minor] = String(runtime?.version ?? '').split('.').map(Number);
  if (!runtime || !(major > 1 || major === 1 && minor >= 4)) throw new Error('Research runner requires Bun 1.4 or later.');
  const hostname = process.env.TANGLE_RESEARCH_HOST ?? '127.0.0.1', port = Number(process.env.TANGLE_RESEARCH_PORT ?? 8020);
  const token = process.env.TANGLE_RESEARCH_TOKEN;
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname) && !token) throw new TypeError('A non-loopback research runner requires a token.');
  const stateRoot = resolve(process.env.TANGLE_RESEARCH_STATE ?? join(homedir(), '.local/state/tangleai/research-runner'));
  const engineName = process.env.TANGLE_RESEARCH_ENGINE ?? 'docker';
  if (!['docker', 'podman'].includes(engineName) || !Number.isSafeInteger(port) || port < 1 || port > 65535) throw new TypeError('Invalid runner engine or port.');
  const executable = runtime.which(engineName);
  let db: Awaited<ReturnType<typeof openTangleDb>> | undefined;
  let backend: ResearchRunnerBackend;
  if (executable) {
    const engine = await createResearchContainerEngine({ stateRoot, repositoryRoot: fileURLToPath(new URL('../../../', import.meta.url)),
      engine: engineName as 'docker' | 'podman', executable });
    db = await openTangleDb({ path: join(stateRoot, 'state.sqlite'), jobs: { now: Date.now, random: Math.random } });
    backend = createFencedResearchBackend({ db, engine, owner: 'research-runner' });
  } else {
    const reason = 'Research runner engine is unavailable: ' + engineName;
    backend = { capability: async () => ({ available: false, kind: 'container', engine: null, version: null, imageDigests: [], reason }),
      run: async request => researchExecutionResponse(request.manifest.executionManifestHash, researchRefuse('TRSH1007', '/engine', reason)) };
  }
  const host = createResearchRunner({ hostname, token, imageDigests: [RESEARCH_RUNNER_IMAGE.digest], backend, now: Date.now, sleep, timeoutSignal: AbortSignal.timeout });
  let server: ReturnType<typeof runtime.serve>;
  try { server = runtime.serve({ hostname, port, idleTimeout: 255, maxRequestBodySize: 20971520, fetch: host.fetch }); }
  catch (cause) { await host.close(); await db?.close(); throw cause; }
  let stopped = false;
  const close = async () => { if (stopped) return; stopped = true; await server.stop(); await host.close(); await db?.close(); };
  process.once('SIGTERM', close); process.once('SIGINT', close);
  console.log('Research runner listening at ' + server.url.origin);
  return { server, close };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await startResearchRunner();
