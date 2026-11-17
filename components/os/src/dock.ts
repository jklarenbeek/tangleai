/**
 * The dock as a document. Each installed module is one icon, or one icon per
 * launch entry when its manifest lists `entries` (an application whose
 * screens live inside one page puts each screen in the dock). A person's
 * dock is a small JSON document: the order of its icons and folders, and the
 * icons they hid. Everything here is pure: the shell draws a dock arranged by
 * {@link arrangeDock}, and every edit (move, hide, show, group, take out,
 * rename) is a function from one layout to the next, normalized so that
 * every icon appears exactly once, no folder is empty, and a folder of one
 * icon dissolves into that icon.
 *
 * Manifests place only their own icons, into folders they name in
 * `dock.folders` (a suite's manifests share folder ids), and only the first
 * time an icon appears: once a person has moved it, their dock wins. With no
 * saved layout and no manifest folders, the dock is every icon in install
 * order, as it always was.
 */
import { localized, type LocalizedText, type ModuleManifest } from './manifest.ts';

/** A folder in a layout: its icons, and its title only when the person named it. */
export type DockFolder = { folder: string, title?: string, items: string[] };
export type DockLayout = { $dock: '0.1', items: (string | DockFolder)[], hidden: string[] };
/** One dock icon: a module, or one launch entry of a module (`<module>/<entry>`). */
export type DockIcon = {
  id: string, module: string, entry?: string, screen?: string,
  title: string, icon?: { glyph: string, hue?: number }, folder?: string,
};
export type DockView = {
  items: ({ kind: 'icon', icon: DockIcon } | { kind: 'folder', id: string, title: string, icons: DockIcon[] })[],
  hidden: DockIcon[],
};

const ID = '^[A-Za-z0-9._:/-]{1,160}$';
/** The layout document: bounded plain JSON, checked before it is kept. */
export const DOCK_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['$dock', 'items', 'hidden'],
  properties: {
    $dock: { const: '0.1' },
    items: {
      type: 'array', maxItems: 400,
      items: {
        anyOf: [
          { type: 'string', pattern: ID },
          {
            type: 'object', additionalProperties: false, required: ['folder', 'items'],
            properties: {
              folder: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,64}$' },
              title: { type: 'string', minLength: 1, maxLength: 64 },
              items: { type: 'array', maxItems: 200, items: { type: 'string', pattern: ID } },
            },
          },
        ],
      },
    },
    hidden: { type: 'array', maxItems: 400, items: { type: 'string', pattern: ID } },
  },
} as const;

export const emptyDock = (): DockLayout => ({ $dock: '0.1', items: [], hidden: [] });

/** Every icon the installed modules put in the dock, in install order. */
export function dockIcons(manifests: readonly ModuleManifest[], locale = 'en'): DockIcon[] {
  const out: DockIcon[] = [];
  for (const m of manifests) {
    if (m.entries?.length) {
      for (const e of m.entries) out.push({
        id: `${m.id}/${e.id}`, module: m.id, entry: e.id, ...(e.screen !== undefined ? { screen: e.screen } : {}),
        title: localized(e.title, locale), ...(e.icon ?? m.icon ? { icon: e.icon ?? m.icon } : {}), ...(e.folder ? { folder: e.folder } : {}),
      });
    } else out.push({ id: m.id, module: m.id, title: localized(m.title, locale), ...(m.icon ? { icon: m.icon } : {}), ...(m.dock?.folder ? { folder: m.dock.folder } : {}) });
  }
  return out;
}

/** The titles manifests give their folders, the first manifest naming a folder winning. */
export function folderTitles(manifests: readonly ModuleManifest[], locale = 'en'): Map<string, string> {
  const titles = new Map<string, string>();
  for (const m of manifests) for (const f of m.dock?.folders ?? []) if (!titles.has(f.id)) titles.set(f.id, localized(f.title as LocalizedText, locale));
  return titles;
}

const isFolder = (item: string | DockFolder): item is DockFolder => typeof item !== 'string';
const idsOf = (layout: DockLayout) => [...layout.items.flatMap(i => isFolder(i) ? i.items : [i]), ...layout.hidden];

