/**
 * The modules the Pages desktop ships with: three shipped components (the
 * Assistant, Settings and About) and one document module (a to-do list, run in
 * a sandboxed frame, that reaches the desktop only through its granted `os`
 * effect).
 */
import type { Kernel, ModuleManifest } from '@tangleai/os';
import type { ShippedMount } from '@tangleai/os/shell';
import { assistantMount } from './assistant-app.ts';
import { settingsMount } from './settings-app.ts';
import type { Preferences } from './preferences.ts';

export const ASSISTANT: ModuleManifest = {
  $module: '0.1', id: 'assistant', version: '1.0.0', category: 'system',
  title: { en: 'Assistant', nl: 'Assistent', de: 'Assistent', fr: 'Assistant', es: 'Asistente', pt: 'Assistente', ar: 'المساعد', ja: 'アシスタント', ko: '어시스턴트', ru: 'Ассистент', tr: 'Asistan', 'zh-TW': '助理' },
  icon: { glyph: 'spark', hue: 285 },
  host: { kind: 'shipped', mount: 'assistant' },
  window: { width: 460, height: 620, minWidth: 340, minHeight: 360, singleton: true },
};

export const SETTINGS: ModuleManifest = {
  $module: '0.1', id: 'settings', version: '1.0.0', category: 'system',
  title: { en: 'Settings', nl: 'Instellingen', de: 'Einstellungen', fr: 'Réglages', es: 'Ajustes', pt: 'Definições', ar: 'الإعدادات', ja: '設定', ko: '설정', ru: 'Настройки', tr: 'Ayarlar', 'zh-TW': '設定' },
  icon: { glyph: 'gear', hue: 215 },
  host: { kind: 'shipped', mount: 'settings' },
  window: { width: 720, height: 560, minWidth: 380, minHeight: 360, singleton: true },
};

export const ABOUT: ModuleManifest = {
  $module: '0.1', id: 'about', version: '1.0.0', category: 'system',
  title: { en: 'About Tangle OS', nl: 'Over Tangle OS', de: 'Über Tangle OS', fr: 'À propos de Tangle OS', es: 'Acerca de Tangle OS', pt: 'Sobre o Tangle OS', ar: 'حول Tangle OS', ja: 'Tangle OS について', ko: 'Tangle OS 정보', ru: 'О Tangle OS', tr: 'Tangle OS hakkında', 'zh-TW': '關於 Tangle OS' },
  icon: { glyph: 'info', hue: 265 },
  host: { kind: 'shipped', mount: 'about' },
  window: { width: 520, height: 420, singleton: true },
};

