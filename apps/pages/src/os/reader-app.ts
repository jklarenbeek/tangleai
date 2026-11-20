/**
 * Docs and Benchmarks: Tangle's own documentation and its generated benchmark
 * reports, read in a window. A rail lists the documents the Pages build put in
 * `content/` (its `index.json` names them); the chosen one is fetched only
 * then and drawn by Jaren's Markdown component, with every link addressed by
 * `reader-model.ts`: another document opens here, a place in this one
 * scrolls, the web and repository files open in a new tab. A report that has
 * a headline also draws one chart with Jaren's chart engine, from the measured
 * results file the report was generated from, fetched beside it — the window
 * shows a number only when a run wrote it. Document text is the documents'
 * own English (`lang="en"`); everything the window itself says comes from the
 * catalogue in the desktop's language.
 */
import { createMdComponent } from '@jarenjs/md/component';
import { labelsFromCatalog } from '@jarenjs/md';
import { highlightPlugin } from '@jarenjs/md/plugins';
import { mermaidPlugin } from '@jarenjs/mermaid/plugin';
import { createChartComponent } from '@jarenjs/charts/component';
import { createDomRenderer } from '@jarenjs/view';
import { compileMessageCatalog } from '@jarenjs/core/message';
import { ar, de, es, fr, ja, ko, nl, pt, ru, tr, zhTW } from '@jarenjs/locales';
import type { ShippedMount } from '@tangleai/os/shell';
import { t } from './i18n.ts';
import { HEADLINES, READER_GROUPS, REPOSITORY, addressView, type ChartWord, type ReaderEntry, type ReaderGroup, type ReaderIndex } from './reader-model.ts';

const md = createMdComponent({ plugins: [highlightPlugin(), mermaidPlugin({ theme: 'host' })], headingIds: true, headingAnchors: true });
const charts = createChartComponent({ theme: 'host' });

/** The names Jaren's Markdown writes itself (a heading's permalink, the footnotes), in the desktop's language. */
const PACKS: Record<string, Record<string, unknown>> = { ar, de, es, fr, ja, ko, nl, pt, ru, tr, 'zh-TW': zhTW };
const labelCache = new Map<string, Record<string, unknown>>();
function mdLabels(locale: string): Record<string, unknown> {
  const pack = PACKS[locale] ?? PACKS[locale.split('-')[0]];
  if (!pack) return {};
  let labels = labelCache.get(locale);
  if (!labels) { labels = labelsFromCatalog(compileMessageCatalog(pack as any) as any) as Record<string, unknown>; labelCache.set(locale, labels); }
  return labels;
}

/** Fetched once per page: the index, every document's text and every results file, each kept after it arrives. */
const texts = new Map<string, Promise<string>>();
const jsons = new Map<string, Promise<unknown>>();
let index: Promise<ReaderIndex> | null = null;
const contentUrl = (doc: Document, path: string) => new URL(`content/${path}`, doc.baseURI).href;
function fetchOnce<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let pending = cache.get(key);
  if (!pending) {
    pending = load();
    cache.set(key, pending);
    // a failure is not kept: trying again fetches again
    pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
  }
  return pending;
}
const ok = (r: Response) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; };
function loadIndex(doc: Document): Promise<ReaderIndex> {
  if (!index) {
    const pending = fetch(contentUrl(doc, 'index.json')).then(ok).then(r => r.json() as Promise<ReaderIndex>);
    index = pending;
    pending.catch(() => { if (index === pending) index = null; });
  }
  return index;
}
const loadText = (doc: Document, path: string) => fetchOnce(texts, path, () => fetch(contentUrl(doc, path)).then(ok).then(r => r.text()));
const loadJson = (doc: Document, path: string) => fetchOnce(jsons, path, () => fetch(contentUrl(doc, path)).then(ok).then(r => r.json()));

