import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assistantMessagesEn, createAssistantMessages, type AssistantMessageKey } from '@tangleai/assistant/messages';
import { nl } from '@tangleai/assistant/messages/nl';
import { de } from '@tangleai/assistant/messages/de';
import { fr } from '@tangleai/assistant/messages/fr';
import { es } from '@tangleai/assistant/messages/es';
import { pt } from '@tangleai/assistant/messages/pt';
import { ar } from '@tangleai/assistant/messages/ar';
import { createAssistantRules, createAssistantViewRules } from '../../components/assistant/src/views.ts';
import { stringLiterals } from '../import-specifiers.ts';
import { ASSISTANT_STATES, VIEW_STATES } from './state-matrix.ts';
import { classify, COGNATES, ruleLiterals, sentinelMessages, textRuns, visibleStrings, type VisibleString } from './visible-text.ts';

/** The English render as first pinned (its classes are that census's), and each reviewed change since. */
const FIXTURE: { states: Record<string, VisibleString[]>, deltas: { name: string, state: string, reason: string, was: VisibleString, now: VisibleString }[] }
  = JSON.parse(readFileSync(new URL('../fixtures/assistant-visible-en.json', import.meta.url), 'utf8'));
const KEYS = Object.keys(assistantMessagesEn);
/** Text another package writes that reaches the screen as a message's detail, with its owner. */
const FOREIGN: Record<string, string> = {
  'AI0002: HTTP 400 from http://localhost:11434/v1/chat/completions: ': '@tangleai/models transport failure',
  "AI0001: unknown provider 'unknown' (openrouter, ollama, lmstudio, custom)": '@tangleai/models provider resolution',
  'the model did not produce an applicable refinement': '@tangleai/agents refinement outcome',
};
/** What every translated render keeps in English because Jaren's Markdown renderer writes it (state: where: text). */
const SUITE_LABELS = [
  'reply with heading, page break and footnote: a.md-anchor@aria-label: Permalink to ‹h:heading›',
  'reply with heading, page break and footnote: div.md-page-break@aria-label: Page break',
  'reply with heading, page break and footnote: a.footnote-backref@aria-label: Back to reference 1',
];
/** The controller's only prose outside the catalogue: it is written to the model, never shown. */
const MODEL_FACING = ['The assistant turn was cancelled.', 'Help the user complete their task using the available tools.'];
/** The view's refusals of a malformed host report or transport: thrown to the caller as a `TypeError`, never rendered. */
const CALLER_FACING = [
  'assistant view state: ', ' must be ', 'a plain object', 'assistant view state: unknown member ', 'a string', 'a non-empty string', 'an array', 'an array',
  'a whole number of at least 0', 'JSON at most ', ' levels deep', 'assistant view: transport must have start and cancel functions',
  'assistant: lang must be a language tag', 'assistant: lang must be a language tag', "assistant: dir must be 'ltr', 'rtl' or 'auto'",
];

/** The panel's states by default; the census renders both surfaces. */
async function render(messages?: object, matrix: typeof ASSISTANT_STATES | typeof VIEW_STATES = ASSISTANT_STATES) {
  const states: Record<string, VisibleString[]> = {};
  for (const state of matrix) {
    const mounted = await state.render(messages);
    try { states[state.name] = visibleStrings(mounted.container); }
    finally { await mounted.handle.dispose(); }
  }
  return states;
}
const both = async (messages?: object) => ({ ...await render(messages), ...await render(messages, VIEW_STATES) });
let sentinelRender: Promise<Record<string, VisibleString[]>> | undefined;
const sentinel = async (surface: 'all' | 'view' = 'all') => Object.entries(await (sentinelRender ??= both(sentinelMessages(KEYS))))
  .filter(([name]) => surface === 'all' || name.startsWith('view: ')).flatMap(([, strings]) => strings)
  .map(seen => ({ ...seen, ...classify(seen.text) }));

it('the panel rules write glyphs only', () => {
  assert.deepEqual(ruleLiterals(createAssistantRules('census')), ['✦', '⚙', '⌫', '✕', '✕', '…', '…']);
});

it('the view rules write glyphs only', () => {
  assert.deepEqual(ruleLiterals(createAssistantViewRules()), ['✦', '✕', '…']);
});

it('the English render of every pinned state is the parity fixture with its reviewed changes', async () => {
  const first = await render(), second = await render();
  assert.equal(JSON.stringify(second), JSON.stringify(first), 'rendering is deterministic');
  const expected = Object.fromEntries(Object.entries(FIXTURE.states).map(([name, strings]) => [name, textRuns(strings)]));
  for (const delta of FIXTURE.deltas) {
    const runs = expected[delta.state]!, at = runs.map((run, index) => run.text === delta.was.text && run.where === delta.was.where ? index : -1).filter(index => index >= 0);
    assert.equal(at.length, 1, `${delta.name}: the pinned text appears once in ${delta.state}`);
    runs[at[0]!] = delta.now;
  }
  assert.deepEqual(Object.fromEntries(Object.entries(first).map(([name, strings]) => [name, textRuns(strings)])), expected);
});

