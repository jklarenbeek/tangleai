/**
 * Tangle desktop — the entry point.
 *
 *   node apps/desktop/src/main.ts [--port 4700] [--data <file.db>]
 *                                 [--folder <dir>] [--no-open]
 *                                 [--ops <host module>[,<host module>…]]   (or TANGLE_OPS_MODULE)
 *
 * Same file under Bun, and the target of `bun build --compile`. The
 * server is node:http (Bun implements it); SQLite arrives through
 * @jarenjs/db's runtime-picked driver. Document dependencies are bundled
 * into the executable; the optional Playwright service remains separate.
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createDesktop, staticFile, DESKTOP_VERSION } from './server.ts';
import { desktopWebRoute, WEB_READER_PATH } from './web-reader.ts';
import { desktopJobRoute, JOB_QUEUE_PATH } from './job-queue.ts';
import { superviseOps } from '@tangleai/ops/supervisor';
import { createChildProcessRunner, type InstrumentRegistration, type InstrumentRunner } from './instruments.ts';

/**
 * The instruments a host running from the repository may run. Each was
 * measured first: it exits zero, writes one document carrying its own
 * canonical identity, and produces byte-identical output over an
 * unchanged tree. Each names the flag its own CLI takes, because they
 * do not agree on one — `--out` is a file and `--out-dir` a directory.
 *
 * These are ENTRY PATHS, not imports: the measurement workspace is
 * private, carries dependencies that are not ours, and does not exist
 * around a compiled binary at all.
 */
const INSTRUMENTS: readonly InstrumentRegistration[] = [
  {
    id: 'config-conformance',
    title: 'Config conformance',
    entry: 'benchmark/config-conformance.ts',
    outFlag: '--out',
    schemaId: 'https://tangleai.dev/schemas/config-conformance',
    keyless: true,
    acceptsBudget: false,
  },
  {
    id: 'outcome-conformance',
    title: 'Outcome conformance',
    entry: 'benchmark/outcome-conformance.ts',
    outFlag: '--out-dir',
    schemaId: 'https://tangleai.dev/schemas/outcome-conformance',
    keyless: true,
    acceptsBudget: false,
  },
  {
    id: 'gmpl-conformance',
    title: 'GMPL conformance',
    entry: 'benchmark/gmpl-conformance.ts',
    outFlag: '--out-dir',
    schemaId: 'https://tangleai.dev/schemas/gmpl-conformance',
    keyless: true,
    acceptsBudget: false,
  },
];

/**
 * Register the instruments only when the measurement workspace is
 * actually beside this source. A compiled binary runs from a foreign
 * directory with no repository around it: it finds nothing, registers
 * nothing, and the surface answers that rather than pretending.
 */
async function findInstruments(): Promise<InstrumentRunner | undefined> {
  let root: string;
  try {
    root = fileURLToPath(new URL('../../../', import.meta.url));
  } catch {
    return undefined;
  }
  try {
    await stat(join(root, 'benchmark', 'package.json'));
  } catch {
    return undefined;
  }
  return createChildProcessRunner({ root, registrations: INSTRUMENTS });
}

interface Args {
  port: number;
  data: string;
  folder: string | null;
  open: boolean;
  /** Host modules naming the background jobs the app runs (each `{ registry, handlers?, contracts?, scope?, title? }`); none for none. */
  ops: string[];
}

/** `a.ts,b.ts` → their absolute paths (empty for none). */
function modulePaths(list: string | undefined): string[] {
  return (list ?? '').split(',').map(p => p.trim()).filter(Boolean).map(p => resolve(p));
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    port: 4700,
    data: join(homedir(), '.tangle', 'tangle.db'),
    folder: null,
    open: true,
    ops: modulePaths(process.env.TANGLE_OPS_MODULE),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port') args.port = Number(argv[++i]);
    else if (arg === '--data') args.data = resolve(String(argv[++i]));
    else if (arg === '--folder') args.folder = resolve(String(argv[++i]));
    else if (arg === '--no-open') args.open = false;
    else if (arg === '--ops') args.ops = modulePaths(String(argv[++i]));
  }
  return args;
}