const GROUP_WORD: Record<ReaderGroup, () => string> = {
  overview: () => t('reader/group-overview'), workflow: () => t('reader/group-workflow'),
  packages: () => t('reader/group-packages'), reports: () => t('reader/group-reports'),
};
/** The catalogue sentence for each word a headline chart uses. */
const CHART_WORD: Record<ChartWord, (params?: Record<string, string>) => string> = {
  'recall-title': () => t('reader/chart-recall-title'), 'recall-series': (p) => t('reader/chart-recall-series', p as any),
  'jaren-title': () => t('reader/chart-jaren-title'), 'jaren-previous': () => t('reader/chart-jaren-previous'), 'jaren-bounded': () => t('reader/chart-jaren-bounded'),
  'strict-title': () => t('reader/chart-strict-title'), 'strict-as-is': () => t('reader/chart-strict-as-is'), 'strict-profile': () => t('reader/chart-strict-profile'),
  'outcome-refused': () => t('reader/chart-outcome-refused'), 'outcome-valid': () => t('reader/chart-outcome-valid'),
  'outcome-invalid': () => t('reader/chart-outcome-invalid'), 'outcome-error': () => t('reader/chart-outcome-error'),
  'authoring-title': () => t('reader/chart-authoring-title'), 'authoring-en': () => t('reader/chart-authoring-en'),
  'authoring-nl': () => t('reader/chart-authoring-nl'), 'authoring-alone': () => t('reader/chart-authoring-alone'),
  runs: () => t('reader/chart-runs'), works: () => t('reader/chart-works'),
};

