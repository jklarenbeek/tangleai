/**
 * The Play boundary — the site's glue for `@jarenjs/play`. The engine
 * playground: pick an engine + an example, edit the source or the data, and
 * it runs live — the registered operator packs threaded in so `$mean`/`$npv`
 * work in the query/jslt engines. Ephemeral (no document, unlike the studio).
 * The slice, its sessions and the reader-language rules are Jaren's play host
 * kit (`@jarenjs/play/host`); this file adds the site's renderers and links.
 */
import { createSplitterWidget } from '@jarenjs/app';
import { createPlayComponent } from '@jarenjs/play/component';
import {
  PLAY_START as KIT_START, withPlayLocale as kitWithPlayLocale, runPlay as kitRunPlay, switchPlayOption as kitSwitchPlayOption,
} from '@jarenjs/play/host';
export {
  loadExample, loadDataset, deepLinkExample, sessionOf, sessionToLoaded, sessionDocument, sessionFromDocument,
  sessionFilename, blankSession,
} from '@jarenjs/play/host';
import { toMarkdown } from '@jarenjs/md';
import { createMdx } from '@jarenjs/md/mdx';
import { compileJsonQuery } from '@jarenjs/json';
import { operatorRegistry } from './services.ts';
import { md, mdArticle, UNTRUSTED } from './services.ts';
import { mermaid } from './services.ts';
import { chartRenderer } from './services.ts';
import { playCatalogs, playValidator } from './validator.ts';
import { formatJson } from './services.ts';

/** The component, with the site's math/finance/stats packs mounted. */
export const playComponent = createPlayComponent({ operators: operatorRegistry });

/** The mdx pass (markdown × data), with the suite's own query compiler
 * injected — the expression language IS jaren-query, no new mini-language. */
const mdx = createMdx({ compileQuery: compileJsonQuery });

/**
 * Host-injected vnode renderers for the playground's VISUAL engines (the
 * hybrid seam): @jarenjs/play owns the markdown/mermaid/charts descriptors
 * + examples, but stays free of those component deps — the rendering happens
 * here, reusing the site's own memoized md/mermaid components and the charts
 * static path. `md.view` / `mermaid.view` are memoized per source string.
 *
 * Markdown and Mermaid also hand back `deep` panels — the drill-down
 * explainers only the host can derive (the JSON AST, the canonical
 * round-trip): teacher-voiced, revealed behind the depth toggle.
 *
 * Each renderer also reports its own `compileMs` / `runMs`. Play cannot
 * split a host render from the outside — it would only have one wall-clock
 * number for both phases — and these renderers genuinely have two: the
 * source compiles to a document, then the document builds a vnode. Report
 * them and the stage prints two real numbers; omit them and it honestly
 * prints one.
 */
const timed = (fn: any) => {
  const t0 = performance.now();
  const value = fn();
  return { value, ms: performance.now() - t0 };
};

const renderers = {
  markdown: (source: any) => {
    const compiled = timed(() => md.compile(source).doc);
    const doc = compiled.value;
    const rendered = timed(() => mdArticle(md.view(source, UNTRUSTED)));
    return {
      compileMs: compiled.ms,
      runMs: rendered.ms,
      vnode: rendered.value,
      deep: [
        { id: 'ast', label: 'The document, as JSON', kind: 'code', text: formatJson(doc.ast) },
        { id: 'roundtrip', label: 'Canonical Markdown', kind: 'code', text: toMarkdown(doc) },
        ...(doc.frontmatter !== null
          ? [{ id: 'frontmatter', label: 'The frontmatter', kind: 'code', text: formatJson(doc.frontmatter) }]
          : []),
      ],
    };
  },
  // mdx receives the PARSED data document as its second argument: the pass
  // resolves the template against it, then renders through the same
  // memoized md pipeline (the doc-keyed memo carries the transformed doc)
  mdx: (source: any, dataValue: any) => {
    const compiled = timed(() => mdx.transform(md.compile(source).doc, dataValue));
    const doc = compiled.value;
    const rendered = timed(() => mdArticle(md.view(doc, UNTRUSTED)));
    return {
      compileMs: compiled.ms,
      runMs: rendered.ms,
      vnode: rendered.value,
      deep: [
        { id: 'rendered', label: 'The resolved Markdown', kind: 'code', text: toMarkdown(doc) },
        { id: 'ast', label: 'The document, as JSON', kind: 'code', text: formatJson(doc.ast) },
      ],
    };
  },
  mermaid: (source: any) => {
    const step = timed(() => mermaid.compile(source));
    const compiled = step.value;
    const doc = compiled.doc;
    const rendered = timed(() => mermaid.view(source));
    return {
      compileMs: step.ms,
      runMs: rendered.ms,
      vnode: rendered.value,
      deep: [
        {
          id: 'ast', label: 'The geometry-free AST', kind: 'code',
          text: doc ? formatJson(doc.ast) : String(compiled.parseError?.message ?? 'parse error')
        },
        { id: 'roundtrip', label: 'Canonical Mermaid', kind: 'code', text: compiled.toText() },
      ],
    };
  },
  charts: (source: any, config: any) => chartRenderer(source, config),
};

