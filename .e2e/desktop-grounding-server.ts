/** Keyless browser fixture: the real desktop, SQLite corpus and scripted MAS components. */
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktop, staticFile } from '../apps/desktop/src/server.ts';
import { groundingHostHarness, HOST_AT } from '../test/fixtures/grounding/host-harness.ts';
import { loadGroundingProfile } from '@tangleai/grounding';
import profileDocument from '../test/fixtures/grounding/profile-minimal.json' with { type: 'json' };
import { createResearchStore } from '@tangleai/store';
import { lessonFixture } from '../test/research/lessons-store-fixtures.ts';
import { stored } from '../test/research/store-harness.ts';
import { sourceManifest } from '../benchmark/lib/source-manifest.ts';
// An explicit fixture root lets browser tests consume a separately qualified
// artifact before the surface changes themselves have a committed report.
const researchRoot = process.env.TANGLE_RESEARCH_ROOT;
const researchBytes = researchRoot === undefined ? null : await readFile(join(researchRoot, 'benchmark/results/research.json'), 'utf8');
const researchDocument = researchBytes === null ? null : JSON.parse(researchBytes);
const researchSource = researchDocument === null ? null : await sourceManifest(researchRoot!, researchDocument.source.files.map((row: any) => row.path));
const dir = await mkdtemp(join(tmpdir(), 'tangle-e2e-'));
await writeFile(join(dir, 'notes.md'), 'The demo service listens on port 9090.\n\nThe demo service requires a verified deployment gate.');
const checked = await loadGroundingProfile(profileDocument); if (!checked.valid) throw Error('Invalid registered browser profile');
let harness: Awaited<ReturnType<typeof groundingHostHarness>>;
const desktop = await createDesktop({ now: () => HOST_AT, presetSettings: { folder: dir }, watch: { enabled: true, debounceMs: 25 },
  ...(researchBytes === null ? {} : { researchReport: async () => ({ bytes: researchBytes, sourceFiles: researchSource!.files, expectedReportId: researchDocument.reportId }) }),
  fetch: async () => { throw Error('The browser fixture permits no outbound provider request.'); },
  grounding: { profiles: [checked.value], bindings: async ({ db }) => { harness ??= await groundingHostHarness({ db, complex: true }); return harness.bindings(); } } });
if (researchRoot !== undefined) {
  const store = createResearchStore(desktop.db), fixture = await lessonFixture(store, { id: 'browser-research-project' });
  stored(await store.lessons.putProposal(fixture.lesson));
}
const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  const asset = await staticFile(path);
  if (asset) { res.writeHead(200, { 'content-type': asset.type }); res.end(asset.body); }
  else desktop.nodeHandler(req, res);
});
server.listen(Number(process.env.TANGLE_PORT ?? 4714), '127.0.0.1', () => console.log('Scripted desktop ready'));
async function close() { server.close(); server.closeAllConnections(); await desktop.close(); await rm(dir, { recursive: true, force: true }); process.exit(0); }
process.once('SIGINT', () => void close()); process.once('SIGTERM', () => void close());
