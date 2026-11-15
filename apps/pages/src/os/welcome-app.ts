/**
 * The first window a visitor sees: what this desktop is, the applications on
 * it, and how they fit together. Each application opens from here.
 */
import type { ShippedMount } from '@tangleai/os/shell';

const APPS: [string, string, string][] = [
  ['assistant', 'Assistant', 'Ask in plain words; it uses the applications on this desktop to answer.'],
  ['calendar', 'Calendar', 'Plan your weeks, repeat what recurs, and find a free hour in your working day.'],
  ['studio', 'Studio', 'Build a Jaren application from documents, and run it as you type.'],
  ['playground', 'Playground', 'Try every Jaren engine: queries, schemas, stylesheets, charts and more.'],
  ['flow', 'Flow', 'Draw a state machine or a pipeline, then run it step by step.'],
  ['data', 'Data', 'A real database in this browser, queried with Jaren\'s query language.'],
  ['loop', 'Memory loop', 'Watch Tangle\'s memory gate, merge and resolve what it is told.'],
  ['adventure', 'Adventure', 'A small pirate story whose characters can answer through a model.'],
  ['settings', 'Settings', 'Pick a theme, a wallpaper and the model the assistant uses.'],
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
    head.append(mark, h('h1', '', 'Tangle OS'), h('p', 'tos-welcome-lead', 'Applications and an assistant on one desktop, in your browser. What you build here is a document you can read, share and undo.'));
    const list = h('ul', 'tos-welcome-apps');
    for (const [id, name, text] of APPS) {
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
      ['Applications talk through contracts', 'Every call between applications is a declared operation, checked and written down. The assistant gets the same operations as tools.'],
      ['Documents, not code', 'What you or the assistant make here is JSON that Jaren runs. A window from a document cannot reach your keys or your other data.'],
      ['Your key stays here', 'Bring a key for a model provider in Settings. It is stored in this browser and sent only to that provider.'],
    ]) { const block = h('div', ''); block.append(h('h2', '', title), h('p', '', text)); facts.append(block); }
    const links = h('p', 'tos-welcome-links');
    for (const [label, href] of [['Source on GitHub', 'https://github.com/jklarenbeek/tangleai'], ['Read the guide', 'https://github.com/jklarenbeek/tangleai#readme']]) {
      const a = h('a', '', label) as HTMLAnchorElement; a.href = href; a.target = '_blank'; a.rel = 'noopener'; links.append(a);
    }
    root.append(head, list, facts, links);
    node.append(root);
    return () => root.remove();
  };
}