/**
 * The initial slice: the kit's (the first example, loaded and ready to run)
 * plus the reader's message language, null until they choose one on the
 * Messages pane. Only the reader sets it; an example made to show one
 * language shows it for its own run (`exampleLocale`).
 */
export const PLAY_START = Object.freeze({ ...KIT_START, locale: null as string | null });

/** The play slice as the engines and the panes read it, in the reader's language. */
export const withPlayLocale = (slice: any) => kitWithPlayLocale(slice, slice.locale ?? null);

/** Run the active engine in the reader's language, with the site's operators, renderers and validator. */
export function runPlay(slice: any) {
  return kitRunPlay(playComponent, slice, {
    lang: slice.locale ?? null, catalogs: playCatalogs,
    operators: operatorRegistry, renderers, validate: playValidator.validate,
  });
}

/**
 * The slice fields a switch of one option pane leaves (the kit's
 * `switchPlayOption`); choosing on the `locale` pane makes that language the
 * reader's, kept across examples, New and opened sessions.
 */
export function switchPlayOption(slice: any, key: string, value: string) {
  const { lang, ...next } = kitSwitchPlayOption(slice, key, value);
  return { ...next, locale: lang ?? slice.locale ?? null };
}

/**
 * A LEGACY playground snapshot → a play session, so links and saved
 * experiments from the retired `#/playground` keep working. The legacy
 * shape is `(engine, inputs)` with flat text inputs; `validate` carried
 * `{ schemaText, data }` (the data as a VALUE). Inputs are split into
 * play's source / data / config panes by the engine descriptor; a key
 * with no play home (the old pointer/patch mode sub-fields) is dropped.
 * @returns a `play/loaded-session`-shaped session, or null
 */
export function legacyExperimentToSession(engine: string, inputs: any): any | null {
  const given = inputs && typeof inputs === 'object' ? inputs : {};
  if (engine === 'validate') {
    return {
      engine: 'validate', exampleId: null,
      source: { schema: typeof given.schemaText === 'string' ? given.schemaText : '' },
      data: { data: JSON.stringify(given.data ?? null, null, 2) },
      config: {},
    };
  }
  if (!Object.hasOwn(playComponent.engines, engine)) return null;
  const descriptor = playComponent.engines[engine];

  const source: Record<string, string> = {};

  const data: Record<string, string> = {};

  const config: Record<string, string> = {};
  for (const [key, value] of Object.entries(given)) {
    if (typeof value !== 'string') continue;
    if (descriptor.sourcePanes.some((p) => p.key === key)) source[key] = value;
    else if (descriptor.dataPanes.some((p) => p.key === key)) data[key] = value;
    else if ((descriptor.optionPanes ?? []).some((p) => p.key === key)) config[key] = value;
  }
  return { engine, exampleId: null, source, data, config };
}

/** The Play IDE's editor|result splitter (`play-splitter`): the shared
 * `@jarenjs/app` widget bound to the play grid — drives `--jplay-ratio` live
 * during a drag and commits `play/layout-ratio` on pointer-up. */
export function createPlaySplitterWidget() {
  return createSplitterWidget({
    grid: '.jplay', rail: '.jplay-rail', cssVar: '--jplay-ratio', action: 'play/layout-ratio',
  });
}
