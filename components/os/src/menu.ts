/**
 * An application's right-click menu, as a document the desktop draws. The
 * application handles its own right-click (only it knows what was clicked):
 * it registers a default menu for its window (`setContextMenu`), or asks for a
 * menu for one target (`menu(items, at)`); the desktop draws either above the
 * window, outside any frame, in its own look, keyboard and direction, and
 * answers the chosen id. An item is text and a glyph from the desktop's own set,
 * never markup, so a sandboxed application gets a native menu without access.
 */
import { JarenValidator } from '@jarenjs/validate';

const ITEM_ID = { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,64}$' } as const;
const ITEM_FIELDS = {
  id: ITEM_ID,
  label: { type: 'string', minLength: 1, maxLength: 80 },
  glyph: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,31}$' },
  hint: { type: 'string', maxLength: 24 },
  disabled: { type: 'boolean' },
  checked: { type: 'boolean' },
} as const;
const LEAF = { type: 'object', additionalProperties: false, required: ['id', 'label'], properties: ITEM_FIELDS } as const;
/** A submenu holds leaves and separators: one level deep. */
const PARENT = {
  type: 'object', additionalProperties: false, required: ['id', 'label', 'items'],
  properties: { ...ITEM_FIELDS, items: { type: 'array', minItems: 1, maxItems: 24, items: { anyOf: [{ const: 'separator' }, LEAF] } } },
} as const;

/** The menu document: up to 40 entries, each a separator, an item, or an item with a submenu. */
export const MENU_SCHEMA = {
  type: 'array', minItems: 1, maxItems: 40,
  items: { anyOf: [{ const: 'separator' }, LEAF, PARENT] },
} as const;

export type MenuItem = { id: string, label: string, glyph?: string, hint?: string, disabled?: boolean, checked?: boolean, items?: (MenuItem | 'separator')[] };
export type MenuDocument = (MenuItem | 'separator')[];
/** Where to draw a menu, in the page's coordinates (a framed page's own; the desktop translates them). */
export type MenuPoint = { x: number, y: number };

let check: ((value: unknown) => any) | null = null;
/** The menu, checked: every id once across the menu and its submenus; `OS0170` names what is wrong. */
export function checkMenu(value: unknown): { ok: true, value: MenuDocument } | { ok: false, error: { code: string, message: string } } {
  check ??= new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' }).compile(MENU_SCHEMA as any) as any;
  const outcome = check!(value);
  if (!(typeof outcome === 'object' && outcome !== null ? outcome.valid : outcome === true)) {
    const first = (outcome?.errors ?? [])[0];
    return { ok: false, error: { code: 'OS0170', message: `the menu is refused${first ? `: ${first.instancePath || '/'} ${first.message ?? ''}`.trimEnd() : ''}` } };
  }
  const seen = new Set<string>();
  for (const item of (value as MenuDocument).flatMap(i => i === 'separator' ? [] : [i, ...(i.items ?? []).filter((x): x is MenuItem => x !== 'separator')])) {
    if (seen.has(item.id)) return { ok: false, error: { code: 'OS0170', message: `the menu is refused: the id '${item.id}' is used twice` } };
    seen.add(item.id);
  }
  return { ok: true, value: value as MenuDocument };
}

/** A point is two finite numbers; anything else is the top left corner. */
export const menuPoint = (at: unknown): MenuPoint => {
  const p = at as Partial<MenuPoint> | null;
  return { x: Number.isFinite(p?.x) ? Number(p!.x) : 0, y: Number.isFinite(p?.y) ? Number(p!.y) : 0 };
};
