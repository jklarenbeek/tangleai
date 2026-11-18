/**
 * `@tangleai/os/authoring`: what a desktop needs so the assistant can write an
 * application for the person, and what it checks before the person sees one.
 * Everything here is model-free and runs the same in Node and in a page.
 *
 * - `authoringCrib()`: the grammar crib an author model is given, with one
 *   complete working example. Its operator names are Jaren's own (a test
 *   compiles every one), never another language's.
 * - `checkAuthoredApp(doc, probes)`: the gate. The document compiles and boots
 *   as Jaren runs it (an unknown operator is named, with the nearest one), its
 *   first frame renders, no string carries another language's code, and every
 *   probe, a scripted use by the person, leaves the text it expects on screen.
 *   A probe is data: it finds an element the way a person does, by its
 *   label, placeholder or text, so it does not depend on the names an author
 *   chose.
 * - `authoredManifest(doc, …)`: the module an authored document becomes. It
 *   asks for nothing and offers nothing (no contracts, files or settings), so
 *   the assistant cannot grant itself anything by writing an application.
 */
import { createApp } from '@jarenjs/app';
import type { LocalizedText, ModuleManifest } from './manifest.ts';

/** A complete working document the crib shows: a to-do list. */
export const AUTHORING_SEED = {
  $app: '0.1',
  state: { draft: '', nextId: 3, items: [{ id: 1, text: 'Read the manual', done: true }, { id: 2, text: 'Try the calculator', done: false }] },
  view: {
    $jslt: '0.1',
    rules: [
      {
        match: '$',
        body: ['div', { class: 'todo' },
          ['h2', {}, 'To do'],
          ['p', { class: 'todo-count' }, { $count: '$.items[?@.done == false]' }, ' open of ', { $count: '$.items[*]' }],
          ['form', { on: { submit: { action: 'add', preventDefault: true } } },
            ['input', { type: 'text', value: '$.draft', placeholder: 'New item', on: { input: 'draft' } }],
            ['button', { type: 'submit', disabled: { $eq: ['$.draft', ''] } }, 'Add']],
          ['ul', {}, [{ $apply: '$.items[*]' }]]],
      },
      {
        match: '$.items[*]',
        body: ['li', { key: { $string: '$.id' }, class: { $if: ['$.done', 'done', 'open'] } },
          ['label', {}, ['input', { type: 'checkbox', checked: '$.done', on: { change: { action: 'toggle', with: { id: '$.id' } } } }], ' ', '$.text'],
          ['button', { type: 'button', on: { click: { action: 'remove', with: { id: '$.id' } } } }, 'Remove']],
      },
    ],
  },
  actions: {
    draft: { patch: [{ op: 'replace', path: '/draft', value: '$event.value' }] },
    add: { $if: [{ $eq: ['$.draft', ''] }, null, { patch: [
      { op: 'add', path: '/items/-', value: { id: '$.nextId', text: '$.draft', done: false } },
      { op: 'replace', path: '/nextId', value: { $add: ['$.nextId', 1] } },
      { op: 'replace', path: '/draft', value: '' },
    ] }] },
    toggle: { patch: [{ op: 'replace', path: '/items', value: [{ $for: { i: '$.items[*]' }, $return: { $if: [{ $eq: ['$i.id', '$payload.id'] }, { id: '$i.id', text: '$i.text', done: { $not: '$i.done' } }, '$i'] } }] }] },
    remove: { patch: [{ op: 'replace', path: '/items', value: [{ $for: { i: '$.items[*]' }, $where: { $ne: ['$i.id', '$payload.id'] }, $return: '$i' }] }] },
  },
} as const;

/** The operators the crib names, each one Jaren's: what an application needs for arithmetic, text, logic and lists. */
export const AUTHORING_OPERATORS = [
  '$add', '$sub', '$mul', '$div', '$mod', '$round', '$floor', '$ceiling', '$abs', '$min', '$max',
  '$eq', '$ne', '$lt', '$gt', '$if', '$not', '$and', '$or',
  '$concat', '$string', '$number', '$lower', '$upper', '$contains', '$string-length', '$tokenize', '$normalize-space',
  '$count', '$sum', '$avg',
] as const;

