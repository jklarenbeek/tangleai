/**
 * The first window a visitor sees: what this desktop is, the applications on
 * it, and how they fit together. Each application opens from here.
 */
import type { ShippedMount } from '@tangleai/os/shell';
import { t } from './i18n.ts';

/** The product's name, the same in every language. */
const PRODUCT = 'Tangle OS';

/** The applications Welcome introduces: id, name, what it does. */
const apps = (): [string, string, string][] => [
  ['assistant', t('apps/assistant'), t('welcome/assistant')],
  ['calendar', t('apps/calendar'), t('welcome/calendar')],
  ['studio', t('apps/studio'), t('welcome/studio')],
  ['playground', t('apps/playground'), t('welcome/playground')],
  ['flow', t('apps/flow'), t('welcome/flow')],
  ['data', t('apps/data'), t('welcome/data')],
  ['loop', t('apps/loop'), t('welcome/loop')],
  ['adventure', t('apps/adventure'), t('welcome/adventure')],
  ['settings', t('apps/settings'), t('welcome/settings')],
];

/** Applications whose glyph is not named after them. */
const GLYPHS: Record<string, string> = { assistant: 'spark', settings: 'gear' };

export function welcomeMount(open: (id: string) => void): ShippedMount {
  return (node) => {
    const doc = node.ownerDocument;
    const h = (tag: string, cls: string, text?: string) => { const el = doc.createElement(tag); if (cls) el.className = cls; if (text) el.textContent = text; return el; };
    const root = h('div', 'tos-welcome');
    const head = h('header', 'tos-welcome-head');
    const mark = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    mark.setAttribute('viewBox', '0 0 64 64'); mark.setAttribute('class', 'tos-welcome-mark'); mark.setAttribute('aria-hidden', 'true');
    mark.innerHTML = '<path d="M6 22c14-10 22 18 36 8s16-12 16-12" /><path d="M6 42c12 10 22-16 34-6s18 10 18 10" /><path d="M20 6c-8 14 18 22 8 36s-6 16-6 16" /><circle cx="31" cy="31" r="4.5" />';
    head.append(mark, h('h1', '', PRODUCT), h('p', 'tos-welcome-lead', t('welcome/lead')));
    const list = h('ul', 'tos-welcome-apps');
    for (const [id, name, text] of apps()) {
      const item = h('li', '');
      const button = h('button', 'tos-welcome-app') as HTMLButtonElement;
      button.type = 'button'; button.dataset.open = id;
      const glyph = h('span', 'tos-glyph'); glyph.dataset.glyph = GLYPHS[id] ?? id;
      const words = h('span', 'tos-welcome-words');
      words.append(h('strong', '', name), h('span', '', text));
      button.append(glyph, words);
      button.addEventListener('click', () => open(id));
      item.append(button); list.append(item);
    }
    const facts = h('section', 'tos-welcome-facts');
    for (const [title, text] of [
      [t('welcome/contracts-title'), t('welcome/contracts-text')],
      [t('welcome/documents-title'), t('welcome/documents-text')],
      [t('welcome/key-title'), t('welcome/key-text')],
    ]) { const block = h('div', ''); block.append(h('h2', '', title), h('p', '', text)); facts.append(block); }
    const links = h('p', 'tos-welcome-links');
    for (const [label, href] of [[t('welcome/source'), 'https://github.com/jklarenbeek/tangleai'], [t('welcome/guide'), 'https://github.com/jklarenbeek/tangleai#readme']]) {
      const a = h('a', '', label) as HTMLAnchorElement; a.href = href; a.target = '_blank'; a.rel = 'noopener'; links.append(a);
    }
    root.append(head, list, facts, links);
    node.append(root);
    return () => root.remove();
  };
}