export const TODO: ModuleManifest = {
  $module: '0.1', id: 'todo', version: '1.0.0', category: 'productivity',
  title: { en: 'To do', nl: 'Taken', de: 'Aufgaben', fr: 'À faire', es: 'Tareas', pt: 'Tarefas', ar: 'المهام', ja: 'やること', ko: '할 일', ru: 'Задачи', tr: 'Yapılacaklar', 'zh-TW': '待辦事項' },
  icon: { glyph: 'check', hue: 150 },
  window: { width: 440, height: 520 },
  styles: `
    .todo-count { color: var(--muted); font-size: 13px; }
    .todo form { display: flex; gap: 8px; margin-block: 12px 16px; }
    .todo form input { flex: 1; }
    .todo ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
    .todo li { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--bg); }
    .todo li.done label { color: var(--muted); text-decoration: line-through; }
    .todo .todo-mail { margin-block-start: 16px; }`,
  host: {
    kind: 'document',
    app: {
      $app: '0.1',
      state: { draft: '', nextId: 3, items: [{ id: 1, text: 'Read the manual', done: true }, { id: 2, text: 'Try the calculator', done: false }], sent: false },
      view: {
        $jslt: '0.1',
        rules: [
          {
            match: '$',
            body: ['div', { class: 'todo' },
              ['h2', {}, 'To do'],
              ['p', { class: 'todo-count' }, { $count: '$.items[?@.done == false]' }, ' open of ', { $count: '$.items[*]' }],
              ['form', { on: { submit: { action: 'add', preventDefault: true } } },
                ['input', { type: 'text', value: '$.draft', placeholder: 'New item', 'aria-label': 'New item', on: { input: 'draft' } }],
                ['button', { type: 'submit', class: 'primary', disabled: { $eq: ['$.draft', ''] } }, 'Add']],
              ['ul', {}, [{ $apply: '$.items[*]' }]],
              ['button', { type: 'button', class: 'todo-mail', on: { click: 'mail' } }, { $if: ['$.sent', 'Summary sent', 'Mail me a summary'] }],
            ],
          },
          {
            match: '$.items[*]',
            body: ['li', { key: { $string: '$.id' }, class: { $if: ['$.done', 'done', 'open'] } },
              ['label', {},
                ['input', { type: 'checkbox', checked: '$.done', on: { change: { action: 'toggle', with: { id: '$.id' } } } }],
                ' ', '$.text'],
              ['button', { type: 'button', on: { click: { action: 'remove', with: { id: '$.id' } } } }, 'Remove']],
          },
        ],
      },
      actions: {
        draft: { patch: [{ op: 'replace', path: '/draft', value: '$event.value' }] },
        add: {
          $if: [{ $eq: ['$.draft', ''] }, null, {
            patch: [
              { op: 'add', path: '/items/-', value: { id: '$.nextId', text: '$.draft', done: false } },
              { op: 'replace', path: '/nextId', value: { $add: ['$.nextId', 1] } },
              { op: 'replace', path: '/draft', value: '' },
            ],
          }],
        },
        toggle: { patch: [{ op: 'replace', path: '/items', value: [{ $for: { i: '$.items[*]' }, $return: { $if: [{ $eq: ['$i.id', '$payload.id'] }, { id: '$i.id', text: '$i.text', done: { $not: '$i.done' } }, '$i'] } }] }] },
        remove: { patch: [{ op: 'replace', path: '/items', value: [{ $for: { i: '$.items[*]' }, $where: { $ne: ['$i.id', '$payload.id'] }, $return: '$i' }] }] },
        mail: {
          effects: [{ run: 'os', with: {
            call: 'mail.send',
            input: { subject: { $concat: [{ $string: { $count: '$.items[?@.done == false]' } }, ' tasks open'] }, body: { $string: { $count: '$.items[*]' } } },
            then: 'sent',
          } }],
        },
        sent: { patch: [{ op: 'replace', path: '/sent', value: true }] },
      },
    },
  },
};

export const builtinModules = (): ModuleManifest[] => [ASSISTANT, ABOUT, TODO, SETTINGS];

/** The shipped components this desktop registers. */
export function shippedMounts(build: () => Promise<any>, host: { kernel: Kernel, prefs: Preferences, open: (id: string) => void }): Record<string, ShippedMount> {
  return {
    assistant: assistantMount(host.kernel, host.prefs, () => host.open('settings')),
    settings: settingsMount(host.prefs),
    about(node, context) {
      const doc = node.ownerDocument;
      const article = doc.createElement('article');
      article.className = 'tos-about';
      const title = doc.createElement('h1'); title.textContent = 'Tangle OS';
      const lead = doc.createElement('p');
      lead.textContent = 'One desktop where every Jaren application is a window, every contract is a tool, and everything you or the assistant design is a document.';
      const facts = doc.createElement('dl');
      article.append(title, lead, facts);
      node.append(article);
      let live = true;
      build().then((info) => {
        if (!live || !info) return;
        const rows: [string, string][] = [['Tangle', info.version], ['Jaren', info.jaren ?? '—'], ['Build', String(info.commit ?? '').slice(0, 8)]];
        for (const [name, value] of rows) {
          const dt = doc.createElement('dt'); dt.textContent = name;
          const dd = doc.createElement('dd'); dd.textContent = value;
          facts.append(dt, dd);
        }
        context.setTitle(`Tangle OS ${info.version}`);
      }).catch(() => {});
      return () => { live = false; article.remove(); };
    },
  };
}
