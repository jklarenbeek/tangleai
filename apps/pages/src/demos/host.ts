/** Tangle's route and persistence policy around the complete shared editors. */
import { createDocStore, encodeShare, decodeShare } from '@jarenjs/app';
import { mountStudioEditor } from '@jarenjs/studio/component';
import { mountFlowEditor, validateFlowDocument } from '@jarenjs/studio/flow';
import { mountDataEditor, createProjectDataRuntime } from '@jarenjs/studio/data';
import { createLedger } from '@tangleai/context';
import { createSlotLedgerStorage } from '@tangleai/context/storage/slot';
import { registerModelContext } from '@tangleai/agents';
import { mountAssistant } from '@tangleai/assistant/component';
import { mountGame } from './game/mount.ts';
import { mountPlay } from './playground/mount-play.ts';
import { createPageToolbox, SYSTEM_PROMPT } from './playground/toolbox.ts';
import { projectHost, operatorRegistry } from './playground/services.ts';
import { projectTemplate, PROJECT_TEMPLATE_CARDS, sharedProject, singleAppProject } from './playground/projectTemplates.ts';
import { flowTemplate, FLOW_TEMPLATES } from './playground/flowTemplates.ts';
import { DATA_EXAMPLE } from './playground/dataExample.ts';
import { sessionOf, deepLinkExample, legacyExperimentToSession } from './playground/play.ts';
const volatile = () => { let data: any = null; return { read: () => structuredClone(data), write: (value: any) => { data = structuredClone(value); }, reliable: false }; };
const labels = { project: 'Studio', play: 'Playground', flow: 'Flow', data: 'Data', game: 'Adventure' };
/** @param options */
export function mountPageHost(options: {
  root: HTMLElement;
  assistantNode: HTMLElement;
  landingNode?: HTMLElement;
  [key: string]: any;
}) {
  let appliedToken: any = null;
  let page = 'home', disposed = false, closing: any, assistant: any, binding: any, bindingEpoch = 0;
  const lifetime = new AbortController(), document = options.root.ownerDocument, panes: Record<string, any> = {}, editors: Record<string, any> = {}, snapshots: Record<string, any> = {};
  const slots = { settings: volatile(), transcript: volatile(), ledger: volatile(), projects: volatile(), play: volatile(), ...options.slots };
  const docStore = createDocStore({ storage: slots.projects }), playStore = createDocStore({ storage: slots.play, key: 'play' });
  const ledgerStorage = createSlotLedgerStorage(slots.ledger, { locks: options.locks, singleWriter: options.singleWriter ?? true, name: slots.ledger.key ?? 'tangle-ai-ledger' });
  const ledger = createLedger({ storage: ledgerStorage });
  const removals: any[] = [];
  const listen = (node: any, type: any, fn: any) => { node.addEventListener(type, fn); removals.push(() => node.removeEventListener(type, fn)); };
  const element = (tag: any, parent: any, text?: string) => { const node = document.createElement(tag); if (text) node.textContent = text; parent.appendChild(node); return node; };
  for (const [key, label] of Object.entries(labels)) {
    const section = element('section', options.root); section.setAttribute('data-demo-route', key); section.hidden = true;
    element('h1', section, label);
    const host = element('div', section); host.className = `demo-editor demo-${key}`;
    panes[key] = { section, host };
  }
  const common = { schedule: options.schedule, onError: options.onError };
  const dataRuntime = () => createProjectDataRuntime({ createWorker: options.projectWorker });
  const ensure = (key: any) => {
    if (disposed) throw new Error('The Tangle host is disposed.');
    if (editors[key]) return editors[key];
    const host = panes[key].host;
    if (key === 'project') editors[key] = mountStudioEditor(host, {
      ...common, host: projectHost,
      project: snapshots.project ?? projectTemplate('starter'), projectData: dataRuntime(),
      templates: PROJECT_TEMPLATE_CARDS, projectTemplate, debounceMs: options.debounceMs, download: options.download,
    });
    if (key === 'play') editors[key] = mountPlay(host, { ...common, ...options, state: snapshots.play, store: playStore });
    if (key === 'flow') {
      const saved = snapshots.flow;
      editors[key] = mountFlowEditor(host, {
        ...common, kind: saved?.kind ?? null, document: saved?.document ?? null,
        input: saved?.input, templates: FLOW_TEMPLATES, template: flowTemplate,
        tasks: {
          lookup: async ({ input }: { input?: any; }, signal: any) => {
            await new Promise<void>((resolve, reject) => {
              const abort = () => { clearTimeout(timer); reject(new Error('aborted')); };
              const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 350);
              if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
            });
            return (Array.isArray(input) ? input : []).map((row: any) => ({ ...row, region: 'eu' }));
          }
        },
      });
    }
    if (key === 'data') {
      editors[key] = mountDataEditor(host, {
        ...DATA_EXAMPLE, ...common, operators: operatorRegistry,
        transport: options.transport, lifecycleTarget: options.lifecycleTarget ?? {},
      });
    }
    if (key === 'game') editors[key] = mountGame(host, {
      ...common, state: snapshots.game,
      settings: () => assistant.read().settings, aiFetch: options.aiFetch, saveSlot: options.gameSave, download: options.download
    });
    return editors[key];
  };
  function setRoute(hash: any) {
    if (disposed) return;
    const url = new URL(hash.startsWith('#') ? hash.slice(1) : hash, 'https://tangle.invalid');
    let next = url.pathname.slice(1) || 'home'; if (next === 'studio') next = 'project';
    if (!(next in labels) && next !== 'home') next = 'home';
    if (page !== next && page === 'data' && editors.data) void editors.data.setActive(false);
    if (page !== next && page === 'game' && editors.game) {
      snapshots[page] = editors[page].read(); editors[page].dispose(); delete editors[page];
    }
    page = next; options.root.hidden = page === 'home'; if (options.landingNode) options.landingNode.hidden = page !== 'home';
    for (const [key, pane] of Object.entries(panes)) pane.section.hidden = key !== page;
    const token = url.searchParams.get('s');
    let initialShared = false;
    if (page === 'project' && !editors.project && token && token !== appliedToken) {
      const candidate = sharedProject(decodeShare(token));
      if (candidate) { snapshots.project = candidate; initialShared = true; appliedToken = token; }
    }
    if (page !== 'home') ensure(page);
    if (initialShared) void ensure('project').run();
    if (page === 'data') void ensure('data').setActive(true);
    if (token && token !== appliedToken) {
      appliedToken = token;
      const value = decodeShare(token);
      if (page === 'play' && value) ensure('play').replace(value);
      if (page === 'project' && value) { const candidate = sharedProject(value); if (candidate) { const editor = ensure('project'); void editor.replace(candidate, { expectedRevision: editor.read().revision }).then((result: any) => { if (result.ok && !disposed) void editor.run(); }); } }
    }
    if (page === 'play') { const id = deepLinkExample(Object.fromEntries(url.searchParams)); if (id) ensure('play').dispatch('play/example', id); }
    options.onRoute?.(page);
  }
  function navigate(hash: any) { setRoute(hash); options.navigate?.(hash); }
  async function writeFlow(kind: any, doc: any) {
    const result = validateFlowDocument(kind, doc); if (!result.valid) return { ...result, ok: false as const };
    const editor = ensure('flow'), before = editor.read();
    if (before.kind === kind || before.kind === null) { const receipt = await editor.replace(doc, { kind, expectedRevision: before.revision }); if (receipt.ok) navigate('#/flow'); return receipt; }
    // A deliberate New document changes the mount's identity. In-flight proposals
    // still hold the old editor and cannot publish into the replacement.
    editor.dispose(); delete editors.flow;
    const seed = flowTemplate(kind === 'fsm' ? 'review' : 'enrich');
    snapshots.flow = { kind, document: structuredClone(doc), input: seed.runContext ?? seed.runInput };
    navigate('#/flow'); return { ok: true as const, ...ensure('flow').read() };
  }
  function save(name: any) {
    if (typeof name !== 'string' || !name.trim()) return { ok: false as const, error: 'Give the work a name first.' };
    if (page === 'project') { docStore.save(name, { engine: 'project', project: { ...ensure('project').read().document, name }, savedAt: new Date().toISOString() }); updateSaved(); return { ok: true as const, names: docStore.names() }; }
    playStore.save(name, { ...sessionOf(ensure('play').read()), savedAt: new Date().toISOString() });
    ensure('play').dispatch('play/saved', { name, names: playStore.names() }); return { ok: true as const, names: playStore.names() };
  }
  async function load(name: any) {
    const record = docStore.load(name);
    if (record) {
      const candidate = record.engine === 'project' ? record.project ?? record.inputs?.project
        : record.engine === 'studio' ? singleAppProject(record.inputs?.doc) : sharedProject(record);
      if (!candidate) {
        const session = legacyExperimentToSession(record.engine, record.inputs);
        if (!session) return { ok: false as const, error: 'This record has no supported project or engine.' };
        navigate('#/play'); ensure('play').replace(session, name); return { ok: true as const };
      }
      const editor = ensure('project'), result = await editor.replace(candidate, { expectedRevision: editor.read().revision }); if (result.ok) navigate('#/project'); return result;
    }
    const session = playStore.load(name); if (!session) return { error: `no experiment named '${name}'` };
    navigate('#/play'); ensure('play').replace(session, name); return { ok: true as const };
  }
  async function share() {
    const value = page === 'project' ? { e: 'project', i: { project: ensure('project').read().document } } : sessionOf(ensure('play').read());
    const token = encodeShare(value); if (token.length > 8000) return { ok: false as const, error: 'Too large for a share link; download the document instead.' };
    const hash = `#/${page === 'project' ? 'project' : 'play'}?s=${token}`;
    if (!options.share) return { ok: false as const, error: 'Clipboard sharing is unavailable here.', hash };
    const url = await options.share(hash); return url ? { ok: true as const, url, note: 'A share link was copied to the clipboard.' } : { ok: false as const, error: 'The share link could not be copied.', hash };
  }
  const toolbox = createPageToolbox({
    project: () => ensure('project'), play: () => ensure('play'), flow: () => ensure('flow'), data: () => ensure('data'),
    navigate, page: () => page, writeFlow, settings: () => assistant.read().settings, aiFetch: options.aiFetch, signal: lifetime.signal,
    requestSignal: () => AbortSignal.any([lifetime.signal, assistant.controller.signal]),
    save, load, share, saved: () => ({ experiments: Object.entries(docStore.all()).map(([name, e]) => ({ name, engine: e.engine, savedAt: e.savedAt })), playSessions: playStore.names() }),
  });
  assistant = mountAssistant(options.assistantNode, {
    ...common, title: 'Tangle assistant', launchTitle: 'Open the Tangle assistant',
    intro: 'Ask me to validate a schema or run any playground engine — I drive the playground for you, all in your browser.',
    capabilities: ['Validate a schema or run a playground engine.', 'Author a project file and inspect its result.', 'Edit a workflow or data query.'],
    settingsHint: 'Bring your own key. Your settings stay in this browser. Your key is sent only to the provider you choose.',
    toolbox, system: SYSTEM_PROMPT, headers: { 'X-Title': 'Tangle Pages' }, aiFetch: options.aiFetch,
    aiStorage: slots.settings, aiChat: slots.transcript, ledger, onDispose: () => ledgerStorage.close(),
  });
  function registerWebMcp() {
    binding = registerModelContext(toolbox, undefined, options.onError, { realm: options.realm ?? {}, ...options.webmcp, signal: lifetime.signal });
    return binding;
  }
  registerWebMcp();
  async function refreshWebMcp() { const epoch = ++bindingEpoch; await binding.dispose(); if (!disposed && epoch === bindingEpoch) return registerWebMcp().ready; }
  // The host's saved-project bar sits above the packaged project editor.
  const toolbar = element('div', panes.project.section); toolbar.className = 'demo-project-toolbar'; panes.project.section.insertBefore(toolbar, panes.project.host);
  const nameInput = element('input', toolbar); nameInput.setAttribute('aria-label', 'Project name'); nameInput.placeholder = 'Project name';
  const savedSelect = element('select', toolbar); savedSelect.setAttribute('aria-label', 'Saved project');
  const status = element('span', toolbar); status.setAttribute('role', 'status');
  function updateSaved() {
    while (savedSelect.firstChild) savedSelect.removeChild(savedSelect.firstChild);
    element('option', savedSelect, 'Open saved project').value = ''; for (const name of docStore.names()) element('option', savedSelect, name).value = name;
  }
  updateSaved();
  const button = (label: any, run: any) => { const btn = element('button', toolbar, label); btn.type = 'button'; listen(btn, 'click', () => { void Promise.resolve().then(run).then((r: any) => { status.textContent = r?.error ?? (r?.ok ? label + ' complete' : 'Unavailable'); }, (e: any) => { status.textContent = e.message; }); }); };
  button('Save', () => save(nameInput.value)); button('Share', share);
  button('Download', () => { const done = options.download?.('tangle-project.json', JSON.stringify(ensure('project').read().document, null, 2)); return { ok: done === true }; });
  button('Delete saved', () => { const name = savedSelect.value; if (!name) return { error: 'Choose a saved project.' }; docStore.remove(name); updateSaved(); return { ok: true as const }; });
  listen(savedSelect, 'change', () => { if (savedSelect.value) void load(savedSelect.value).then((r: any) => { status.textContent = r.ok ? 'Project opened' : r.error ?? 'Project refused'; }); });
  setRoute(options.hash ?? '#/');
  return {
    toolbox, assistant, ledger, ledgerStorage, slots, navigate, setRoute, page: () => page,
    project: () => ensure('project'), play: () => ensure('play'), flow: () => ensure('flow'), data: () => ensure('data'), game: () => ensure('game'), writeFlow,
    save, load, share, refreshWebMcp, get webmcp() { return binding; },
    dispose() {
      if (disposed) return closing; disposed = true; bindingEpoch++; lifetime.abort();
      for (const remove of removals) remove(); for (const editor of Object.values(editors)) editor.dispose();
      while (options.root.firstChild) options.root.removeChild(options.root.firstChild);
      closing = Promise.all([assistant.dispose(), binding.dispose()]).then(() => { }); return closing;
    },
  };
}
