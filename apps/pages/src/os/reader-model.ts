/**
 * The pure half of Docs and Benchmarks: which repository documents the reader
 * offers and how its rail groups them (computed once by the Pages build, read
 * by the app as `content/index.json`), where a link inside a document leads,
 * and the headline charts some reports carry, each a chart definition built
 * from the measured results file the report itself was generated from. Nothing
 * here touches the DOM or the network.
 */

/** The rail's groups, in the order the rail shows them. */
export const READER_GROUPS = ['overview', 'workflow', 'packages', 'reports'] as const;
export type ReaderGroup = typeof READER_GROUPS[number];
/** One document: its repository path, its title, its group, and the README it sits under (a package's own docs). */
export type ReaderEntry = { path: string, title: string, group: ReaderGroup, parent?: string };
export type ReaderIndex = { $reader: '0.1', documents: ReaderEntry[] };
/** A document the build found: its path, its text and, for a package README, the package's name. */
export type ReaderSource = { path: string, text: string, packageName?: string };

/** The hand-written overview, in reading order; every other document of `docs/` is a generated or measured report. */
export const OVERVIEW = ['README.md', 'docs/ARCHITECTURE.md', 'docs/ROADMAP.md', 'docs/PAPERS.md'] as const;
/** Where a path that is not one of the reader's documents opens: the repository on GitHub, at main. */
export const REPOSITORY = 'https://github.com/jklarenbeek/tangleai';
const RAW = 'https://raw.githubusercontent.com/jklarenbeek/tangleai/main';

const PACKAGE_README = /^(packages|components)\/[^/]+\/README\.md$/;
const PACKAGE_DOC = /^(packages|components)\/([^/]+)\/docs\/.+\.md$/;

/** The group a repository path belongs to, or null when the reader does not offer it. */
export function groupOf(path: string): { group: ReaderGroup, parent?: string } | null {
  if ((OVERVIEW as readonly string[]).includes(path)) return { group: 'overview' };
  if (/^docs\/workflow\/.+\.md$/.test(path)) return { group: 'workflow' };
  if (PACKAGE_README.test(path)) return { group: 'packages' };
  const doc = PACKAGE_DOC.exec(path);
  if (doc) return { group: 'packages', parent: `${doc[1]}/${doc[2]}/README.md` };
  if (/^docs\/[^/]+\.md$/.test(path)) return { group: 'reports' };
  return null;
}

/** A document's own first-level heading as plain text, or its file name when it has none. */
export function titleOf(text: string, path: string): string {
  const heading = /^# +(.+?)\s*#*\s*$/m.exec(text)?.[1];
  if (!heading) return path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
  return heading
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|\*|_)(.+?)\1/g, '$2')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ').trim();
}

/**
 * The reader's index: every offered document once, the overview in its own
 * order, everything else by path, a package's own docs right after its README.
 * The same sources always give the same bytes.
 */
export function readerIndex(sources: readonly ReaderSource[]): ReaderIndex {
  const entries: ReaderEntry[] = [];
  const seen = new Set<string>();
  for (const source of [...sources].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const place = groupOf(source.path);
    if (!place || seen.has(source.path)) continue;
    seen.add(source.path);
    const title = PACKAGE_README.test(source.path) && source.packageName ? source.packageName : titleOf(source.text, source.path);
    entries.push({ path: source.path, title, group: place.group, ...(place.parent && seen.has(place.parent) ? { parent: place.parent } : {}) });
  }
  const rank = (e: ReaderEntry) => {
    const overview = (OVERVIEW as readonly string[]).indexOf(e.path);
    return [READER_GROUPS.indexOf(e.group), overview < 0 ? OVERVIEW.length : overview, e.parent ?? e.path, e.parent ? 1 : 0, e.path] as const;
  };
  entries.sort((a, b) => {
    const x = rank(a), y = rank(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
  });
  return { $reader: '0.1', documents: entries };
}

/** Where a link leads: another document of the reader, a place in this one, the web, or a repository file on GitHub. */
export type LinkTarget =
  | { kind: 'doc', path: string, hash?: string }
  | { kind: 'anchor', hash: string }
  | { kind: 'external', url: string }
  | { kind: 'repository', url: string };

/** A repository-relative path for `href` written in the document at `from`, or null when it climbs out of the repository. */
export function resolvePath(href: string, from: string): string | null {
  const parts = href.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const segment of href.replace(/^\/+/, '').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') { if (!parts.length) return null; parts.pop(); continue; }
    parts.push(segment);
  }
  return parts.join('/');
}