function readerMount(kind: 'docs' | 'benchmarks'): ShippedMount {
  return (node, context) => {
    const doc = node.ownerDocument;
    node.classList.add('tos-surface', `tos-surface-${kind}`);
    const lifetime = new AbortController();
    let live = true;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
      const e = doc.createElement(tag);
      if (className) e.className = className;
      if (text !== undefined) e.textContent = text;
      return e;
    };

    const shell = el('div', 'tos-reader');
    const rail = el('nav', 'tos-reader-rail');
    rail.setAttribute('aria-label', kind === 'docs' ? t('reader/rail-docs') : t('reader/rail-reports'));
    const main = el('div', 'tos-reader-main');
    const status = el('p', 'tos-reader-status');
    status.setAttribute('role', 'status');
    const figure = el('figure', 'tos-reader-chart');
    figure.hidden = true;
    const chartHost = el('div', 'tos-reader-chart-svg');
    const caption = el('figcaption', 'tos-muted');
    figure.append(chartHost, caption);
    const articleHost = el('div', 'tos-reader-article');
    articleHost.lang = 'en';
    articleHost.tabIndex = -1;
    const source = el('a', 'tos-reader-source', t('reader/on-github'));
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    source.hidden = true;
    main.append(status, figure, articleHost, source);
    shell.append(rail, main);
    node.append(shell);

    const renderArticle = createDomRenderer(articleHost, { document: doc } as any);
    const renderChart = createDomRenderer(chartHost, { document: doc } as any);
    const number = new Intl.NumberFormat(context.locale);
    let entries: ReaderEntry[] = [];
    let known = new Set<string>();
    let current = '';
    let opening = 0;

    const say = (text: string, retry?: () => void) => {
      status.replaceChildren(text);
      if (retry) {
        const again = el('button', 'tos-btn', t('reader/retry'));
        again.type = 'button';
        again.addEventListener('click', retry, { signal: lifetime.signal });
        status.append(' ', again);
      }
    };
    const scrollToId = (id: string) => {
      const target = articleHost.querySelector(`[id="${CSS.escape(id)}"]`);
      if (target) target.scrollIntoView({ block: 'start' });
    };

    function drawRail() {
      const items: Node[] = [];
      for (const group of READER_GROUPS) {
        const members = entries.filter(e => e.group === group && !e.parent);
        if (!members.length) continue;
        const section = el('section', 'tos-reader-group');
        section.append(el('h3', '', GROUP_WORD[group]()));
        const list = el('ul');
        for (const entry of members) {
          const li = el('li');
          li.append(railButton(entry));
          const children = entries.filter(e => e.parent === entry.path);
          if (children.length) {
            const sub = el('ul');
            for (const child of children) { const cli = el('li'); cli.append(railButton(child)); sub.append(cli); }
            li.append(sub);
          }
          list.append(li);
        }
        section.append(list);
        items.push(section);
      }
      rail.replaceChildren(...items);
    }
    function railButton(entry: ReaderEntry) {
      const b = el('button', 'tos-reader-item', entry.title);
      b.type = 'button';
      b.lang = 'en';
      b.dataset.path = entry.path;
      b.addEventListener('click', () => open(entry.path), { signal: lifetime.signal });
      return b;
    }
    function markRail() {
      for (const b of rail.querySelectorAll<HTMLButtonElement>('.tos-reader-item'))
        if (b.dataset.path === current) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }

    async function drawHeadline(path: string, ticket: number) {
      const headline = HEADLINES[path];
      figure.hidden = !headline;
      renderChart(['div', {}]);
      caption.textContent = '';
      if (!headline) return;
      try {
        const results = await Promise.all(headline.results.map(p => loadJson(doc, p)));
        if (!live || ticket !== opening) return;
        const chart = headline.chart(results, (word: ChartWord, params) => CHART_WORD[word](params), n => number.format(n));
        if (!chart) { figure.hidden = true; return; }
        renderChart(charts.view(chart, chart) as any);
        caption.textContent = t('reader/chart-from', { files: headline.results.map(p => p.slice(p.lastIndexOf('/') + 1)).join(', ') });
      } catch {
        if (!live || ticket !== opening) return;
        caption.textContent = t('reader/chart-failed');
      }
    }

    async function open(path: string, hash?: string) {
      if (!known.has(path)) return;
      const ticket = ++opening;
      current = path;
      markRail();
      say(t('reader/loading'));
      if (kind === 'benchmarks') void drawHeadline(path, ticket);
      try {
        const text = await loadText(doc, path);
        if (!live || ticket !== opening) return;
        const view = md.view(text, { slugPrefix: '', ...mdLabels(context.locale) } as any);
        renderArticle(addressView(view as any, path, known) as any);
        status.replaceChildren();
        source.href = `${REPOSITORY}/blob/main/${path}`;
        source.hidden = false;
        if (hash) scrollToId(hash); else { articleHost.scrollTop = 0; main.scrollTop = 0; }
        articleHost.focus({ preventScroll: true });
      } catch {
        if (!live || ticket !== opening) return;
        say(t('reader/doc-failed'), () => open(path, hash));
      }
    }

    // links the document carries: another document opens here, a place in this one scrolls
    articleHost.addEventListener('click', (event) => {
      const link = (event.target as Element | null)?.closest?.('a');
      if (!link || !articleHost.contains(link)) return;
      const docPath = link.getAttribute('data-doc');
      const hash = link.getAttribute('data-hash');
      if (docPath) { event.preventDefault(); void open(docPath, hash ?? undefined); }
      else if (hash) { event.preventDefault(); scrollToId(hash); }
    }, { signal: lifetime.signal });

    async function start() {
      say(t('reader/loading'));
      try {
        const loaded = await loadIndex(doc);
        if (!live) return;
        entries = loaded.documents.filter(e => (kind === 'benchmarks') === (e.group === 'reports'));
        known = new Set(loaded.documents.map(e => e.path));
        drawRail();
        const first = entries[0];
        if (first) await open(first.path); else status.replaceChildren();
      } catch {
        if (!live) return;
        say(t('reader/index-failed'), () => void start());
      }
    }
    void start();

    return () => { live = false; lifetime.abort(); shell.remove(); };
  };
}

export const docsMount: ShippedMount = readerMount('docs');
export const benchmarksMount: ShippedMount = readerMount('benchmarks');