/**
 * The one shape every layout keeps: each id once (its first place wins), no
 * empty folder, a folder of one dissolved into its icon in place, and no id
 * both shown and hidden. Normalizing twice changes nothing.
 */
export function normalizeDock(layout: DockLayout): DockLayout {
  const seen = new Set<string>();
  const take = (id: string) => { if (seen.has(id)) return false; seen.add(id); return true; };
  const hidden = layout.hidden.filter(take);
  const items: (string | DockFolder)[] = [];
  const folders = new Set<string>();
  for (const item of layout.items) {
    if (!isFolder(item)) { if (take(item)) items.push(item); continue; }
    if (folders.has(item.folder)) continue;
    const members = item.items.filter(take);
    if (members.length === 0) continue;
    if (members.length === 1) { items.push(members[0]); continue; }
    folders.add(item.folder);
    items.push({ folder: item.folder, ...(item.title !== undefined ? { title: item.title } : {}), items: members });
  }
  return { $dock: '0.1', items, hidden };
}

/**
 * The person's layout with every newly installed icon placed: into the
 * folder its manifest names (made at the end when it is not there yet, with
 * every newcomer that names it), else at the end. An icon the layout already
 * holds, shown, foldered or hidden, stays where the person put it; one whose
 * module is gone stays in the layout (so it returns to its place when the
 * module does) but not in the view.
 */
export function arrangeDock(saved: DockLayout | null | undefined, icons: readonly DockIcon[], titles: ReadonlyMap<string, string> = new Map(), fallbackTitle = 'Folder'): { layout: DockLayout, view: DockView } {
  const base = normalizeDock(saved ?? emptyDock());
  const known = new Set(idsOf(base));
  const items = base.items.map(i => isFolder(i) ? { ...i, items: [...i.items] } : i);
  for (const icon of icons) {
    if (known.has(icon.id)) continue;
    known.add(icon.id);
    if (icon.folder) {
      const folder = items.find((i): i is DockFolder => isFolder(i) && i.folder === icon.folder);
      if (folder) folder.items.push(icon.id);
      else items.push({ folder: icon.folder, items: [icon.id] });
    } else items.push(icon.id);
  }
  const layout = normalizeDock({ $dock: '0.1', items, hidden: base.hidden });
  const byId = new Map(icons.map(i => [i.id, i]));
  const view: DockView = { items: [], hidden: layout.hidden.flatMap(id => byId.get(id) ?? []) };
  for (const item of layout.items) {
    if (!isFolder(item)) { const icon = byId.get(item); if (icon) view.items.push({ kind: 'icon', icon }); continue; }
    const members = item.items.flatMap(id => byId.get(id) ?? []);
    if (members.length === 0) continue;
    if (members.length === 1) { view.items.push({ kind: 'icon', icon: members[0] }); continue; }
    view.items.push({ kind: 'folder', id: item.folder, title: item.title ?? titles.get(item.folder) ?? fallbackTitle, icons: members });
  }
  return { layout, view };
}

/** Where an icon sits: its top-level index, and its folder and index there when it is in one. */
function locate(layout: DockLayout, id: string): { top: number, folder?: DockFolder, inner?: number } | null {
  for (let top = 0; top < layout.items.length; top++) {
    const item = layout.items[top];
    if (item === id) return { top };
    if (isFolder(item)) { const inner = item.items.indexOf(id); if (inner >= 0) return { top, folder: item, inner }; }
  }
  return null;
}
const without = (layout: DockLayout, id: string): DockLayout => ({
  $dock: '0.1',
  items: layout.items.map(i => isFolder(i) ? { ...i, items: i.items.filter(x => x !== id) } : i).filter(i => i !== id),
  hidden: layout.hidden.filter(x => x !== id),
});

