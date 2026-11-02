/** The census of what the assistant panel shows a person, by who wrote it. */
const VISIBLE = ['title', 'aria-label', 'placeholder', 'alt'];
const TOKEN = /‹h:([^›]+)›/g;

export type VisibleString = { text: string, where: string };
export type TextClass = 'owned' | 'default' | 'technical' | 'glyph' | 'host' | 'foreign' | 'suite';

const label = (element: any) => String(element.tagName).toLowerCase()
  + String(element.getAttribute?.('class') ?? '').split(/\s+/).filter(Boolean).map(name => '.' + name).join('');
/** Text nodes (runs of whitespace collapsed, blank ones skipped) and accessible attributes, in document order. */
export function visibleStrings(container: any): VisibleString[] {
  const found: VisibleString[] = [];
  const walk = (node: any, parent: any) => {
    if (node.nodeType === 3) {
      const text = String(node.nodeValue).replace(/\s+/g, ' ');
      if (text.trim() !== '') found.push({ text, where: label(parent) });
      return;
    }
    for (const name of VISIBLE) {
      const value = node.getAttribute(name);
      if (value !== null && value.trim() !== '') found.push({ text: value.replace(/\s+/g, ' '), where: `${label(node)}@${name}` });
    }
    for (const child of node.childNodes) walk(child, node);
  };
  for (const child of container.childNodes) walk(child, container);
  return found;
}