function openBrowser(url: string): void {
  const [command, extra] = process.platform === 'darwin' ? ['open', []]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '']]
    : ['xdg-open', []];
  try {
    spawn(command as string, [...(extra as string[]), url], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* a browser that will not open is the user's to open */ }
}

const args = parseArgs(process.argv.slice(2));
await mkdir(dirname(args.data), { recursive: true });

const instruments = await findInstruments();

const desktop = await createDesktop({
  dbPath: args.data,
  presetSettings: args.folder !== null ? { folder: args.folder } : undefined,
  // a configured folder stays synchronized without a click: a full scan
  // at start, then coalesced passes for whatever the filesystem reports
  watch: { enabled: true },
  ...(instruments === undefined ? {} : { instruments }),
});

// the web reader a desktop page (this one, or the Pages desktop on this machine) reads websites through
const webRoute = desktopWebRoute(desktop.db);
// the background runtimes the host modules name, each in its own worker thread with its own store. One module is
// scope `ops` with `ops.db` beside the data (as it always was); several are each the scope the module exports
// (`scope`, else the file's base name) with `ops-<scope>.db`. A host module keeps its top level free of side effects:
// this thread imports it only to read its scope and title, and its worker imports it to run it.
const hosts = await Promise.all(args.ops.map(async (path, i) => {
  if (args.ops.length === 1) return { path, scope: 'ops', title: undefined as Record<string, string> | undefined, store: join(dirname(args.data), 'ops.db') };
  const exported: any = await import(pathToFileURL(path).href).catch(() => ({}));
  const scope = typeof exported.scope === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(exported.scope) ? exported.scope : basename(path).replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-') || `ops-${i + 1}`;
  return { path, scope, title: exported.title as Record<string, string> | undefined, store: join(dirname(args.data), `ops-${scope}.db`) };
}));
const scopes = new Set<string>();
for (const host of hosts) { if (scopes.has(host.scope) || host.scope === 'desktop') throw new Error(`two host modules (or one and the desktop) share the scope '${host.scope}'`); scopes.add(host.scope); }
const supervisors = hosts.map(host => ({ ...host, ops: superviseOps({
  workerUrl: new URL('./ops-worker.ts', import.meta.url),
  workerData: { module: host.path, storePath: host.store },
  onState: (state) => { if (state.state === 'restarting') console.error(`  ops:    ${host.scope} restarting (${state.last?.reason}${state.last?.message ? `: ${state.last.message}` : ''})`); },
}) }));
// the job queues for the Jobs app of a desktop page: each runtime's (by its scope) and the store's own (scope desktop)
const jobRoute = desktopJobRoute(desktop.db, { runtimes: Object.fromEntries(supervisors.map(s => [s.scope, s.ops.queue()])) });

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path === WEB_READER_PATH || path.startsWith(`${WEB_READER_PATH}/`)) { webRoute(req, res); return; }
  if (path === JOB_QUEUE_PATH || path.startsWith(`${JOB_QUEUE_PATH}/`)) { jobRoute(req, res); return; }
  if (path.startsWith('/api/') || path.startsWith('/.well-known/')) {
    desktop.nodeHandler(req, res);
    return;
  }
  void staticFile(path).then((file) => {
    if (file === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    } else {
      res.writeHead(200, { 'content-type': file.type });
      res.end(file.body);
    }
  });
});

server.listen(args.port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${args.port}/`;
  console.log(`tangle ${DESKTOP_VERSION} — ${url}`);
  console.log(`  data:   ${args.data}`);
  console.log(`  runtime: ${process.versions.bun !== undefined ? `bun ${process.versions.bun}` : `node ${process.versions.node}`}`);
  // which change-capture mechanism this runtime gave the store, printed
  // rather than assumed: it is what the live subscriptions are maintained from
  console.log(`  capture: ${String(desktop.db.capabilities.capture)}`);
  // the watch capability this platform actually gave us, printed rather
  // than assumed: where it is not `recursive`, passes need an explicit tick
  const watch = desktop.watcher.state();
  console.log(`  watch:   ${watch.folder === null ? 'no folder configured' : watch.mode}`);
  // what this build can measure, printed rather than assumed: a build
  // with no measurement workspace beside it registers nothing
  const registered = instruments?.list() ?? [];
  console.log(`  reports: ${registered.length === 0 ? 'no instrument registered on this build' : registered.map((entry) => entry.id).join(', ')}`);
  console.log(`  ops:    ${hosts.length ? hosts.map(h => `${h.scope} = ${h.path}`).join(', ') : 'no host module (--ops)'}`);
  if (args.open) openBrowser(url);
});

const shutdown = (): void => {
  server.close();
  void Promise.all([webRoute.close(), jobRoute.close(), ...supervisors.map(s => s.ops.stop())]).then(() => desktop.close()).then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
