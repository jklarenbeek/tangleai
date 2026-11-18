/**
 * The modules the Pages desktop ships with: Welcome, the Assistant, the work
 * applications (Studio, Playground, Flow, Data), Calculator and Converter, the memory loop, the
 * adventure, Settings, moving browser data and About as shipped components,
 * and one document module (a to-do list, run in a sandboxed frame, that
 * reaches the desktop only through its granted `os` effect).
 */
import type { Kernel, LocalizedText, ModuleManifest, OsCatalogue } from '@tangleai/os';
import type { ShippedMount } from '@tangleai/os/shell';
import { assistantMount } from './assistant-app.ts';
import { settingsSections, initialSection } from './settings-app.ts';
import { settingsModule, SETTINGS_CONTRACT } from '@tangleai/os/settings';
import type { Preferences } from './preferences.ts';
import { welcomeMount } from './welcome-app.ts';
import { loopMount } from './loop-app.ts';
import { calendarMount, calendarSettingsMount, CALENDAR_CONTRACT } from './calendar-app.ts';
import { calcMount } from './calc-app.ts';
import { englishOf, localizedKeywords, localizedText, t } from './i18n.ts';

/** The translations of a title shipped with the desktop; the English comes from the catalogue, and an active pack's own sentence wins. */
const shipped = (nl: string, de: string, fr: string, es: string, pt: string, ar: string, ja: string, ko: string, ru: string, tr: string, zhTW: string) =>
  ({ nl, de, fr, es, pt, ar, ja, ko, ru, tr, 'zh-TW': zhTW });
const app = (id: string, title: LocalizedText, glyph: string, hue: number, window: ModuleManifest['window'], category: ModuleManifest['category'] = 'development'): ModuleManifest =>
  ({ $module: '0.1', id, version: '1.0.0', category, title, icon: { glyph, hue }, host: { kind: 'shipped', mount: id }, window: { singleton: true, ...window } });
/** The product's name, the same in every language. */
const PRODUCT = 'Tangle OS';

/**
 * The shipped manifests, built when asked so their titles speak the pack and
 * language set before the desktop mounts.
 */
