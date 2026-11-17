/**
 * The header bar: what an application puts in its window's title bar, as a
 * JSON document the desktop draws. The application never paints the bar
 * itself, so every bar looks, reads and behaves alike (theme, writing
 * direction, keyboard, screen readers, narrow windows), no application can
 * draw a false close button or a false desktop dialog, and every item is plain
 * data the assistant can read and press through the kernel, under grants and
 * into the ledger, exactly as the person presses it.
 *
 * A header has a `start` and an `end` row of buttons, toggles and menus, a
 * `center` (tabs that switch the window's view, or a search field) that takes
 * the title's place, and a `subtitle` beside the title. Search may also sit
 * at the end. Ids are unique within a header. Glyphs come from the desktop's
 * own set ({@link HEADER_GLYPHS}); a label is always the item's accessible
 * name, and a `shortcut` is a hint the desktop shows, never a key it binds
 * (keys pressed inside a framed application stay in that application).
 * `assistant: false` keeps an item (or a menu entry) from the assistant: it
 * is not listed to it and it cannot press it.
 */

/** A stroke glyph on a 16×16 grid, drawn in the current colour. */
export const HEADER_GLYPHS = {
  back: 'M10 3.5 5.5 8l4.5 4.5',
  forward: 'M6 3.5 10.5 8 6 12.5',
  add: 'M8 3v10M3 8h10',
  refresh: 'M12.5 5.5A5 5 0 1 0 13 9M12.5 2.5v3h-3',
  search: 'M7 2.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM10.5 10.5 13.5 13.5',
  menu: 'M2.5 4.5h11M2.5 8h11M2.5 11.5h11',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  sidebar: 'M2.5 3.5h11v9h-11zM6 3.5v9',
  edit: 'M3 13l1-3.5 6.5-6.5 2.5 2.5L6.5 12zM9 4.5 11.5 7',
  delete: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5',
  share: 'M8 2.5v7.5M5 5.5 8 2.5l3 3M3.5 9v4h9V9',
  filter: 'M2.5 3.5h11L9 8.5v4l-2 1v-5z',
  sort: 'M5 3v10M2.5 10.5 5 13l2.5-2.5M11 13V3M8.5 5.5 11 3l2.5 2.5',
  settings: 'M8 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4',
  star: 'M8 2l1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1L2 6.3l4.2-.5z',
  today: 'M2.5 4h11v9.5h-11zM2.5 7h11M5.5 2.5V5M10.5 2.5V5M7 9.5h2v2H7z',
  download: 'M8 2.5v8M5 7.5l3 3 3-3M3 13.5h10',
  upload: 'M8 10.5v-8M5 5.5l3-3 3 3M3 13.5h10',
  undo: 'M5.5 6.5H10a3 3 0 0 1 0 6H6M5.5 6.5 8 4M5.5 6.5 8 9',
  redo: 'M10.5 6.5H6a3 3 0 0 0 0 6h4M10.5 6.5 8 4M10.5 6.5 8 9',
  view: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  print: 'M4.5 6V2.5h7V6M4.5 11.5h-2V6h11v5.5h-2M4.5 9.5h7v4h-7z',
} as const;
export type HeaderGlyph = keyof typeof HEADER_GLYPHS;
const GLYPHS = Object.keys(HEADER_GLYPHS);

export type HeaderMenuEntry = { separator: true } | { id: string, label: string, checked?: boolean, disabled?: boolean, shortcut?: string, assistant?: boolean };
type Common = { id: string, label: string, glyph?: HeaderGlyph, disabled?: boolean, assistant?: boolean };
export type HeaderButton = Common & { kind: 'button', primary?: boolean, shortcut?: string };
export type HeaderToggle = Common & { kind: 'toggle', pressed: boolean, shortcut?: string };
export type HeaderMenu = Common & { kind: 'menu', entries: HeaderMenuEntry[] };
export type HeaderSearch = { kind: 'search', id: string, label: string, placeholder?: string, value?: string, disabled?: boolean, assistant?: boolean };
export type HeaderTabs = { kind: 'tabs', id: string, label: string, selected: string, items: { id: string, label: string, glyph?: HeaderGlyph, disabled?: boolean }[], assistant?: boolean };
export type HeaderItem = HeaderButton | HeaderToggle | HeaderMenu | HeaderSearch | HeaderTabs;
export type Header = {
  start?: (HeaderButton | HeaderToggle | HeaderMenu)[];
  center?: HeaderTabs | HeaderSearch;
  end?: (HeaderButton | HeaderToggle | HeaderMenu | HeaderSearch)[];
  subtitle?: string;
};
/** What reaches the application when an item is used: `by` is `person`, or the caller that pressed it (`assistant`, a module id). */
export type HeaderActivation = { item: string, value?: string | boolean, by: string };
/** Where a window's activations arrive; return `{ refused }` to say it was not done. */
export type HeaderHandler = (activation: HeaderActivation) => { refused?: string } | void | Promise<{ refused?: string } | void>;

