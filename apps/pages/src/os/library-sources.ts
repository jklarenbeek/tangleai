/**
 * The Radiant OS library, Tangle edition: this edition's field guide
 * first, then the README of every package the release publishes, in the
 * release's order, cut into sections by the OS's own `libraryFrom`. The
 * build collects it (`build.ts` hands in a reader over the checkout), so
 * what the Library app reads, reads aloud and answers from is what the
 * packages say about themselves, and cannot drift from them.
 */

import { libraryFrom } from './kernel/library.ts';
import type { Library } from './kernel/library.ts';

/** This edition's guide, repo-relative. */
export const GUIDE = 'apps/pages/src/os/documents/guide.md';

/** A repo-relative file's text, or null when it is not there. */
export type ReadFile = (path: string) => string | null;

/** A README's title: its first heading, or the package's name. */
const titleOf = (markdown: string, fallback: string): string => /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() || fallback;

/**
 * The library document from a checkout: the guide, then each package
 * directory's README in the order given. A package without a README is
 * left out; a missing guide is a broken build.
 */
export function collectLibrary(packages: readonly string[], read: ReadFile): Library {
  const guide = read(GUIDE);
  if (guide === null) throw new Error(`the Radiant OS library needs its guide at ${GUIDE}`);
  const sources = [{ id: 'radiant-os', title: 'Radiant OS field guide', source: GUIDE, markdown: guide }];
  for (const dir of packages) {
    const markdown = read(`${dir}/README.md`);
    const manifest = read(`${dir}/package.json`);
    if (markdown === null || manifest === null) continue;
    const name = String(JSON.parse(manifest).name ?? dir);
    sources.push({ id: name.replace(/^@[^/]+\//, ''), title: titleOf(markdown, name), source: `${dir}/README.md`, markdown });
  }
  return libraryFrom(sources);
}
