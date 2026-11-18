/**
 * The Pages desktop's own text: every key its applications render exists in
 * the catalogue, every catalogue key is rendered, and the applications write
 * no visible sentence outside the catalogue. A pack replaces any sentence,
 * closures included, and the sentinel pack renders every key as itself.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { pagesMessagesEn, type PagesMessageKey } from '../../apps/pages/src/os/messages.ts';
import { localizedKeywords, localizedText, pagesLanguage, sentinelMessages, setPagesLanguage, setPagesMessages, t } from '../../apps/pages/src/os/i18n.ts';

const dir = new URL('../../apps/pages/src/os/', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, dir), 'utf8');
// every key the desktop's files render, wherever it is rendered
const everything = readdirSync(dir).filter(file => file.endsWith('.ts') && file !== 'messages.ts' && file !== 'i18n.ts').map(read).join('\n');
// the applications whose sentences live in the catalogue
const source = ['settings-app.ts', 'welcome-app.ts', 'calendar-app.ts', 'calendar-model.ts', 'loop-app.ts', 'assistant-app.ts', 'surfaces.ts', 'modules.ts'].map(read).join('\n');

/** What a literal says once its `${…}` expressions are gone; a JSLT path (`$.draft`) says nothing. */
const words = (text: string) => text.startsWith('$') ? '' : text.replace(/\$\{[^}]*\}/g, '');
/** Any letter: a property or an assignment that shows text holds none of its own. */
const wordy = (text: string) => /[A-Za-z]/.test(words(text));
/** Hyphenated class names, such as the ' is-chosen' a condition appends. */
const classNames = (text: string) => text.trim().split(/\s+/).every(token => /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(token));
/** Reads as a sentence or a name: a lower-case letter, and a space or a capital (an id, a class name, an action or a rule like FREQ=DAILY does not). */
const sentence = (text: string) => /[a-z]/.test(words(text)) && /[\sA-Z]/.test(words(text)) && !classNames(words(text));
const quoted = String.raw`(['\x60])((?:(?!\1)[^\n\\]|\\.)*)\1`;
const literals = (pattern: string, keep: (text: string) => boolean) => [...source.matchAll(new RegExp(pattern, 'g'))].map(m => m[m.length - 1]).filter(keep);

describe('the Pages desktop catalogue', () => {
  afterEach(() => { setPagesMessages(); setPagesLanguage('en'); });

  it('renders exactly the catalogue\'s keys', () => {
    const used = new Set([...everything.matchAll(/\bt\('([a-z-]+\/[a-z-]+)'/g)].map(m => m[1]));
    const keys = new Set(Object.keys(pagesMessagesEn));
    assert.deepEqual([...used].filter(k => !keys.has(k)), [], 'every rendered key exists');
    assert.deepEqual([...keys].filter(k => !used.has(k)), [], 'every catalogue key is rendered');
  });

  it('sets no visible text from a literal', () => {
    const found = [
      // assignments and attributes: el.textContent = '…', el.title = '…', setAttribute('aria-label', '…')
      ...literals(String.raw`(?:\.textContent\s*=|\.title\s*=|setAttribute\('(?:aria-label|title|placeholder)',)\s*` + quoted, wordy),
      // properties that carry words: placeholder: '…', 'aria-label': '…', title: '…', label: '…', error: '…', refused: '…', text: '…'
      ...literals(String.raw`(?:\bplaceholder|'aria-label'|\btitle|\blabel|\blaunchTitle|\bintro|\bsettingsHint|\berror|\brefused|\btext)\s*:\s*` + quoted, wordy),
      // a child of h(tag, {…}, '…'), el(tag, {…}, '…') or a hiccup ['tag', {…}, '…'] on one line, even a single word
      ...literals(String.raw`(?:\b(?:h|el)\(|\[)'[a-z0-9]+',\s*\{[^\n]*?\}\s*,\s*` + quoted, wordy),
      // the same after props that span lines: h('button', {\n…\n}, 'Show')
      ...literals(String.raw`\}\s*,\s*` + quoted, sentence),
      // h(tag, 'class', '…'): Welcome's helper takes a class name, then the text
      ...literals(String.raw`\bh\('[a-z0-9]+',\s*'[^'\n]*',\s*` + quoted, wordy),
      // a sentence chosen by a condition or held in a table: cond ? 'Show' : 'Hide', { weave: 'Threads' }
      // (class names, addresses, provider names as parameters, contract `doc:` strings and headers are not sentences)
      ...literals(String.raw`(?:\?|(?<!\b(?:class|href|path|prodId|provider|doc|Authorization)):)\s*` + quoted, sentence),
    ];
    assert.deepEqual(found, []);
  });

  it('fills placeholders as text and lets a pack replace any sentence, closures included', () => {
    assert.equal(t('providers/key-saved', { provider: '<b>x</b>' }), '<b>x</b> key saved in this browser.');
    assert.equal(t('models/match', { count: 3 }), '3 models match.');
    setPagesMessages({ 'models/match': (p: { count: number }) => `${p.count} modellen`, 'calendar/save': 'Opslaan' });
    assert.equal(t('models/match', { count: 3 }), '3 modellen');
    assert.equal(t('calendar/save'), 'Opslaan');
    assert.equal(t('calendar/cancel'), 'Cancel', 'a missing key renders English');
    assert.throws(() => setPagesMessages({ 'nope/nope': 'x' } as any), /unknown Pages message key/);
  });

  it('keeps the English sentences the desktop showed before', () => {
    assert.equal(t('providers/key-works', {}), 'The key works.');
    assert.equal(t('providers/key-works', { used: '$1.20', limit: null, freeTier: true }), 'The key works · $1.20 used, no limit · free tier.');
    assert.equal(t('providers/key-works', { used: '$1.20', limit: '$5.00' }), 'The key works · $1.20 used of $5.00.');
    assert.equal(t('calendar/hours', { count: 1.5 }), '1½ h');
    assert.equal(t('calendar/skip-months', { day: 31 }), 'Months without a 31st are skipped.');
    assert.equal(t('loop/policy', { novelty: true, contradiction: false, crystallization: true, dims: 64 }), 'Novelty on, contradiction off, crystallization on; 64-dimension hash matching in this browser.');
  });

  it('renders every key as ⟦key⟧ under the sentinel, closures included', () => {
    setPagesMessages('sentinel');
    for (const key of Object.keys(pagesMessagesEn) as PagesMessageKey[]) assert.equal(t(key, { count: 2, day: 31 } as any), `⟦${key}⟧`);
    assert.equal(Object.keys(sentinelMessages()).length, Object.keys(pagesMessagesEn).length);
  });

  it('adds the desktop\'s language to manifest text and Settings keywords only when it is not English', () => {
    assert.equal(pagesLanguage(), 'en');
    assert.deepEqual(localizedText('Calendar', 'Calendar', { nl: 'Agenda' }), { en: 'Calendar', nl: 'Agenda' });
    assert.deepEqual(localizedKeywords('key, api key', 'key, api key'), ['key', 'api key']);
    setPagesLanguage('nl');
    assert.deepEqual(localizedText('Calendar', 'Kalender', { nl: 'Agenda' }), { en: 'Calendar', nl: 'Kalender' });
    assert.deepEqual(localizedKeywords('key, api key', 'sleutel, api-sleutel'), ['key', 'api key', 'sleutel', 'api-sleutel']);
    setPagesLanguage('sentinel');
    assert.deepEqual(localizedText('Calendar', '⟦apps/calendar⟧'), { en: 'Calendar' }, 'a manifest refuses a language it does not know');
  });
});