const exact = (text: string) => new RegExp('^' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
/**
 * Every visible literal the assistant writes, with the source line it comes
 * from: 47 of its own and the 5 presentation defaults. A pattern matches the
 * text left after host tokens are removed; `where` separates one text shown
 * twice. Reasoning and empty-reply notes are matched as Markdown renders them.
 */
export const INVENTORY: { source: string, class: 'owned' | 'default', match: RegExp, where?: RegExp }[] = [
  ...([
    ['views.ts:20', 'Provider'], ['views.ts:29', 'API key'], ['views.ts:38', 'Base URL'], ['views.ts:47', 'Model'],
    ['views.ts:57', 'Save'], ['views.ts:62', 'Testing…'], ['views.ts:62', 'Test connection'],
    ['views.ts:74', 'Pick a provider above, add a model (and a key for OpenRouter), then save — the chat opens right here. Nothing leaves your browser except the calls to the provider you choose.'],
    ['views.ts:84', 'Ask the assistant…'], ['views.ts:90', 'Send'], ['views.ts:91', 'Cancel'],
    ['views.ts:105', 'Set an objective the assistant keeps across sessions…'], ['views.ts:109', 'Set'], ['views.ts:115', 'Objective'],
  ] as const).map(([source, text]) => ({ source, class: 'owned' as const, match: exact(text) })),
  { source: 'views.ts:117', class: 'owned', match: exact('Clear the objective'), where: /@title$/ },
  { source: 'views.ts:118', class: 'owned', match: exact('Clear the objective'), where: /@aria-label$/ },
  { source: 'views.ts:124', class: 'owned', match: exact('…and ') },
  { source: 'views.ts:124', class: 'owned', match: exact(' earlier entries') },
  { source: 'views.ts:130', class: 'owned', match: exact('Remembering…') },
  { source: 'views.ts:130', class: 'owned', match: exact('Remember this session') },
  { source: 'views.ts:141', class: 'owned', match: exact('Settings'), where: /@title$/ },
  { source: 'views.ts:142', class: 'owned', match: exact('Assistant settings'), where: /@aria-label$/ },
  { source: 'views.ts:145', class: 'owned', match: exact('Clear the conversation'), where: /@title$/ },
  { source: 'views.ts:146', class: 'owned', match: exact('Clear conversation'), where: /@aria-label$/ },
  { source: 'views.ts:149', class: 'owned', match: exact('Close'), where: /@title$/ },
  { source: 'views.ts:150', class: 'owned', match: exact('Close assistant'), where: /@aria-label$/ },
  { source: 'views.ts:164', class: 'owned', match: exact('Running ') },
  { source: 'viewmodel.ts:42', class: 'owned', match: /^Thinking… \(\d+ characters of reasoning\)$/ },
  { source: 'viewmodel.ts:43', class: 'owned', match: exact('Thinking…') },
  { source: 'viewmodel.ts:51', class: 'owned', match: /^\d+ earlier progress entries retained with their evidence\.$/ },
  { source: 'viewmodel.ts:60', class: 'owned', match: /^\d+ remembered facts?$/ },
  { source: 'viewmodel.ts:61', class: 'owned', match: /^Storage failed: / },
  { source: 'viewmodel.ts:62', class: 'owned', match: exact('Use one tab at a time to update remembered state.') },
  { source: 'viewmodel.ts:64', class: 'owned', match: /^\d+ earlier archive address\(es\) evicted under the storage budget\.$/ },
  { source: 'viewmodel.ts:68', class: 'owned', match: /^\d+ earlier rounds? archived —/ },
  { source: 'viewmodel.ts:69', class: 'owned', match: / the assistant can fetch any of them back with recall\.$/ },
  ...([
    ['controller.ts:121', 'Add a provider, model and (for OpenRouter) an API key in settings first.'],
    ['controller.ts:187', 'The model spent the whole turn reasoning without a final reply — send another message to continue.'],
    ['controller.ts:188', 'The model ended its turn without a reply — whatever it loaded is on screen; send another message to continue.'],
    ['controller.ts:254', 'Nothing to remember yet — send a message first.'],
    ['controller.ts:258', 'Add a provider, model and key in settings first.'],
    ['controller.ts:275', 'The assistant found nothing worth remembering from this session.'],
    ['controller.ts:285', 'Assistant settings could not be saved.'],
    ['controller.ts:326', 'The assistant transcript could not be saved.'],
  ] as const).map(([source, text]) => ({ source, class: 'owned' as const, match: exact(text) })),
  { source: 'controller.ts:273', class: 'owned', match: /^Nothing was stored — / },
  { source: 'controller.ts:276', class: 'owned', match: /^Remembered \d+ evidenced items?\.$/ },
  { source: 'controller.ts:303', class: 'owned', match: /^Connected — \d+ models? available\.$/ },
  { source: 'component.ts:13', class: 'default', match: exact('Assistant'), where: /^span\.ai-title$/ },
  { source: 'component.ts:13', class: 'default', match: exact(' Assistant'), where: /^span\.ai-launch-label$/ },
  { source: 'component.ts:13', class: 'default', match: exact('Open assistant') },
  { source: 'component.ts:14', class: 'default', match: exact('Describe what you want to get done. The assistant can use the tools this host provides.') },
  { source: 'component.ts:16', class: 'default', match: exact('Provider requests use your settings. This host controls local persistence.') },
];
const TECHNICAL = ['sk-…', 'http://localhost:11434 · https://…/v1', 'qwen/qwen3-4b · llama3.2 · …'];
/** Labels Jaren's Markdown renderer writes into a reply. */
const SUITE = [/^Page break$/, /^Permalink to (this section)?$/, /^Back to reference \d+(, occurrence \d+)?$/, /^Footnotes$/];

/**
 * Host tokens are removed first and the remainder is judged, so a frame around
 * host data is still the assistant's. A remainder without letters is `host`
 * (`foreign` when a removed token stands for a failure) or a `glyph`; letters
 * that match no inventory entry were written by another package (`foreign`).
 */
export function classify(text: string): TextClass {
  const names = [...text.matchAll(TOKEN)].map(match => match[1]!);
  const rest = text.replace(TOKEN, '');
  if (!/\p{L}/u.test(rest)) return names.length === 0 ? 'glyph' : names.some(name => name.startsWith('error-')) ? 'foreign' : 'host';
  if (TECHNICAL.includes(rest)) return 'technical';
  if (SUITE.some(pattern => pattern.test(rest))) return 'suite';
  return INVENTORY.find(entry => entry.match.test(rest))?.class ?? 'foreign';
}
export const isInventoried = (entry: (typeof INVENTORY)[number], seen: VisibleString) =>
  entry.match.test(seen.text.replace(TOKEN, '')) && (entry.where?.test(seen.where) ?? true);

/** The literals a rule tree writes: string children not starting with `$`, both `$if` branches and the accessible attributes. */
export function ruleLiterals(rules: { body: unknown }[]): string[] {
  const found: string[] = [];
  const isElement = (node: any[]) => typeof node[0] === 'string' && (node.length === 1
    || (node[1] && typeof node[1] === 'object' && !Array.isArray(node[1]) && !('$if' in node[1]) && !('$apply' in node[1])));
  const walk = (node: any): void => {
    if (typeof node === 'string') { if (!node.startsWith('$')) found.push(node); return; }
    if (Array.isArray(node)) {
      if (isElement(node)) { for (const [key, value] of Object.entries(node[1] ?? {})) if (VISIBLE.includes(key)) walk(value); node.slice(2).forEach(walk); }
      else node.forEach(walk);
      return;
    }
    if (node && typeof node === 'object' && '$if' in node) { walk(node.$if[1]); if (node.$if[2] !== undefined) walk(node.$if[2]); }
  };
  for (const rule of rules) walk(rule.body);
  return found;
}