const id = { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,64}$' };
const label = { type: 'string', minLength: 1, maxLength: 64 };
const glyph = { enum: GLYPHS };
const hint = { type: 'string', minLength: 1, maxLength: 24 };
const flag = { type: 'boolean' };
const common = { id, label, glyph, disabled: flag, assistant: flag };
const BUTTON = { type: 'object', additionalProperties: false, required: ['kind', 'id', 'label'], properties: { kind: { const: 'button' }, ...common, primary: flag, shortcut: hint } };
const TOGGLE = { type: 'object', additionalProperties: false, required: ['kind', 'id', 'label', 'pressed'], properties: { kind: { const: 'toggle' }, ...common, pressed: flag, shortcut: hint } };
const ENTRY = {
  anyOf: [
    { type: 'object', additionalProperties: false, required: ['separator'], properties: { separator: { const: true } } },
    { type: 'object', additionalProperties: false, required: ['id', 'label'], properties: { id, label, checked: flag, disabled: flag, shortcut: hint, assistant: flag } },
  ],
};
const MENU = { type: 'object', additionalProperties: false, required: ['kind', 'id', 'label', 'entries'], properties: { kind: { const: 'menu' }, ...common, entries: { type: 'array', minItems: 1, maxItems: 40, items: ENTRY } } };
const SEARCH = {
  type: 'object', additionalProperties: false, required: ['kind', 'id', 'label'],
  properties: { kind: { const: 'search' }, id, label, placeholder: label, value: { type: 'string', maxLength: 200 }, disabled: flag, assistant: flag },
};
const TABS = {
  type: 'object', additionalProperties: false, required: ['kind', 'id', 'label', 'selected', 'items'],
  properties: {
    kind: { const: 'tabs' }, id, label, selected: id, assistant: flag,
    items: { type: 'array', minItems: 2, maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['id', 'label'], properties: { id, label, glyph, disabled: flag } } },
  },
};
/** The header document a window carries: bounded plain JSON, drawn as text only. */
export const HEADER_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    start: { type: 'array', maxItems: 4, items: { anyOf: [BUTTON, TOGGLE, MENU] } },
    center: { anyOf: [TABS, SEARCH] },
    end: { type: 'array', maxItems: 4, items: { anyOf: [BUTTON, TOGGLE, MENU, SEARCH] } },
    subtitle: { type: 'string', maxLength: 120 },
  },
} as const;

/** Every item of a header, in the order the desktop drops them when the bar is narrow (start, then end). */
export function headerItems(header: Header): HeaderItem[] {
  return [...(header.start ?? []), ...(header.center ? [header.center] : []), ...(header.end ?? [])];
}

/** The first id used twice (items, tabs and menu entries share one namespace), or null. */
export function duplicateHeaderId(header: Header): string | null {
  const seen = new Set<string>();
  for (const item of headerItems(header)) {
    const ids = [item.id, ...(item.kind === 'tabs' ? item.items.map(t => t.id) : item.kind === 'menu' ? item.entries.flatMap(e => 'id' in e ? [e.id] : []) : [])];
    for (const each of ids) { if (seen.has(each)) return each; seen.add(each); }
  }
  return null;
}

/** The header as one caller sees it: without what is kept from the assistant (`assistant: false`). */
export function headerFor(header: Header, caller: string): Header {
  if (caller === 'shell') return header;
  const keep = <T extends HeaderItem>(items: T[] | undefined) => items?.filter(i => i.assistant !== false).map(i => i.kind === 'menu' ? { ...i, entries: i.entries.filter(e => !('id' in e) || e.assistant !== false) } : i) as T[] | undefined;
  const out: Header = {};
  const start = keep(header.start), end = keep(header.end);
  if (start?.length) out.start = start;
  if (header.center && header.center.assistant !== false) out.center = header.center;
  if (end?.length) out.end = end;
  if (header.subtitle !== undefined) out.subtitle = header.subtitle;
  return out;
}