it('with a key-sentinel catalogue no text outside the catalogue remains', async t => {
  for (const surface of ['all', 'view'] as const) {
    const census = await sentinel(surface);
    assert.deepEqual(census.filter(seen => seen.class === 'unframed').map(seen => `${seen.where}: ${seen.text}`), [], surface);
    const totals: Record<string, { distinct: Set<string>, occurrences: number }> = {};
    for (const seen of census) {
      const total = totals[seen.class] ??= { distinct: new Set(), occurrences: 0 };
      total.distinct.add(seen.text); total.occurrences++;
    }
    for (const [name, total] of Object.entries(totals).sort()) t.diagnostic(`${surface} ${name}: ${total.distinct.size} distinct, ${total.occurrences} occurrences`);
  }
});

it('every catalogue message renders in some pinned state', async () => {
  const seen = new Set((await sentinel()).flatMap(entry => entry.keys));
  assert.deepEqual(KEYS.filter(key => !seen.has(key)), []);
  assert.deepEqual([...seen].filter(key => !KEYS.includes(key)), []);
});

it('text another package writes is shown inside a message and named with its owner', async () => {
  const details = (await sentinel()).flatMap(entry => entry.details).map(text => text.replace(/‹h:[^›]+›/g, ''));
  assert.deepEqual([...new Set(details.filter(text => text !== ''))].sort(), Object.keys(FOREIGN).sort());
});

const PACKS = { nl, de, fr, es, pt, ar };
const LANGUAGES = { nl: 'Dutch', de: 'German', fr: 'French', es: 'Spanish', pt: 'Portuguese', ar: 'Arabic' };
let englishRender: ReturnType<typeof both> | undefined;

for (const [lang, pack] of Object.entries(PACKS) as [keyof typeof PACKS, object][]) {
  it(`a ${LANGUAGES[lang]} render shows no assistant English, and what stays English is named by its owner`, async t => {
    const translated = await both(pack), english = await (englishRender ??= both());
    assert.equal(JSON.stringify(await both(pack)), JSON.stringify(translated), 'rendering is deterministic');
    const messages = createAssistantMessages(), cognates = new Set(Object.keys(COGNATES[lang]).map(key => messages[key as AssistantMessageKey]()));
    const left: string[] = [], suite: string[] = [], cognate = new Map<string, number>(), foreign = new Map<string, number>();
    let lettered = 0, viewLettered = 0;
    for (const [state, strings] of Object.entries(translated)) {
      const shown = new Set(english[state]!.map(seen => `${seen.where}\n${seen.text}`));
      for (const seen of strings) {
        if (!/\p{L}/u.test(seen.text.replace(/‹h:[^›]+›/g, ''))) continue;
        lettered++; if (state.startsWith('view: ')) viewLettered++;
        const name = `${state}: ${seen.where}: ${seen.text}`, same = shown.has(`${seen.where}\n${seen.text}`);
        const owner = Object.keys(FOREIGN).find(text => seen.text.includes(text));
        if (owner !== undefined) {
          assert.ok(!same, `${name}: foreign text sits in a ${LANGUAGES[lang]} frame`);
          foreign.set(FOREIGN[owner]!, (foreign.get(FOREIGN[owner]!) ?? 0) + 1);
        }
        else if (!same) continue;
        else if (cognates.has(seen.text)) cognate.set(seen.text, (cognate.get(seen.text) ?? 0) + 1);
        else if (classify(seen.text).class === 'suite') suite.push(name);
        else left.push(name);
      }
    }
    assert.deepEqual(left, []);
    assert.deepEqual(suite, SUITE_LABELS);
    assert.deepEqual([...foreign.keys()].sort(), [...new Set(Object.values(FOREIGN))].sort());
    assert.deepEqual([...cognate.keys()].sort(), [...cognates].sort());
    // the tool name sits where the language puts it: the split keeps the sentence's own order
    const [before = '', after = ''] = createAssistantMessages(pack)['activity/running']({ tool: '‹t›' }).split('‹t›');
    assert.deepEqual(translated['streaming, tool activity']!.filter(seen => seen.where === 'code' || seen.where === 'p.ai-activity').map(seen => seen.text),
      [before, '‹h:tool›', after, '…'].filter(text => text !== ''));
    t.diagnostic(`${lettered} lettered strings (${viewLettered} in view states): assistant English 0; cognates ${cognate.size} distinct, ${[...cognate.values()].reduce((a, b) => a + b, 0)} shown; `
      + `suite ${suite.length}; foreign ${[...foreign].map(([owner, n]) => `${owner} ${n}`).join(', ')}`);
  });
}

it('the controller, projections, component, view and mounts keep no prose outside the catalogue', () => {
  const prose = ['controller.ts', 'viewmodel.ts', 'component.ts', 'view.ts', 'mount.ts']
    .flatMap(name => stringLiterals(fileURLToPath(new URL(`../../components/assistant/src/${name}`, import.meta.url))))
    .filter(text => /\p{L} \p{L}/u.test(text));
  assert.deepEqual(prose, [...MODEL_FACING, ...CALLER_FACING]);
});
