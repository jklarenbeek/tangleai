/**
 * Build and serve the fixture application on its own origin, with the CORS
 * header a desktop needs to read its suite document. Usage:
 *   node serve.mjs <port> <desktop origin>
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECORDS } from './contract.ts';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? 4717);
const desktop = process.argv[3] ?? 'http://127.0.0.1:4715';
const out = join(here, 'dist');
await mkdir(out, { recursive: true });
execFileSync(process.env.BUN ?? 'bun', ['build', join(here, 'main.ts'), '--target=browser', '--format=esm', `--define=DESKTOP_ORIGIN=${JSON.stringify(desktop)}`, `--outfile=${join(out, 'main.js')}`], { stdio: 'inherit' });
await writeFile(join(out, 'index.html'), await readFile(join(here, 'index.html')));
const self = `http://127.0.0.1:${port}`;
await writeFile(join(out, 'suite.json'), JSON.stringify({
  $suite: '0.1', id: 'catalogue-suite', title: { en: 'Catalogue suite' },
  modules: [{
    $module: '0.1', id: 'catalogue', version: '1.0.0', category: 'suite',
    title: { en: 'Catalogue', nl: 'Catalogus' }, icon: { glyph: 'records', hue: 20 },
    host: { kind: 'origin', url: `${self}/index.html` },
    provides: [RECORDS],
    window: { width: 520, height: 420 },
  }],
}, null, 2));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
createServer(async (request, response) => {
  const path = new URL(request.url, self).pathname.replace(/^\/$/, '/index.html');
  try {
    const body = await readFile(join(out, path));
    response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream', 'access-control-allow-origin': desktop });
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
}).listen(port, '127.0.0.1', () => console.log(`fixture suite on ${self} for ${desktop}`));