/** Where `href`, written in the document at `from`, leads; `known` is every path the reader offers. */
export function resolveLink(href: string, from: string, known: ReadonlySet<string>): LinkTarget | null {
  if (!href) return null;
  if (href.startsWith('#')) return href.length > 1 ? { kind: 'anchor', hash: decodeURIComponent(href.slice(1)) } : null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return { kind: 'external', url: href };
  const hashAt = href.indexOf('#');
  const rawPath = (hashAt < 0 ? href : href.slice(0, hashAt)).split('?')[0];
  const hash = hashAt < 0 ? undefined : decodeURIComponent(href.slice(hashAt + 1)) || undefined;
  let path = resolvePath(decodeURI(rawPath), from);
  if (path === null) return null;
  if (path === '') return hash ? { kind: 'anchor', hash } : null;
  const asReadme = path.replace(/\/$/, '') + '/README.md';
  if (!known.has(path) && known.has(asReadme)) path = asReadme;
  if (known.has(path)) return path === from && hash ? { kind: 'anchor', hash } : { kind: 'doc', path, ...(hash ? { hash } : {}) };
  const last = path.slice(path.lastIndexOf('/') + 1);
  const isFile = last.includes('.') || last === last.toUpperCase();
  return { kind: 'repository', url: `${REPOSITORY}/${isFile ? 'blob' : 'tree'}/main/${path}${hash ? `#${hash}` : ''}` };
}

/** A view node as the md component writes one: `[tag, props, ...children]`; text is a string, a list of nodes an array. */
type Node = string | number | boolean | null | undefined | readonly unknown[];
const isElement = (n: unknown): n is [string, Record<string, unknown>, ...unknown[]] =>
  Array.isArray(n) && typeof n[0] === 'string' && n.length >= 2 && n[1] !== null && typeof n[1] === 'object' && !Array.isArray(n[1]);

/**
 * The same view with every link and image addressed for the reader: a link to
 * another document carries `data-doc` (and `data-hash`), a link to a place in
 * this one `data-hash`, the web and repository files open in a new tab, and an
 * image loads from the repository. A link that leads nowhere keeps its text and
 * loses its `href`. Returns new arrays; the input is not touched.
 */
export function addressView(node: Node, from: string, known: ReadonlySet<string>): Node {
  if (!Array.isArray(node)) return node;
  if (!isElement(node)) return node.map(child => addressView(child as Node, from, known));
  const [tag, props, ...children] = node;
  let next: Record<string, unknown> = props;
  if (tag === 'a' && typeof props.href === 'string') {
    const target = resolveLink(props.href, from, known);
    const { href: _href, ...rest } = props;
    if (!target) next = rest;
    else if (target.kind === 'doc') next = { ...props, href: `#${target.path}`, 'data-doc': target.path, ...(target.hash ? { 'data-hash': target.hash } : {}) };
    else if (target.kind === 'anchor') next = { ...props, href: `#${target.hash}`, 'data-hash': target.hash };
    else next = { ...props, href: target.url, target: '_blank', rel: 'noopener noreferrer' };
  } else if (tag === 'img' && typeof props.src === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(props.src)) {
    const path = resolvePath(props.src, from);
    next = path === null ? { ...props, src: undefined } : { ...props, src: `${RAW}/${path}` };
  }
  return [tag, next, ...children.map(child => addressView(child as Node, from, known))];
}

// ── headline charts ─────────────────────────────────────────────────────────

/** The words a chart needs, in the reader's language. */
export type ChartWords = (key: ChartWord, params?: Record<string, string>) => string;
export type ChartWord =
  | 'recall-title' | 'recall-series' | 'jaren-title' | 'jaren-previous' | 'jaren-bounded'
  | 'strict-title' | 'strict-as-is' | 'strict-profile' | 'outcome-refused' | 'outcome-valid' | 'outcome-invalid' | 'outcome-error'
  | 'authoring-title' | 'authoring-en' | 'authoring-nl' | 'authoring-alone' | 'runs' | 'works';
/** A bar chart definition for `@jarenjs/charts`. */
export type BarChart = { type: 'bar', title: string, categories: string[], series: { name: string, values: number[] }[] };
/** A report's headline: the results files it reads, and the chart it draws from them (null when the results do not hold it). */
export type Headline = { results: string[], chart: (results: unknown[], say: ChartWords, format: (n: number) => string) => BarChart | null };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, any> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : null);