/**
 * Check one activation against a header, and the header after it: tabs
 * select, toggles press, search fields hold their text; a button or a menu
 * entry changes nothing the desktop keeps. Returns a refusal code and message
 * when the item is absent, disabled, kept from this caller, or the value does
 * not fit it.
 */
export function activateHeader(header: Header, caller: string, item: string, value: unknown):
  { ok: true, header: Header, value?: string | boolean } | { ok: false, code: 'OS0114' | 'OS0115' | 'OS0116', message: string } {
  const found = headerItems(header).find(i => i.id === item);
  if (!found) return { ok: false, code: 'OS0114', message: `this window's header has no item '${item}'` };
  if (('disabled' in found && found.disabled) || (caller !== 'shell' && found.assistant === false))
    return { ok: false, code: 'OS0115', message: `'${item}' cannot be used now` };
  const misfit = (what: string) => ({ ok: false as const, code: 'OS0116' as const, message: `'${item}' takes ${what}` });
  const replace = (next: HeaderItem): Header => ({
    ...header,
    ...(header.start ? { start: header.start.map(i => i.id === item ? next : i) as Header['start'] } : {}),
    ...(header.center?.id === item ? { center: next as Header['center'] } : {}),
    ...(header.end ? { end: header.end.map(i => i.id === item ? next : i) as Header['end'] } : {}),
  });
  switch (found.kind) {
    case 'button':
      if (value !== undefined) return misfit('no value');
      return { ok: true, header };
    case 'toggle': {
      if (value !== undefined && typeof value !== 'boolean') return misfit('true or false');
      const pressed = value === undefined ? !found.pressed : value;
      return { ok: true, header: replace({ ...found, pressed }), value: pressed };
    }
    case 'menu': {
      const entry = found.entries.find(e => 'id' in e && e.id === value) as Exclude<HeaderMenuEntry, { separator: true }> | undefined;
      if (typeof value !== 'string' || !entry) return misfit(`one of its entries (${found.entries.flatMap(e => 'id' in e ? [e.id] : []).join(', ')})`);
      if (entry.disabled || (caller !== 'shell' && entry.assistant === false)) return { ok: false, code: 'OS0115', message: `'${value}' cannot be used now` };
      return { ok: true, header, value };
    }
    case 'tabs': {
      const tab = found.items.find(t => t.id === value);
      if (typeof value !== 'string' || !tab) return misfit(`one of its tabs (${found.items.map(t => t.id).join(', ')})`);
      if (tab.disabled) return { ok: false, code: 'OS0115', message: `'${value}' cannot be used now` };
      return { ok: true, header: replace({ ...found, selected: value }), value };
    }
    case 'search':
      if (typeof value !== 'string' || value.length > 200) return misfit('a text of at most 200 characters');
      return { ok: true, header: replace({ ...found, value }), value };
  }
}

/**
 * How many of a bar's droppable items fit, in the order they drop (the last
 * first): all of them when their widths fit `available`, otherwise as many
 * as fit beside the "more" button that then holds the rest.
 */
export function fitHeader(widths: readonly number[], available: number, more: number): number {
  const total = widths.reduce((sum, w) => sum + w, 0);
  if (total <= available) return widths.length;
  let used = more, count = 0;
  for (const w of widths) { if (used + w > available) break; used += w; count++; }
  return count;
}

/** `tangle_os_header`: the kernel's own contract over every window's header bar, for the assistant and granted modules. */
export const HEADER_CONTRACT = {
  $contract: '0.1',
  id: 'tangle_os_header',
  operations: {
    'header.list': {
      kind: 'read',
      doc: 'The header bar of every open window that has one: its buttons, toggles, menus, tabs and search fields, with their state (the selected tab, a pressed toggle, the search text).',
      input: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        type: 'object', required: ['windows'],
        properties: { windows: { type: 'array', items: { type: 'object', required: ['window', 'module', 'header'], properties: { window: { type: 'string' }, module: { type: 'string' }, header: HEADER_SCHEMA } } } },
      },
    },
    'header.activate': {
      kind: 'command',
      doc: 'Use one item of a window\'s header bar as the person would: press a button (no value), set a toggle (true or false; without a value it flips), choose a menu entry or a tab (its id), or put a text into a search field. List the headers first.',
      input: {
        type: 'object', additionalProperties: false, required: ['window', 'item'],
        properties: { window: { type: 'string', minLength: 1, maxLength: 128 }, item: id, value: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'boolean' }] } },
      },
      output: { type: 'object' },
    },
  },
} as const;
