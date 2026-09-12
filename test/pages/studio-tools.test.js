import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { mountPageHost } from '../../apps/pages/src/demos/host.js';
import { projectTemplate } from '../../apps/pages/src/demos/playground/projectTemplates.js';
import { createStubHost, serialize } from '../assistant/dom.stub.js';
const mounted = [];
afterEach(async () => { for (const host of mounted.splice(0)) await host.dispose(); });
async function mountSite({ hash = '#/project', modelContext, stored = null } = {}) {
  const { container, document } = createStubHost(), assistantNode = document.createElement('aside');
  let data = stored;
  const host = mountPageHost({ root: container, assistantNode, hash, schedule: fn => fn(), debounceMs: 0,
    slots: { projects: { read: () => data, write: value => { data = structuredClone(value); } } },
    webmcp: { context: modelContext }, onError: error => { throw error; } });
  mounted.push(host); await host.webmcp.ready;
  const app = { getState: () => { const snapshot = host.project().read(); return { route: { page: host.page() }, project: { ...snapshot.document, revision: snapshot.stageRevision } }; },
    async dispatch(action, payload) {
      if (action === 'route/set') return host.setRoute('#/' + payload.page);
      if (action !== 'project/template') throw Error('Unexpected fixture action ' + action);
      const editor = host.project(); const result = await editor.replace(projectTemplate(payload), { expectedRevision: editor.read().revision });
      assert.equal(result.ok, true); return editor.run(undefined, { restart: false });
    },
  };
  return { app, container, storage: () => data, host };
}
it('rides along on the studio write/patch tool results', async function () {
    /** @type {any[]} */
    let registered = [];
    (await mountSite({
      hash: '#/',
      modelContext: { provideContext: ({ tools }) => { registered = tools; } },
    }));
    const tool = (name) => registered.find((t) => t.name === name);
    const seed = (await tool('jaren_get_templates').execute({ name: 'form' }));

    const written = (await tool('jaren_studio_write').execute({ doc: seed.doc }));
    assert.strictEqual(written.ok, true);
    assert.deepStrictEqual(written.widgets, ['form'], 'a clean write reports its widgets');
    assert.strictEqual(written.renderProblems, undefined);

    // break the form widget's feed through a valid patch: the tool
    // answers ok (the document IS valid and live) plus the problems
    const patched = (await tool('jaren_studio_patch').execute({
      patch: [{ op: 'replace', path: '/view/rules/0/body/4/1/props/schema', value: '$.nope' }],
    }));
    assert.strictEqual(patched.ok, true);
    assert.ok(patched.renderProblems.some((p) => /props\.schema did not resolve/.test(p)),
      'the render audit surfaced the broken widget feed');
    assert.match(patched.hint, /renders broken/);

    // the soft note rides along too: retitle the schema (restoring the
    // widget feed first) and the stale seed heading gets called out
    const retitled = (await tool('jaren_studio_patch').execute({
      patch: [
        { op: 'replace', path: '/view/rules/0/body/4/1/props/schema', value: '$.schema' },
        { op: 'replace', path: '/state/schema/title', value: 'Sleep survey' },
      ],
    }));
    assert.strictEqual(retitled.ok, true);
    assert.strictEqual(retitled.renderProblems, undefined);
    assert.match(retitled.renderNotes[0], /"Sleep survey"/);
  });