export function builtinModules(): ModuleManifest[] {
  const WELCOME = app('welcome', localizedText(englishOf('apps/welcome'), t('apps/welcome'), shipped('Welkom', 'Willkommen', 'Bienvenue', 'Bienvenida', 'Boas-vindas', 'مرحبًا', 'ようこそ', '환영합니다', 'Добро пожаловать', 'Hoş geldiniz', '歡迎')), 'welcome', 178, { width: 780, height: 700, minWidth: 360, minHeight: 360 }, 'system');
  const CALENDAR: ModuleManifest = {
    ...app('calendar', localizedText(englishOf('apps/calendar'), t('apps/calendar'), shipped('Agenda', 'Kalender', 'Calendrier', 'Calendario', 'Calendário', 'التقويم', 'カレンダー', '캘린더', 'Календарь', 'Takvim', '行事曆')), 'calendar', 350, { width: 1060, height: 720, minWidth: 560, minHeight: 440 }, 'productivity'),
    provides: [CALENDAR_CONTRACT as any],
    // an iCalendar file opened from Files is imported
    opens: [{ type: 'text/calendar' }],
    // its working hours live in the desktop's Settings, beside every other application's
    settings: { kind: 'mount', mount: 'calendar-settings', title: localizedText(englishOf('apps/calendar'), t('apps/calendar')), keywords: localizedKeywords(englishOf('apps/calendar-keywords'), t('apps/calendar-keywords')) },
  };
  const STUDIO = app('studio', localizedText(englishOf('apps/studio'), t('apps/studio'), shipped('Studio', 'Studio', 'Studio', 'Estudio', 'Estúdio', 'الاستوديو', 'スタジオ', '스튜디오', 'Студия', 'Stüdyo', '工作室')), 'studio', 200, { width: 1180, height: 760, minWidth: 520, minHeight: 420 });
  const PLAYGROUND = app('playground', localizedText(englishOf('apps/playground'), t('apps/playground'), shipped('Speeltuin', 'Spielwiese', 'Bac à sable', 'Área de pruebas', 'Área de testes', 'ساحة التجربة', 'プレイグラウンド', '플레이그라운드', 'Песочница', 'Deneme alanı', '遊樂場')), 'playground', 320, { width: 1180, height: 760, minWidth: 520, minHeight: 420 });
  const FLOW = app('flow', localizedText(englishOf('apps/flow'), t('apps/flow'), shipped('Flow', 'Flow', 'Flow', 'Flujo', 'Fluxo', 'التدفق', 'フロー', '플로', 'Поток', 'Akış', '流程')), 'flow', 260, { width: 1100, height: 720, minWidth: 520, minHeight: 420 });
  const DATA = app('data', localizedText(englishOf('apps/data'), t('apps/data'), shipped('Data', 'Daten', 'Données', 'Datos', 'Dados', 'البيانات', 'データ', '데이터', 'Данные', 'Veri', '資料')), 'data', 30, { width: 1100, height: 720, minWidth: 520, minHeight: 420 });
  const CALCULATOR = app('calculator', localizedText(englishOf('apps/calculator'), t('apps/calculator'), shipped('Rekenmachine', 'Rechner', 'Calculatrice', 'Calculadora', 'Calculadora', 'الآلة الحاسبة', '電卓', '계산기', 'Калькулятор', 'Hesap makinesi', '計算機')), 'calculator', 205, { width: 480, height: 680, minWidth: 340, minHeight: 480 }, 'productivity');
  const CONVERTER = app('converter', localizedText(englishOf('apps/converter'), t('apps/converter'), shipped('Omrekenen', 'Umrechner', 'Convertisseur', 'Conversor', 'Conversor', 'المحوّل', '単位換算', '변환기', 'Конвертер', 'Dönüştürücü', '換算器')), 'converter', 40, { width: 420, height: 600, minWidth: 340, minHeight: 440 }, 'productivity');
  const LOOP = app('loop', localizedText(englishOf('apps/loop'), t('apps/loop'), shipped('Geheugenlus', 'Gedächtnisschleife', 'Boucle de mémoire', 'Bucle de memoria', 'Ciclo de memória', 'حلقة الذاكرة', 'メモリーループ', '메모리 루프', 'Цикл памяти', 'Bellek döngüsü', '記憶迴圈')), 'loop', 178, { width: 820, height: 700, minWidth: 380, minHeight: 360 }, 'productivity');
  const ADVENTURE = app('adventure', localizedText(englishOf('apps/adventure'), t('apps/adventure'), shipped('Avontuur', 'Abenteuer', 'Aventure', 'Aventura', 'Aventura', 'المغامرة', 'アドベンチャー', '어드벤처', 'Приключение', 'Macera', '冒險')), 'adventure', 12, { width: 980, height: 720, minWidth: 420, minHeight: 420 }, 'play');
  const TRANSFER = app('transfer', localizedText(englishOf('apps/transfer'), t('apps/transfer'), shipped('Gegevens verplaatsen', 'Daten übertragen', 'Déplacer les données', 'Mover datos', 'Mover dados', 'نقل البيانات', 'データの移動', '데이터 이동', 'Перенос данных', 'Verileri taşı', '移動資料')), 'transfer', 160, { width: 560, height: 360, minWidth: 360, minHeight: 240 }, 'system');

  const ASSISTANT: ModuleManifest = {
    $module: '0.1', id: 'assistant', version: '1.0.0', category: 'system',
    title: localizedText(englishOf('apps/assistant'), t('apps/assistant'), shipped('Assistent', 'Assistent', 'Assistant', 'Asistente', 'Assistente', 'المساعد', 'アシスタント', '어시스턴트', 'Ассистент', 'Asistan', '助理')),
    icon: { glyph: 'spark', hue: 285 },
    host: { kind: 'shipped', mount: 'assistant' },
    window: { width: 460, height: 620, minWidth: 340, minHeight: 360, singleton: true },
  };

  const SETTINGS: ModuleManifest = {
    $module: '0.1', id: 'settings', version: '1.0.0', category: 'system',
    title: localizedText(englishOf('apps/settings'), t('apps/settings'), shipped('Instellingen', 'Einstellungen', 'Paramètres', 'Configuración', 'Configurações', 'الإعدادات', '設定', '설정', 'Настройки', 'Ayarlar', '設定')),
    icon: { glyph: 'gear', hue: 215 },
    host: { kind: 'shipped', mount: 'settings' },
    // the desktop's Settings (`@tangleai/os/settings`): shows a section when asked
    provides: [SETTINGS_CONTRACT as any],
    window: { width: 860, height: 680, minWidth: 380, minHeight: 360, singleton: true },
  };

  const ABOUT: ModuleManifest = {
    $module: '0.1', id: 'about', version: '1.0.0', category: 'system',
    title: localizedText(englishOf('apps/about'), t('apps/about'), shipped('Over Tangle OS', 'Über Tangle OS', 'À propos de Tangle OS', 'Acerca de Tangle OS', 'Sobre o Tangle OS', 'حول Tangle OS', 'Tangle OS について', 'Tangle OS 정보', 'О Tangle OS', 'Tangle OS hakkında', '關於 Tangle OS')),
    icon: { glyph: 'info', hue: 265 },
    host: { kind: 'shipped', mount: 'about' },
    window: { width: 520, height: 420, singleton: true },
  };

  const TODO: ModuleManifest = {
    $module: '0.1', id: 'todo', version: '1.0.0', category: 'productivity',
    title: localizedText(englishOf('apps/todo'), t('apps/todo'), shipped('Taken', 'Aufgaben', 'À faire', 'Tareas', 'Tarefas', 'المهام', 'やること', '할 일', 'Задачи', 'Yapılacaklar', '待辦事項')),
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
        state: { draft: '', nextId: 3, items: [{ id: 1, text: t('todo/seed-manual'), done: true }, { id: 2, text: t('todo/seed-calculator'), done: false }], sent: false },
        view: {
          $jslt: '0.1',
          rules: [
            {
              match: '$',
              body: ['div', { class: 'todo' },
                ['h2', {}, t('todo/title')],
                ['p', { class: 'todo-count' }, { $count: '$.items[?@.done == false]' }, t('todo/open-of'), { $count: '$.items[*]' }],
                ['form', { on: { submit: { action: 'add', preventDefault: true } } },
                  ['input', { type: 'text', value: '$.draft', placeholder: t('todo/new-item'), 'aria-label': t('todo/new-item'), on: { input: 'draft' } }],
                  ['button', { type: 'submit', class: 'primary', disabled: { $eq: ['$.draft', ''] } }, t('todo/add')]],
                ['ul', {}, [{ $apply: '$.items[*]' }]],
                ['button', { type: 'button', class: 'todo-mail', on: { click: 'mail' } }, { $if: ['$.sent', t('todo/sent'), t('todo/mail')] }],
              ],
            },
            {
              match: '$.items[*]',
              body: ['li', { key: { $string: '$.id' }, class: { $if: ['$.done', 'done', 'open'] } },
                ['label', {},
                  ['input', { type: 'checkbox', checked: '$.done', on: { change: { action: 'toggle', with: { id: '$.id' } } } }],
                  ' ', '$.text'],
                ['button', { type: 'button', on: { click: { action: 'remove', with: { id: '$.id' } } } }, t('todo/remove')]],
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
              input: { subject: { $concat: [{ $string: { $count: '$.items[?@.done == false]' } }, t('todo/tasks-open')] }, body: { $string: { $count: '$.items[*]' } } },
              then: 'sent',
            } }],
          },
          sent: { patch: [{ op: 'replace', path: '/sent', value: true }] },
        },
      },
    },
  };

  return [WELCOME, ASSISTANT, CALENDAR, CALCULATOR, CONVERTER, STUDIO, PLAYGROUND, FLOW, DATA, LOOP, ADVENTURE, TODO, SETTINGS, TRANSFER, ABOUT];
}

