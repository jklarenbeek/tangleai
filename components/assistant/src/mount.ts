/** What every assistant mount shares: its instance id, its presentation defaults, its reply Markdown and its fragment links. */
import { createMdComponent } from '@jarenjs/md/component';
import { highlightPlugin } from '@jarenjs/md/plugins';
import { mermaidPlugin } from '@jarenjs/mermaid/plugin';
import type { AssistantMessages } from './messages.ts';

let nextInstance = 0;
/** One counter for the panel and the view, so two mounts on a page never share an id. */
export const instanceId = () => `tangle-assistant-${++nextInstance}`;

const PRESENTATION = ['title', 'launchLabel', 'launchTitle', 'intro', 'capabilities', 'settingsHint'];
/** Presentation options a host does not pass come from the catalogue. @param messages */
export const defaultPresentation = (messages: AssistantMessages) => ({
  title: messages['panel/title'](), launchLabel: messages['launcher/label'](), launchTitle: messages['launcher/title'](),
  intro: messages['intro/text'](), capabilities: [] as string[], settingsHint: messages['settings/hint'](),
});
/** @param value */
export function presentation(value: object) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => PRESENTATION.includes(key)));
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
