/** Keyless browser fixture: the real desktop, SQLite corpus and scripted MAS components. */
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktop, staticFile } from '../apps/desktop/src/server.ts';
import { groundingHostHarness, HOST_AT } from '../test/fixtures/grounding/host-harness.ts';
import { loadGroundingProfile } from '@tangleai/grounding';
import profileDocument from '../test/fixtures/grounding/profile-minimal.json' with { type: 'json' };
const dir = await mkdtemp(join(tmpdir(), 'tangle-e2e-'));
await writeFile(join(dir, 'notes.md'), 'The demo service listens on port 9090.\n\nThe demo service requires a verified deployment gate.');
const checked = await loadGroundingProfile(profileDocument); if (!checked.valid) throw Error('Invalid registered browser profile');
let harness: Awaited<ReturnType<typeof groundingHostHarness>>;
const desktop = await createDesktop({ now: () => HOST_AT, presetSettings: { folder: dir }, watch: { enabled: true, debounceMs: 25 },
  fetch: async () => { throw Error('The browser fixture permits no outbound provider request.'); },
  grounding: { profiles: [checked.value], bindings: async ({ db }) => { harness ??= await groundingHostHarness({ db, complex: true }); return harness.bindings(); } } });
const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  const asset = await staticFile(path);
  if (asset) { res.writeHead(200, { 'content-type': asset.type }); res.end(asset.body); }
  else desktop.nodeHandler(req, res);
});
server.listen(Number(process.env.TANGLE_PORT ?? 4714), '127.0.0.1', () => console.log('Scripted desktop ready'));
async function close() { server.close(); server.closeAllConnections(); await desktop.close(); await rm(dir, { recursive: true, force: true }); process.exit(0); }
process.once('SIGINT', () => void close()); process.once('SIGTERM', () => void close());