/** The grammar crib an author model is given, with the seed as its one working example. */
export function authoringCrib(): string {
  return [
    'You write @jarenjs/app documents. This is NOT Schibsted JSLT, jq or JavaScript: never put expressions in strings.',
    '- Document: {"$app": "0.1", "state": {...}, "view": {"$jslt": "0.1", "rules": [...]}, "actions": {...}}.',
    '- A vnode is an ARRAY: ["tag", {props}, ...children]. Never {"tag":…} or {"type":…} objects.',
    '- A string starting with "$" is a path into the current value ("$.amount", "$.items[*]"); any other string is literal text.',
    `- Expressions are objects with one "$operator" key, one of: ${AUTHORING_OPERATORS.join(', ')}. For example {"$add": [a, b]}, {"$round": [x, 2]}, {"$if": [cond, then, else]}, {"$count": "$.items[*]"}, {"$sum": "$.lines[*].total"}, {"$contains": [haystack, needle]}, {"$string-length": text} (characters), {"$count": {"$tokenize": [{"$normalize-space": text}, " "]}} (words).`,
    '- Filters: "$.items[?@.done == false]". Lists: a rule body uses [{"$apply": "$.items[*]"}] and a second rule {"match": "$.items[*]", "body": …} where "$" is the item.',
    '- Events: {"on": {"click": "name"}} or {"on": {"input": {"action": "name", "with": {"id": "$.id"}}}}. In actions "$" is the state, "$event.value" the input\'s string value (read a number with {"$number": "$event.value"}), "$payload" the "with" value.',
    '- An action returns {"patch": [RFC 6902 ops whose "value" may be an expression]}. Rebuild a list with FLWOR: [{"$for": {"i": "$.items[*]"}, "$where": cond, "$return": expr}]; use {"$for": {"i": {"$in": "$.items[*]", "$at": "n"}}, …} for the 0-based position "$n".',
    '- Give every input a label or a placeholder, and every button its text, so a person can tell what each one does.',
    'A complete working example (a to-do list):',
    JSON.stringify(AUTHORING_SEED),
  ].join('\n');
}

