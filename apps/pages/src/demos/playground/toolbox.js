//@ts-check
/** Model tools use the same public document operations as the mounted editors. */
import { createToolbox } from '@tangleai/agents';
import { createChatClient } from '@tangleai/models';
import { isConfigured } from '@tangleai/assistant';
import { createStudioAdapter, createFlowAdapter, createDataAdapter } from '@tangleai/jaren';
import { resolveProjectFile, writeProjectArtifact } from '@jarenjs/studio';
import { validateFlowDocument } from '@jarenjs/studio/flow';
import { compileJSONPointer, JSONPOINTER_NOTHING } from '@jarenjs/json';
import { TOOL_DEFINITIONS } from './tool-definitions.js';
import { playComponent, legacyExperimentToSession } from './play.js';
import { operatorRegistry, runValidation, projectHost, documentHost } from './services.js';
import { STUDIO_TEMPLATES, studioTemplate } from './appTemplates.js';
import { FLOW_TEMPLATES, flowTemplate } from './flowTemplates.js';
export { SYSTEM_PROMPT } from './prompt.js';
const parse = text => { try { return JSON.parse(text); } catch { return text; } };
export const renderedText = nodes => (nodes ?? []).map(n => {
  if (n === null || typeof n !== 'object') return String(n);
  if (n.kind === 'error') return `ERROR ${n.title}: ${n.message}${n.detail == null ? '' : ` (${n.detail})`}`;
  if (n.kind === 'code') return `${n.title ?? 'output'}: ${n.text}`;
  if (n.kind === 'cards') return n.items.map(i => `${i.title}: ${i.value}`).join(' · ');
  if (n.kind === 'p' || n.kind === 'callout') return n.text;
  return null;
}).filter(line => line !== null).join('\n');
/** @param {any} env */
export function createPageToolbox(env) {
  const toolbox = createToolbox(), go = hash => env.navigate(hash);
  const projectSummary = () => {
    const { document, revision, stageRevision } = env.project().read(), described = projectHost.projectComponent.describe(document);
    return { name: document.name ?? 'Untitled project', active: described.active, revision: stageRevision, documentRevision: revision,
      files: described.files.map(({ name, kind, role, size, valid, errors }) => ({ name, kind, role, size, valid, errors })) };
  };
  const client = () => {
    const settings = env.settings();
    if (!isConfigured(settings)) return null;
    return createChatClient({ ...settings, fetch: env.aiFetch });
  };
  const studio = editor => createStudioAdapter({ editor, operators: operatorRegistry });
  const appFile = () => {
    const before = env.project().read(), file = projectHost.projectAppFile(before.document);
    return { ...before, file, doc: file ? resolveProjectFile(before.document, file.name).doc : null };
  };
  function studioReceipt(result, doc) {
    const audit = documentHost.auditDocumentRender(doc), snapshot = env.project().read();
    return { ...result, revision: snapshot.stageRevision, documentRevision: snapshot.revision, widgets: audit.widgets,
      ...(audit.problems.length ? { renderProblems: audit.problems,
        hint: 'The document is live, but its first frame renders broken pieces — the paths index into the vnode tree your view produced. Repair the view (or the state it reads) and patch again.' } : {}),
      ...(audit.notes.length ? { renderNotes: audit.notes } : {}) };
  }
  async function studioSwap(doc) {
    const checked = documentHost.validateAppDocument(doc);
    if (!checked.valid) return { ok: false, errors: checked.errors, total: checked.total,
      hint: 'The document must validate against the jaren-app meta-schema. Each error carries an instancePath into your document — fix those paths and try again.' };
    const editor = env.project(), before = editor.read(), target = projectHost.projectAppFile(before.document);
    const files = target ? writeProjectArtifact(before.document, target.name, doc)
      : [...before.document.files, { name: 'app.json', kind: 'app', text: JSON.stringify(doc, null, 2) }];
    const result = await editor.replace({ ...before.document, files, active: target?.name ?? 'app.json' }, { expectedRevision: before.revision });
    if (!result.ok) return result;
    go('#/project'); await editor.run(undefined, { restart: false });
    return studioReceipt(result, doc);
  }
  async function runProject(input) {
    const editor = env.project(), before = editor.read(), name = input.name ?? before.document.active;
    const file = before.document.files.find(f => f.name === name);
    if (!file) return { error: `no file named '${name}'`, names: before.document.files.map(f => f.name) };
    if (file.kind === 'state' || file.kind === 'data')
      return { error: `'${name}' is an input, not something that runs. Select a query, stylesheet or schema using it.` };
    go('#/project'); const result = await editor.run(name);
    return { ...result, file: name, kind: file.kind, ...(result.result ? { ran: renderedText(result.result.nodes) } : {}) };
  }
  const handlers = {
    jaren_validate(input) {
      const schemaText = JSON.stringify(input.schema, null, 2), data = typeof input.data === 'string' ? parse(input.data) : (input.data ?? null);
      go('#/play'); env.play().replace(legacyExperimentToSession('validate', { schemaText, data })); return runValidation(schemaText, data);
    },
    jaren_run_engine(input) { const session = legacyExperimentToSession(input.engine, input.inputs);
      if (!session) return { error: `unknown engine: ${input.engine}` }; go('#/play'); return env.play().replace(session); },
    jaren_list_engines() { return Object.fromEntries(Object.entries(playComponent.engines).map(([id, e]) => [id, {
      label: e.label, lead: e.lead ?? '', inputs: [...e.sourcePanes.map(p => ({ key: p.key, kind: 'source', control: p.control ?? 'code' })),
        ...e.dataPanes.map(p => ({ key: p.key, kind: 'data', control: 'json' })), ...(e.optionPanes ?? []).map(p => ({ key: p.key, kind: 'option', options: p.choices.map(c => c.value), default: p.default }))],
      ...(['query', 'jslt', 'jtlt'].includes(id) ? { registeredOperators: operatorRegistry.names() } : {}),
    }])); },
    jaren_get_state() {
      const page = env.page();
      if (page === 'project') return { page, ...projectSummary() };
      if (page === 'play') { const s = env.play().read(); return { page, engine: s.engine, inputs: { ...s.source, ...s.data, ...s.config } }; }
      if (page === 'flow' || page === 'data') return { page, ...env[page]().read() };
      return { page, engine: null, inputs: null };
    },
    jaren_navigate(input) {
      const page = input.page === 'studio' ? 'project' : input.page;
      if (!['home', 'project', 'play', 'flow', 'data', 'game'].includes(page)) return { ok: false, error: `The optional '${page}' page is not hosted here.`, pages: ['home', 'project', 'play', 'flow', 'data', 'game'] };
      go(`#/${page === 'home' ? '' : page}?${new URLSearchParams(input.params ?? {})}`); return { ok: true };
    },
    jaren_get_examples(input) {
      const examples = playComponent.examples.filter(e => e.engine === input.engine).map(e => ({ label: e.label, inputs: { ...e.source, ...(e.datasets[0]?.data ?? {}), ...(e.config ?? {}) } }));
      return input.label === undefined ? examples : examples.find(e => e.label === input.label) ?? { error: `no example labelled '${input.label}'`, labels: examples.map(e => e.label) };
    },
    jaren_project_files(input) {
      const summary = projectSummary(); if (input.name === undefined) return summary;
      const file = env.project().read().document.files.find(f => f.name === input.name);
      return file ? { ...summary.files.find(f => f.name === input.name), text: file.text, revision: summary.revision } : { error: `no file named '${input.name}'`, names: summary.files.map(f => f.name) };
    },
    async jaren_project_author(input) {
      const provider = client(); if (!provider) return { error: 'Configure a provider and model in assistant settings first.' };
      const editor = env.project(), adapter = createStudioAdapter({ editor, client: provider, operators: operatorRegistry });
      const signal = env.requestSignal?.() ?? env.signal;
      const proposal = await adapter.propose(input, { signal });
      if (signal?.aborted) return { ok: false, error: 'Authoring was cancelled.', candidate: proposal.candidate };
      if (!proposal.ok) return proposal;
      const accepted = await adapter.accept(proposal); if (!accepted.ok) return { ...accepted, file: proposal.file };
      go('#/project'); await editor.run(input.name); return { ...accepted, file: proposal.file, attempts: proposal.attempts };
    },
    async jaren_project_write(input) {
      const editor = env.project(), before = editor.read();
      if (!input.kind && !before.document.files.some(file => file.name === input.name))
        return { error: 'A new file needs a kind.' };
      const outcome = await studio(editor).write({ ...input, expectedRevision: before.revision });
      return outcome.ok ? { ...outcome, ...await runProject(input) } : outcome;
    },
    jaren_project_run: runProject,
    jaren_studio_write: input => studioSwap(input.doc),
    async jaren_studio_patch(input) {
      const before = appFile(); if (!before.file) return { error: 'no studio document is loaded — load one with jaren_studio_write or a template first' };
      const editor = env.project(), result = await studio(editor).patchFile(before.file.name, input.patch, { expectedRevision: before.revision });
      if (!result.ok) return result.error ? { ...result, error: `failed to apply patch: ${result.error}` } : result;
      go('#/project'); await editor.run(before.file.name, { restart: false });
      return studioReceipt(result, appFile().doc);
    },
    jaren_studio_read(input) {
      const { doc, revision, stageRevision } = appFile(); if (!doc) return { error: 'no studio document is loaded' };
      if (!input.pointer) return { doc, revision: stageRevision, documentRevision: revision };
      try { const value = compileJSONPointer(input.pointer)(doc); return value === JSONPOINTER_NOTHING ? { error: `nothing at '${input.pointer}' in the current document` } : { value }; }
      catch (error) { return { error: `invalid JSON Pointer: ${error.message}` }; }
    },
    jaren_get_templates(input) { if (input.name === undefined) return STUDIO_TEMPLATES.map(({ name, title, lead }) => ({ name, title, lead }));
      const t = studioTemplate(input.name); return t ? { name: t.name, title: t.title, lead: t.lead, doc: structuredClone(t.doc) } : { error: `no template named '${input.name}'` }; },
    jaren_flow_write: input => env.writeFlow(input.kind, input.doc),
    async jaren_flow_patch(input) { const editor = env.flow(), before = editor.read();
      const result = await createFlowAdapter({ editor }).apply(input.patch, { expectedRevision: before.revision });
      if (result.ok) go('#/flow'); return result; },
    jaren_flow_check(input) { const result = validateFlowDocument(input.kind, input.doc); return { ...result, ok: result.valid }; },
    jaren_flow_get_templates(input) { if (input.name === undefined) return FLOW_TEMPLATES.map(({ name, kind, title, lead }) => ({ name, kind, title, lead }));
      const t = flowTemplate(input.name); return t ? { name: t.name, kind: t.kind, title: t.title, lead: t.lead, doc: structuredClone(t.doc) } : { error: `no template named '${input.name}'` }; },
    jaren_save_experiment: input => env.save(input.name),
    jaren_list_experiments: () => env.saved(),
    jaren_load_experiment: input => env.load(input.name),
    jaren_share_link: () => env.share(),
  };
  for (const definition of TOOL_DEFINITIONS) {
    const schema = structuredClone(definition.inputSchema);
    if (definition.name === 'jaren_navigate') schema.properties.page.enum.push('data', 'game');
    toolbox.add({ ...definition, inputSchema: schema, execute: input => {
      if (env.signal?.aborted) return { ok: false, error: 'This host is disposed.' };
      try { return handlers[definition.name](input); } catch (error) { return { ok: false, error: error.message, code: error.code }; }
    } });
  }
  for (const kind of ['flow', 'data']) toolbox.add({ name: `jaren_${kind}_author`, description: `Propose and validate a ${kind} document, then apply it only if the editor revision is unchanged. Data publication changes buffers; opening or recreating a store is a separate explicit operation.`,
    inputSchema: { type: 'object', properties: { prompt: { type: 'string', minLength: 1 }, kind: { enum: kind === 'flow' ? ['fsm', 'dag'] : ['model', 'query'] } }, required: ['prompt', 'kind'] },
    execute: async input => {
      const provider = client(); if (!provider) return { error: 'Configure a provider and model in assistant settings first.' };
      go(`#/${kind}`); const editor = env[kind](), adapter = (kind === 'flow' ? createFlowAdapter : createDataAdapter)({ editor, client: provider, operators: operatorRegistry });
      const signal = env.requestSignal?.() ?? env.signal;
      const proposal = await adapter.propose(kind === 'data' ? { member: input.kind, prompt: input.prompt } : input, { signal });
      if (signal?.aborted) return { ok: false, error: 'Authoring was cancelled.', candidate: proposal.candidate };
      return proposal.ok ? adapter.accept(proposal) : proposal;
    },
  });
  toolbox.add({ name: 'jaren_data_run', description: 'Run the current Data query and return real results and its query plan. Opening an edited model requires operation "open".',
    inputSchema: { type: 'object', properties: { operation: { enum: ['query', 'open'] } } },
    execute: async input => { go('#/data'); const editor = env.data(); await editor.ready; return editor.run({ operation: input.operation ?? 'query' }); },
  });
  return toolbox;
}
