/** What every assistant mount shares: its instance id, its language and direction, its presentation defaults, its reply Markdown and its fragment links. */
import { createMdComponent } from '@jarenjs/md/component';
import { highlightPlugin } from '@jarenjs/md/plugins';
import { mermaidPlugin } from '@jarenjs/mermaid/plugin';
import type { AssistantMessages } from './messages.ts';

let nextInstance = 0;
/** One counter for the panel and the view, so two mounts on a page never share an id. */
export const instanceId = () => `tangle-assistant-${++nextInstance}`;

const DIRECTIONS = ['ltr', 'rtl', 'auto'];
/**
 * The `lang` and `dir` a host gives the assistant's root, checked; neither is
 * written unless given, so the page's own language and direction apply.
 * @param options
 */
export function rootLocale({ lang, dir }: { lang?: unknown, dir?: unknown }) {
  const locale: { lang?: string, dir?: string } = {};
  if (lang !== undefined) {
    if (typeof lang !== 'string') throw new TypeError('assistant: lang must be a language tag');
    // an empty tag is HTML's "language unknown"
    if (lang === '') locale.lang = '';
    else try { locale.lang = Intl.getCanonicalLocales(lang)[0]; } catch { throw new TypeError('assistant: lang must be a language tag'); }
  }
  if (dir !== undefined) {
    if (!DIRECTIONS.includes(dir as string)) throw new TypeError("assistant: dir must be 'ltr', 'rtl' or 'auto'");
    locale.dir = dir as string;
  }
  return locale;
}

const PRESENTATION = ['title', 'launchLabel', 'launchTitle', 'intro', 'capabilities', 'settingsHint'];
/** Presentation options a host does not pass come from the catalogue. @param messages */
export const defaultPresentation = (messages: AssistantMessages) => ({
  title: messages['panel/title'](), launchLabel: messages['launcher/label'](), launchTitle: messages['launcher/title'](),
  intro: messages['intro/text'](), capabilities: [] as string[], settingsHint: messages['settings/hint'](),
});
/** The presentation options a host passed, copied; one passed as `undefined` keeps its default. @param value */
export function presentation(value: object) {
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => PRESENTATION.includes(key) && item !== undefined)
    .map(([key, item]) => [key, structuredClone(item)]));
}

/** Replies render through one Markdown component per mount, their heading ids prefixed with the instance. @param id @param messages */
export function replyMarkdown(id: string, messages: AssistantMessages) {
  const md = createMdComponent({ plugins: [highlightPlugin(), mermaidPlugin({ theme: 'host' })], headingIds: true, headingAnchors: true, footnotesLabel: messages['md/footnotes']() });
  return {
    render: (source: string) => md.view(source, { slugPrefix: `user-content-${id}-` }),
    hydrate: (node: any) => { if (node?.querySelectorAll) md.hydrate(node); },
  };
}

/** A Markdown fragment belongs to this assistant, not to its host's hash router. @param node @returns the detach */
export function keepFragments(node: any) {
  function click(event: any) {
    const anchor = event.target.closest?.('a[href^="#"]');
    const href = anchor?.getAttribute('href');
    if (!href || href.startsWith('#/')) return;
    event.preventDefault();
    let fragment; try { fragment = decodeURIComponent(href.slice(1)); } catch { return; }
    for (const target of node?.querySelectorAll('[id]') ?? []) {
      if (target.id === fragment) { target.scrollIntoView?.({ block: 'nearest' }); break; }
    }
  }
  node?.addEventListener('click', click);
  return () => node?.removeEventListener('click', click);
}