/** The shipped components this desktop registers. */
export function shippedMounts(build: () => Promise<any>, host: { kernel: Kernel, prefs: Preferences, open: (id: string) => void, surfaces: { mounts: Record<string, ShippedMount>, toolbox: any, system: string }, chrome?: { messages?: OsCatalogue, locale?: string } }): Record<string, ShippedMount> {
  const mounts: Record<string, ShippedMount> = {
    ...host.surfaces.mounts,
    welcome: welcomeMount(host.open),
    calendar: calendarMount(),
    'calendar-settings': calendarSettingsMount(),
    calculator: calcMount('calculator'),
    converter: calcMount('converter'),
    loop: loopMount,
    assistant: assistantMount(host.kernel, host.prefs, () => host.open('settings'), { toolbox: host.surfaces.toolbox, system: host.surfaces.system }),
    about(node, context) {
      const doc = node.ownerDocument;
      const article = doc.createElement('article');
      article.className = 'tos-about';
      const title = doc.createElement('h1'); title.textContent = PRODUCT;
      const lead = doc.createElement('p');
      lead.textContent = t('about/lead');
      const facts = doc.createElement('dl');
      article.append(title, lead, facts);
      node.append(article);
      let live = true;
      build().then((info) => {
        if (!live || !info) return;
        const rows: [string, string][] = [['Tangle', info.version], ['Jaren', info.jaren ?? '—'], [t('about/build'), String(info.commit ?? '').slice(0, 8)]];
        for (const [name, value] of rows) {
          const dt = doc.createElement('dt'); dt.textContent = name;
          const dd = doc.createElement('dd'); dd.textContent = value;
          facts.append(dt, dd);
        }
        context.setTitle(`${PRODUCT} ${info.version}`);
      }).catch(() => {});
      return () => { live = false; article.remove(); };
    },
  };
  // the desktop's Settings: the site's own sections, then every application's
  mounts.settings = settingsModule({ kernel: host.kernel, shipped: mounts, ...(host.chrome ?? {}), sections: settingsSections(host.prefs), initial: () => initialSection(host.prefs) }).mount;
  return mounts;
}
