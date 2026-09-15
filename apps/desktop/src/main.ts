/**
 * Tangle desktop — the entry point.
 *
 *   node apps/desktop/src/main.ts [--port 4700] [--data <file.db>]
 *                                 [--folder <dir>] [--no-open]
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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDesktop, staticFile, DESKTOP_VERSION } from './server.ts';
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
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    port: 4700,
    data: join(homedir(), '.tangle', 'tangle.db'),
    folder: null,
    open: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port') args.port = Number(argv[++i]);
    else if (arg === '--data') args.data = resolve(String(argv[++i]));
    else if (arg === '--folder') args.folder = resolve(String(argv[++i]));
    else if (arg === '--no-open') args.open = false;
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

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
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
  if (args.open) openBrowser(url);
});

const shutdown = (): void => {
  server.close();
  void desktop.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