/**
 * The reports that carry a headline chart, and how each headline is chosen —
 * always every value of one measured quantity, never a selection of rows:
 *
 * - LoCoMo recall: every registered row's overall evidence recall at every
 *   registered k (`rows[].recall[k].overall`).
 * - Jaren history reads: the 95th-percentile read time of both strategies on
 *   each runtime measured (`previous.p95Ms`, `bounded.p95Ms` per results file).
 * - Strict structured output: every outcome count of the live run, per schema
 *   form (`summary[form][outcome]`).
 * - Authoring: requests made and applications that worked, per published run
 *   (`summary.runs`, `summary.works`).
 */
export const HEADLINES: Record<string, Headline> = {
  'docs/LOCOMO_RECALL.md': {
    results: ['benchmark/results/locomo-recall.json'],
    chart([report], say, format) {
      const rows = obj(report)?.rows;
      const ks = obj(report)?.config?.ks;
      if (!Array.isArray(rows) || !Array.isArray(ks)) return null;
      const keys = ks.map(String);
      const categories: string[] = [], values: number[][] = keys.map(() => []);
      for (const row of rows) {
        const recall = keys.map(k => num(obj(obj(obj(row)?.recall)?.[k])?.overall));
        if (typeof obj(row)?.key !== 'string' || recall.some(v => v === null)) continue;
        categories.push(row.key);
        recall.forEach((v, i) => values[i].push(v as number));
      }
      if (!categories.length) return null;
      return { type: 'bar', title: say('recall-title'), categories, series: keys.map((k, i) => ({ name: say('recall-series', { k: format(Number(k)) }), values: values[i] })) };
    },
  },
  'docs/JARENJS_BENCHMARK.md': {
    results: ['benchmark/results/jaren-strategies-node.json', 'benchmark/results/jaren-strategies-bun.json'],
    chart(results, say) {
      const runtimes = results.map(r => obj(r)).filter((r): r is Record<string, any> => !!r && num(r.previous?.p95Ms) !== null && num(r.bounded?.p95Ms) !== null);
      if (!runtimes.length) return null;
      const NAMES: Record<string, string> = { node: 'Node.js', bun: 'Bun' };
      return {
        type: 'bar', title: say('jaren-title'),
        categories: runtimes.map(r => NAMES[r.runtime] ?? String(r.runtime)),
        series: [
          { name: say('jaren-previous'), values: runtimes.map(r => r.previous.p95Ms) },
          { name: say('jaren-bounded'), values: runtimes.map(r => r.bounded.p95Ms) },
        ],
      };
    },
  },
  'docs/STRICT_PROFILE_BENCHMARK.md': {
    results: ['benchmark/results/strict-profile-live.json'],
    chart([report], say) {
      const summary = obj(obj(report)?.summary);
      const forms = ([['as-is', 'strict-as-is'], ['profile', 'strict-profile']] as const).filter(([f]) => obj(summary?.[f]));
      if (!forms.length) return null;
      const outcomes = (['refused', 'valid', 'invalid', 'error'] as const).filter(o => forms.some(([f]) => num(summary![f][o]) !== null));
      return {
        type: 'bar', title: say('strict-title'), categories: forms.map(([, word]) => say(word)),
        series: outcomes.map(o => ({ name: say(`outcome-${o}`), values: forms.map(([f]) => num(summary![f][o]) ?? 0) })),
      };
    },
  },
  'docs/AUTHORING_BENCHMARK.md': {
    results: ['benchmark/results/authoring-conversation-en.json', 'benchmark/results/authoring-conversation-nl.json', 'benchmark/results/authoring-live.json'],
    chart(results, say) {
      const words = ['authoring-en', 'authoring-nl', 'authoring-alone'] as const;
      const runs = results.map((r, i) => ({ word: words[i], s: obj(obj(r)?.summary) })).filter(r => r.s && num(r.s.runs) !== null && num(r.s.works) !== null);
      if (!runs.length) return null;
      return {
        type: 'bar', title: say('authoring-title'), categories: runs.map(r => say(r.word)),
        series: [{ name: say('runs'), values: runs.map(r => r.s!.runs) }, { name: say('works'), values: runs.map(r => r.s!.works) }],
      };
    },
  },
};