/** Put an icon (or a whole folder, by its folder id) at a top-level position, out of any folder it was in. */
export function moveInDock(layout: DockLayout, id: string, index: number): DockLayout {
  const folderAt = layout.items.findIndex(i => isFolder(i) && i.folder === id);
  if (folderAt >= 0) {
    const items = [...layout.items];
    const [folder] = items.splice(folderAt, 1);
    items.splice(Math.max(0, Math.min(index > folderAt ? index - 1 : index, items.length)), 0, folder);
    return normalizeDock({ ...layout, items });
  }
  const from = locate(layout, id);
  const rest = without(layout, id);
  // an index counted before the icon left its own top-level place moves one back
  const at = from && from.folder === undefined && index > from.top ? index - 1 : index;
  const items = [...rest.items];
  items.splice(Math.max(0, Math.min(at, items.length)), 0, id);
  return normalizeDock({ ...rest, items });
}

export function hideInDock(layout: DockLayout, id: string): DockLayout {
  const rest = without(layout, id);
  return normalizeDock({ ...rest, hidden: [...rest.hidden, id] });
}

/** Show a hidden icon again, at the end of the dock. */
export function showInDock(layout: DockLayout, id: string): DockLayout {
  const rest = without(layout, id);
  return normalizeDock({ ...rest, items: [...rest.items, id] });
}

/**
 * Drop one icon on another: on a folder it joins the folder; on an icon the
 * two become a new folder where the target was. `folderId` names a new folder.
 */
export function groupInDock(layout: DockLayout, dragged: string, target: string, folderId: string): DockLayout {
  if (dragged === target) return normalizeDock(layout);
  const rest = without(layout, dragged);
  const folder = rest.items.find((i): i is DockFolder => isFolder(i) && (i.folder === target || i.items.includes(target)));
  if (folder) return normalizeDock({ ...rest, items: rest.items.map(i => i === folder ? { ...folder, items: [...folder.items, dragged] } : i) });
  const at = rest.items.indexOf(target);
  if (at < 0) return normalizeDock(layout);
  const used = new Set(rest.items.flatMap(i => isFolder(i) ? [i.folder] : []));
  let id = folderId, n = 2;
  while (used.has(id)) id = `${folderId}-${n++}`;
  const items = [...rest.items];
  items.splice(at, 1, { folder: id, items: [target, dragged] });
  return normalizeDock({ ...rest, items });
}

/** Name a folder (an empty title goes back to the manifest's, or the default). */
export function renameDockFolder(layout: DockLayout, folder: string, title: string): DockLayout {
  const clean = title.trim().slice(0, 64);
  return normalizeDock({ ...layout, items: layout.items.map(i => isFolder(i) && i.folder === folder ? (clean ? { ...i, title: clean } : { folder: i.folder, items: i.items }) : i) });
}

/** What changes from one layout to another, for the person to read before accepting it. */
export function dockChanges(before: DockLayout, after: DockLayout): { moved: string[], hidden: string[], shown: string[], folders: { id: string, items: string[] }[] } {
  const a = normalizeDock(before), b = normalizeDock(after);
  const order = (l: DockLayout) => l.items.flatMap(i => isFolder(i) ? i.items : [i]);
  const was = order(a), now = order(b);
  const hiddenBefore = new Set(a.hidden), hiddenAfter = new Set(b.hidden);
  const folderOf = (l: DockLayout) => new Map(l.items.flatMap(i => isFolder(i) ? i.items.map(x => [x, i.folder] as const) : []));
  const fa = folderOf(a), fb = folderOf(b);
  const before_ = new Map(was.map((id, i) => [id, i]));
  return {
    moved: now.filter((id, i) => before_.has(id) && (before_.get(id) !== i || fa.get(id) !== fb.get(id))),
    hidden: b.hidden.filter(id => !hiddenBefore.has(id)),
    shown: now.filter(id => hiddenBefore.has(id) && !hiddenAfter.has(id)),
    folders: b.items.filter(isFolder).filter(f => JSON.stringify(a.items.find(i => isFolder(i) && i.folder === f.folder)) !== JSON.stringify(f)).map(f => ({ id: f.folder, items: f.items })),
  };
}