/** A string that is another language's code, which the view would show as text. */
const CODE = /(^\.[a-z_][\w.[\]]*$)|\bfor \.|\bfor \$|\bif \(|\bsize\(|\brange\(|\$\{|\{\{|=>/;

/** What the compiler cannot see: object-shaped vnodes and code written in strings. */
export function lintAuthoredApp(doc: unknown): string[] {
  const problems: string[] = [];
  const walk = (value: any, path: string) => {
    if (typeof value === 'string') { if (CODE.test(value)) problems.push(`${path}: a string that is code in another language (${JSON.stringify(value.slice(0, 60))}); write it as a Jaren expression object`); return; }
    if (Array.isArray(value)) { value.forEach((v, i) => walk(v, `${path}/${i}`)); return; }
    if (value && typeof value === 'object') {
      if (('tag' in value || 'type' in value) && ('props' in value || 'children' in value)) problems.push(`${path}: an object-shaped vnode; write ["tag", {props}, ...children]`);
      for (const [k, v] of Object.entries(value)) walk(v, `${path}/${k}`);
    }
  };
  walk((doc as any)?.view, '/view');
  walk((doc as any)?.actions, '/actions');
  return problems;
}

/** The text a rendered tree shows, with each field's current value. */
export function textOfVnode(vnode: any): string {
  if (vnode == null || typeof vnode === 'boolean') return '';
  if (typeof vnode === 'string' || typeof vnode === 'number') return String(vnode);
  if (Array.isArray(vnode)) {
    if (typeof vnode[0] === 'string' && (vnode[1] === undefined || (vnode[1] && typeof vnode[1] === 'object' && !Array.isArray(vnode[1])))) {
      const own = ['input', 'textarea', 'select'].includes(vnode[0]) && vnode[1]?.value != null ? `${vnode[1].value} ` : '';
      return own + vnode.slice(2).map(textOfVnode).join(' ');
    }
    return vnode.map(textOfVnode).join(' ');
  }
  return '';
}

/**
 * One use by the person. `find` names an element as they would see it: its
 * `role` (`button`, `field`, `checkbox`, `select`), a `name` pattern matched
 * case-insensitively against its label, placeholder, accessible name or text,
 * and `nth` among the matches.
 */
export type ProbeStep = { find: { role: 'button' | 'field' | 'checkbox' | 'select', name?: string, nth?: number }, type?: string, checked?: boolean };
/** A scripted use and what the screen shows after it: `text` that must appear, `absent` that must not. */
export type AppProbe = { steps: ProbeStep[], expect: { text?: string[], absent?: string[] } };
export type AuthoringVerdict = { ok: boolean, problems: string[], shown?: string };

type Found = { role: ProbeStep['find']['role'], names: string, props: any, bindings: Record<string, any> };
/** The words of every `<label for>`, by the id of the field it names. */
function labelsFor(vnode: any, out = new Map<string, string>()): Map<string, string> {
  if (!Array.isArray(vnode)) return out;
  if (typeof vnode[0] === 'string' && vnode[1] && typeof vnode[1] === 'object' && !Array.isArray(vnode[1])) {
    if (vnode[0] === 'label' && typeof vnode[1].for === 'string') out.set(vnode[1].for, `${out.get(vnode[1].for) ?? ''} ${vnode.slice(2).map(textOfVnode).join(' ')}`);
    vnode.slice(2).forEach((c: any) => labelsFor(c, out));
  } else vnode.forEach((c: any) => labelsFor(c, out));
  return out;
}

/** Every element a person can use, with what names it for them (a wrapping label, a `<label for>`, its own words). */
function usable(vnode: any, label = '', out: Found[] = [], named: Map<string, string> = labelsFor(vnode)): Found[] {
  if (!Array.isArray(vnode)) return out;
  if (typeof vnode[0] !== 'string' || !vnode[1] || typeof vnode[1] !== 'object' || Array.isArray(vnode[1])) { vnode.forEach(v => usable(v, label, out, named)); return out; }
  const [tag, props] = vnode, children = vnode.slice(2);
  const said = children.map(textOfVnode).join(' ');
  const here = tag === 'label' ? `${label} ${said}` : label;
  const own = [props.placeholder, props['aria-label'], props.title, props.name, props.id, typeof props.id === 'string' ? named.get(props.id) : undefined].filter(v => typeof v === 'string').join(' ');
  const role = tag === 'button' || (tag === 'input' && ['button', 'submit'].includes(props.type)) ? 'button'
    : tag === 'input' && props.type === 'checkbox' ? 'checkbox'
    : tag === 'select' ? 'select'
    : tag === 'input' || tag === 'textarea' ? 'field' : null;
  if (role) out.push({ role, names: `${here} ${own} ${role === 'button' ? said : ''}`.toLowerCase(), props, bindings: props.on ?? {} });
  // a form's submit reaches the form's own binding
  if (tag === 'form' && props.on?.submit) for (const found of usable(children, here, [], named)) out.push(found.role === 'button' && (found.props.type ?? 'submit') === 'submit' ? { ...found, bindings: { ...found.bindings, click: found.bindings.click ?? props.on.submit } } : found);
  else children.forEach((c: any) => usable(c, here, out, named));
  return out;
}

/** The checks a document passes before any use, synchronously: the lint, the compile and a first frame with text. */
export function gateAuthoredApp(doc: unknown): { problems: string[], firstText: string } {
  if (!doc || typeof doc !== 'object' || (doc as any).$app !== '0.1') return { problems: ['the document is not a Jaren application: it needs "$app": "0.1"'], firstText: '' };
  const problems = lintAuthoredApp(doc);
  let first: any;
  try { first = createApp(doc as any, { onError: (error: unknown) => { throw error; } } as any); }
  catch (error: any) { return { problems: [...problems, `it does not compile: ${String(error?.message ?? error).slice(0, 300)}`], firstText: '' }; }
  let firstText = '';
  try { firstText = textOfVnode(first.getVnode()); }
  catch (error: any) { return { problems: [...problems, `its first frame fails: ${String(error?.message ?? error).slice(0, 300)}`], firstText: '' }; }
  finally { first.destroy?.(); }
  if (!firstText.trim()) problems.push('its first frame shows no text');
  return { problems, firstText };
}

/** Run a document and every probe on it, model-free; the first problem names what to fix. */
export async function checkAuthoredApp(doc: unknown, probes: readonly AppProbe[] = []): Promise<AuthoringVerdict> {
  const { problems, firstText } = gateAuthoredApp(doc);
  if (problems.some(p => /^(it does not compile|its first frame fails|the document is not)/.test(p))) return { ok: false, problems };
  const boot = () => createApp(doc as any, { onError: (error: unknown) => { throw error; } } as any) as any;
  let shown = firstText;
  for (const [index, probe] of probes.entries()) {
    let app: any;
    try {
      app = boot();
      for (const step of probe.steps) {
        const pattern = step.find.name ? new RegExp(step.find.name, 'i') : null;
        const matches = usable(app.getVnode()).filter(f => f.role === step.find.role && (!pattern || pattern.test(f.names)));
        const target = matches[step.find.nth ?? 0];
        if (!target) throw new Error(`there is no ${step.find.role}${pattern ? ` named like /${step.find.name}/` : ''} to use`);
        const event = step.find.role === 'button' ? 'click' : step.find.role === 'checkbox' ? 'change' : (target.bindings.input ? 'input' : 'change');
        const binding = target.bindings[event] ?? target.bindings.change ?? target.bindings.input;
        if (!binding) throw new Error(`the ${step.find.role} named like /${step.find.name ?? ''}/ does nothing when used`);
        const action = typeof binding === 'string' ? binding : binding.action;
        const payload = typeof binding === 'string' ? null : binding.with ?? null;
        app.dispatch(action, payload, { type: event, target: { value: step.type ?? '', checked: step.checked ?? !target.props.checked }, preventDefault() {}, stopPropagation() {} });
        await app.settled?.();
      }
      shown = textOfVnode(app.getVnode());
      const flat = (s: string) => s.replace(/\s+/g, '').toLowerCase();
      for (const t of probe.expect.text ?? []) if (!flat(shown).includes(flat(t))) problems.push(`use ${index + 1}: afterwards the screen should show "${t}"; it shows: ${shown.replace(/\s+/g, ' ').slice(0, 200)}`);
      for (const t of probe.expect.absent ?? []) if (flat(shown).includes(flat(t))) problems.push(`use ${index + 1}: afterwards the screen should not show "${t}"`);
    } catch (error: any) { problems.push(`use ${index + 1}: ${String(error?.message ?? error).slice(0, 240)}`); }
    finally { app?.destroy?.(); }
  }
  return { ok: problems.length === 0, problems, shown: shown.replace(/\s+/g, ' ').trim().slice(0, 400) };
}

/** The module an authored document becomes: a document module that asks for nothing and offers nothing. */
export function authoredManifest(doc: unknown, options: { id: string, title: LocalizedText, hue?: number }): ModuleManifest {
  return {
    $module: '0.1', id: options.id, version: '1.0.0', category: 'custom',
    title: options.title, icon: { glyph: 'app', hue: options.hue ?? 160 },
    host: { kind: 'document', app: doc },
  } as ModuleManifest;
}
