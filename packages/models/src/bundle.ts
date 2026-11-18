/**
 * One self-contained schema for the wire.
 *
 * Local validation resolves a `$ref` through the `refs` registered with
 * the validator; a provider receives only the schema it is sent, so a
 * reference to another document's `$id` arrives unresolvable. Bundling
 * inlines what the references reach: every resource a `$ref` names by
 * `$id` (with or without a JSON-pointer fragment) is copied into the
 * root's `$defs`, its own `$defs` hoisted beside it, and every reference
 * — the root's and the copies' own — rewritten to a same-document
 * pointer. Nothing is nested deeper than `#/$defs/<name>/…`, because
 * providers that speak `$defs` do not all follow pointers into nested
 * ones. The copies lose their `$id` and `$schema`; the root keeps its own.
 *
 * Only what a reference reaches is copied. A reference that names no
 * known resource is left as written, as the validator would leave it
 * unresolved too. A fragment that is an anchor (`#name`, an `$anchor` or a
 * fragment-only `$id`) is resolved by `@jarenjs/validate/references`, as the
 * validator resolves it, to the JSON pointer of the schema it names, so it
 * lands in the bundle like any pointer; an anchor the resource does not
 * declare is refused. The data
 * keywords `const`, `enum`, `default` and `examples` are never read as
 * schema.
 */

import { collectSameDocumentAnchors } from '@jarenjs/validate/references';

const DATA_KEYWORDS = new Set(['const', 'enum', 'default', 'examples']);

/** The JSON pointer at which `target` sits inside `root`, or null. */
function pointerOf(root: any, target: any): string | null {
  if (root === target) return '';
  if (root === null || typeof root !== 'object') return null;
  for (const [key, value] of Object.entries(root)) {
    if (!Array.isArray(root) && DATA_KEYWORDS.has(key)) continue;
    const below = pointerOf(value, target);
    if (below !== null) return `/${key.replaceAll('~', '~0').replaceAll('/', '~1')}${below}`;
  }
  return null;
}

/** The pointer an anchor of `resource` names, as the validator reads it. */
function anchorPointer(resource: any, anchor: string, id: string): string {
  const node = collectSameDocumentAnchors(resource).get(anchor);
  const pointer = node === undefined ? null : pointerOf(resource, node);
  if (pointer === null) throw new TypeError(`bundleSchema cannot resolve the anchor fragment #${anchor} of ${id}: it declares no such anchor`);
  return pointer;
}

type Json = any;

/** A deep copy of plain JSON. */
const copy = (value: Json): Json => JSON.parse(JSON.stringify(value));

/** `id` without a fragment or a trailing empty one. */
const withoutFragment = (id: string) => id.replace(/#.*$/, '');

/**
 * Inline every resource `schema` reaches through `refs` into its
 * `$defs`, and point every reference there.
 * @throws {TypeError} when a ref lacks a string `$id`, two refs share one,
 *   or a reference names an anchor its resource does not declare
 */
export function bundleSchema(schema: Json, refs: readonly Json[] = []): Json {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema))
    throw new TypeError('bundleSchema needs a JSON Schema object');
  const resources = new Map<string, Json>();
  for (const ref of refs) {
    if (typeof ref?.$id !== 'string' || ref.$id === '') throw new TypeError('every bundled ref needs a string $id');
    const id = withoutFragment(ref.$id);
    if (resources.has(id)) throw new TypeError(`two refs share the $id ${id}`);
    resources.set(id, ref);
  }
  const root = copy(schema);
  const rootId = typeof root.$id === 'string' ? withoutFragment(root.$id) : null;
  const defs: Record<string, Json> = root.$defs !== undefined ? root.$defs : {};
  const taken = new Set(Object.keys(defs));
  const names = new Map<string, string>();
  const pending: string[] = [];
  // the hoisted `$defs` entries of each copied resource: id → key → name,
  // claimed with the resource so a pointer into them resolves at once
  const hoisted = new Map<string, Map<string, string>>();
  // resources whose own root a reference points at (not only its `$defs`)
  const rootUsed = new Set<string>();

  /** A `$defs` name nobody holds yet, derived from `wanted`. */
  const claim = (wanted: string) => {
    const clean = wanted.replace(/[^A-Za-z0-9_.-]/g, '_') || 'schema';
    let name = clean;
    for (let n = 2; taken.has(name); n++) name = `${clean}_${n}`;
    taken.add(name);
    return name;
  };
  /** The name a resource lives under in the bundle; claimed on first use. */
  const nameOf = (id: string) => {
    let name = names.get(id);
    if (name === undefined) {
      const segments = id.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '').split('/').filter(Boolean);
      name = claim(segments.slice(-3).join('.') || 'schema');
      names.set(id, name);
      const entries = new Map<string, string>();
      for (const key of Object.keys(resources.get(id).$defs ?? {})) entries.set(key, claim(`${name}.${key}`));
      hoisted.set(id, entries);
      pending.push(id);
    }
    return name;
  };

  /** The same-document pointer a fragment of resource `id` has in the bundle. */
  const pointerInto = (id: string, fragment: string): string => {
    if (fragment !== '' && !fragment.startsWith('/')) return pointerInto(id, anchorPointer(resources.get(id), fragment, id));
    const match = /^\/\$defs\/([^/]+)(.*)$/.exec(fragment);
    if (match !== null) {
      const key = match[1].replaceAll('~1', '/').replaceAll('~0', '~');
      nameOf(id);
      const entry = hoisted.get(id)!.get(key);
      if (entry !== undefined) return `#/$defs/${entry}${match[2]}`;
    }
    rootUsed.add(id);
    return `#/$defs/${nameOf(id)}${fragment}`;
  };

  /** Rewrite every `$ref` under `node`, read relative to resource `id` (null: the root). */
  const rewrite = (node: Json, id: string | null): void => {
    if (Array.isArray(node)) { for (const item of node) rewrite(item, id); return; }
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (DATA_KEYWORDS.has(key)) continue;
      if (key === '$ref' && typeof value === 'string') node.$ref = resolve(value, id);
      else rewrite(value, id);
    }
  };
  const resolve = (ref: string, id: string | null): string => {
    if (ref.startsWith('#')) return id === null ? ref : pointerInto(id, ref.slice(1));
    const base = id ?? rootId;
    let absolute: string;
    try { absolute = base === null ? new URL(ref).href : new URL(ref, base).href; }
    catch { return ref; }
    const target = withoutFragment(absolute);
    const hash = absolute.indexOf('#');
    const fragment = hash < 0 ? '' : decodeURIComponent(absolute.slice(hash + 1));
    if (target === rootId) return `#${fragment !== '' && !fragment.startsWith('/') ? anchorPointer(schema, fragment, target) : fragment}`;
    if (!resources.has(target)) return ref;
    nameOf(target);
    return pointerInto(target, fragment);
  };

  rewrite(root, null);
  while (pending.length > 0) {
    const id = pending.shift()!;
    const resource = copy(resources.get(id));
    delete resource.$id;
    delete resource.$schema;
    const own: Record<string, Json> = resource.$defs ?? {};
    delete resource.$defs;
    const entries = hoisted.get(id)!;
    rewrite(resource, id);
    if (rootUsed.has(id) || Object.keys(resource).length > 0) defs[names.get(id)!] = resource;
    for (const [key, value] of Object.entries(own)) {
      rewrite(value, id);
      defs[entries.get(key)!] = value;
    }
  }
  if (Object.keys(defs).length > 0) root.$defs = defs;
  return root;
}