describe('website — the Studio assistant tools (WebMCP)', async function () {
  it('registers the four studio tools and they author, patch and read the project app file', async function () {
    /** @type {any[]} */
    let registered = [];
    const { app, container, storage } = (await mountSite({
      hash: '#/',
      modelContext: { provideContext: ({ tools }) => { registered = tools; } },
    }));
    const tool = (name) => registered.find((t) => t.name === name);
    for (const expected of ['jaren_studio_write', 'jaren_studio_patch',
      'jaren_studio_read', 'jaren_get_templates']) {
      assert.notStrictEqual(tool(expected), undefined, `${expected} registered`);
    }
    const appFileDoc = () => JSON.parse(
      app.getState().project.files.find((f) => f.kind === 'app').text);

    // the seed library: list, then by name
    const list = (await tool('jaren_get_templates').execute({}));
    assert.deepStrictEqual(list.map((t) => t.name), ['form', 'dashboard', 'minisite']);
    const seed = (await tool('jaren_get_templates').execute({ name: 'minisite' }));
    assert.strictEqual(typeof seed.doc, 'object');
    assert.match((await tool('jaren_get_templates').execute({ name: 'nope' })).error, /invalid input/,
      'Jaren guards the template enum');

    // write: validates, navigates, lands as the project's app file, boots
    const written = (await tool('jaren_studio_write').execute({ doc: seed.doc }));
    assert.strictEqual(written.ok, true);
    assert.strictEqual(written.revision, app.getState().project.revision,
      'the revision is the stage reboot revision');
    assert.strictEqual(app.getState().route.page, 'project', 'writing navigated to the project IDE');
    assert.deepStrictEqual(appFileDoc(), seed.doc, 'the document IS the app file');
    assert.match(serialize(container), /Wavelength Coffee/, 'the document booted on-page');

    // an invalid document returns the repair instructions, loads nothing
    const rejected = (await tool('jaren_studio_write').execute({ doc: { $app: '9.9' } }));
    assert.strictEqual(rejected.ok, false);
    assert.ok(rejected.errors.length > 0 && rejected.total > 0);
    assert.strictEqual(typeof rejected.errors[0].instancePath, 'string');
    assert.match(rejected.hint, /meta-schema/);
    assert.deepStrictEqual(appFileDoc(), seed.doc, 'the live document was untouched');

    // patch: applied by the suite's own engine, re-validated, live at once.
    // A state-only patch HOT-updates on the project machine: the revision
    // holds (no reboot — the user keeps scroll and inputs), the stage swaps
    const patched = (await tool('jaren_studio_patch').execute({
      patch: [{ op: 'replace', path: '/state/pages/home', value: '# Patched!' }],
    }));
    assert.strictEqual(patched.ok, true);
    assert.strictEqual(patched.revision, written.revision, 'a state-only patch does not reboot');
    assert.match(serialize(container), /Patched!/, 'the patched document is live');

    // a structural patch reboots: the revision bumps
    const retitled = (await tool('jaren_studio_patch').execute({
      patch: [{ op: 'add', path: '/view/rules/0/body/2', value: ['p', {}, 'STRUCTURAL'] }],
    }));
    assert.strictEqual(retitled.ok, true);
    assert.strictEqual(retitled.revision, written.revision + 1, 'a view patch reboots the stage');

    // a patch producing an invalid document is rejected atomically
    const broken = (await tool('jaren_studio_patch').execute({
      patch: [{ op: 'remove', path: '/view' }],
    }));
    assert.strictEqual(broken.ok, false);
    assert.notStrictEqual(appFileDoc().view, undefined, 'the document kept its view');
    assert.strictEqual(app.getState().project.revision, retitled.revision,
      'no revision bump on rejection');

    // a patch that cannot apply reports, never throws
    assert.match((await tool('jaren_studio_patch').execute({
      patch: [{ op: 'replace', path: '/no/such/place', value: 1 }],
    })).error, /failed to apply/);

    // read: whole document, one subtree, and a miss
    assert.deepStrictEqual((await tool('jaren_studio_read').execute({})).doc, appFileDoc());
    assert.deepStrictEqual((await tool('jaren_studio_read').execute({ pointer: '/state/page' })),
      { value: 'home' });
    assert.match((await tool('jaren_studio_read').execute({ pointer: '/nope' })).error, /nothing at/);
    assert.match((await tool('jaren_studio_read').execute({ pointer: 'not-a-pointer' })).error,
      /invalid JSON Pointer/);

    // jaren_save_experiment covers the project (verified, not assumed)
    const saved = (await tool('jaren_save_experiment').execute({ name: 'from-chat' }));
    assert.strictEqual(saved.ok, true);
    assert.ok(saved.names.includes('from-chat'));
    assert.strictEqual(storage().experiments['from-chat'].engine, 'project');

    // patch/read against a project with NO app file report readable errors
    (await app.dispatch('project/template', 'finance'));
    assert.match((await tool('jaren_studio_patch').execute({ patch: [] })).error, /no studio document/);
    assert.match((await tool('jaren_studio_read').execute({})).error, /no studio document/);
  });

  it('the project tools see the WHOLE file tree — a project is not just its app document', async function () {
    /** @type {any[]} */
    let registered = [];
    // mounting is what registers the tools; this test drives them, not the app
    (await mountSite({
      modelContext: { provideContext: ({ tools }) => { registered = tools; } },
    }));
    const tool = (name) => registered.find((t) => t.name === name);

    // the regression this exists for: asked about "my project", a model
    // holding only jaren_studio_read sees ONE app document and answers
    // that there are no other files — confidently, and wrongly
    const listed = (await tool('jaren_project_files').execute({}));
    assert.deepStrictEqual(listed.files.map((f) => f.name),
      ['app.json', 'stats.query', 'stats.data'], 'every file is listed, not just the app');
    assert.strictEqual(listed.active, 'app.json');
    assert.ok(listed.files.every((f) => f.valid), 'each file reports its own validity');

    // one file by name carries its text
    const one = (await tool('jaren_project_files').execute({ name: 'stats.query' }));
    assert.match(one.text, /\$mean/);
    assert.strictEqual(one.kind, 'query');
    assert.match((await tool('jaren_project_files').execute({ name: 'nope' })).error, /no file named/);

    // and it RUNS, so the model reports the real number instead of guessing
    const ran = (await tool('jaren_project_run').execute({ name: 'stats.query' }));
    assert.strictEqual(ran.ok, true);
    assert.match(ran.ran, /3\.875/, 'the run result comes back as readable text');

    // a data file is an input, not something that runs — say so plainly
    assert.match((await tool('jaren_project_run').execute({ name: 'stats.data' })).error,
      /is an input, not something that runs/);
  });

  it('jaren_project_write creates, validates and runs a file; an invalid one is refused', async function () {
    /** @type {any[]} */
    let registered = [];
    const { app, container } = (await mountSite({
      hash: '#/',
      modelContext: { provideContext: ({ tools }) => { registered = tools; } },
    }));
    const tool = (name) => registered.find((t) => t.name === name);

    const written = (await tool('jaren_project_write').execute({
      name: 'top.query', kind: 'query', text: JSON.stringify({ top: { $max: '$.values[*]' } }),
    }));
    assert.strictEqual(written.ok, true);
    assert.strictEqual(app.getState().route.page, 'project', 'the write navigated so the user watches');
    assert.match(written.ran, /9/, 'a runnable file is run against the data file');
    assert.strictEqual(app.getState().project.active, 'top.query', 'and opened');
    assert.match(serialize(container), /top\.query/, 'the rail shows it');

    // an invalid file is REFUSED and the project is left untouched
    const before = app.getState().project.files.length;
    const bad = (await tool('jaren_project_write').execute({
      name: 'broken.query', kind: 'query', text: '{ "x": { "$nope": 1 } }',
    }));
    assert.strictEqual(bad.ok, false);
    assert.ok(bad.errors.length > 0, 'the coded errors come back to repair');
    assert.strictEqual(app.getState().project.files.length, before, 'nothing was written');

    // a new file needs a kind; replacing an existing one does not
    assert.match((await tool('jaren_project_write').execute({ name: 'fresh.data', text: '{}' })).error,
      /needs a kind/);
    assert.strictEqual((await tool('jaren_project_write').execute({
      name: 'top.query', text: JSON.stringify({ top: { $min: '$.values[*]' } }),
    })).ok, true, 'replacing keeps the existing kind');
  });

  it('jaren_get_state answers with the project files when the project is on screen', async function () {
    /** @type {any[]} */
    let registered = [];
    const { app } = (await mountSite({
      modelContext: { provideContext: ({ tools }) => { registered = tools; } },
    }));
    const tool = (name) => registered.find((t) => t.name === name);
    const onProject = (await tool('jaren_get_state').execute({}));
    assert.strictEqual(onProject.page, 'project');
    assert.deepStrictEqual(onProject.files.map((f) => f.name),
      ['app.json', 'stats.query', 'stats.data'], 'the surface reports what it holds');

    // …and still answers with the engine panes on play
    (await app.dispatch('route/set', { page: 'play', params: {} }));
    const onPlay = (await tool('jaren_get_state').execute({}));
    assert.strictEqual(onPlay.page, 'play');
    assert.strictEqual(typeof onPlay.engine, 'string');
  });

  it('a write into a project WITHOUT an app file adds one (and activates it)', async function () {
    /** @type {any[]} */
    let registered = [];
    const { app } = (await mountSite({
      modelContext: { provideContext: ({ tools }) => { registered = tools; } },
    }));
    const tool = (name) => registered.find((t) => t.name === name);
    (await app.dispatch('project/template', 'finance')); // query + data, no app
    const doc = (await tool('jaren_get_templates').execute({ name: 'form' })).doc;
    const written = (await tool('jaren_studio_write').execute({ doc }));
    assert.strictEqual(written.ok, true);
    const p = app.getState().project;
    assert.strictEqual(p.active, 'app.json', 'the added app file is active');
    assert.deepStrictEqual(JSON.parse(p.files.find((f) => f.name === 'app.json').text), doc);
  });
});
