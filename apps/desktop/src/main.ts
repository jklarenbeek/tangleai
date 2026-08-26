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
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { createDesktop, staticFile, DESKTOP_VERSION } from './server.ts';

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

const desktop = await createDesktop({
  dbPath: args.data,
  presetSettings: args.folder !== null ? { folder: args.folder } : undefined,
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
  if (args.open) openBrowser(url);
});

const shutdown = (): void => {
  server.close();
  void desktop.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
