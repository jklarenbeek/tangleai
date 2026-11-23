/**
 * The desktop's chrome text: every key the shell renders exists in the
 * catalogue, every catalogue key is rendered, and the shell writes no visible
 * sentence outside the catalogue. Also the origin rule for framed
 * applications: a page on the desktop's own origin is refused.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { osMessagesEn, createOsMessages } from '@tangleai/os';
import { originHostProblem } from '@tangleai/os/shell';

// the chrome's text: the shell, the desktop's Settings, its Files and Web, the install sheet and Applications and access
const shell = ['shell.ts', 'settings.ts', 'files-app.ts', 'web-app.ts', 'install-sheet.ts', 'access.ts'].map(file => readFileSync(new URL(`../../components/os/src/${file}`, import.meta.url), 'utf8')).join('\n');

describe('the shell catalogue', () => {
  it('renders exactly the catalogue\'s keys', () => {
    const used = new Set([...shell.matchAll(/\bt\('([a-z-]+\/[a-z-]+)'/g)].map(m => m[1]));
    const keys = new Set(Object.keys(osMessagesEn));
    assert.deepEqual([...used].filter(k => !keys.has(k)), [], 'every rendered key exists');
    assert.deepEqual([...keys].filter(k => !used.has(k)), [], 'every catalogue key is rendered');
  });
  it('sets no visible text from a literal', () => {
    const literals = [...shell.matchAll(/(?:\.textContent\s*=|\.title\s*=|setAttribute\('aria-label',)\s*'([^'\n]*[A-Za-z][^'\n]*)'/g)].map(m => m[1]);
    assert.deepEqual(literals, []);
  });
  it('fills placeholders as text and lets a pack replace any sentence', () => {
    const t = createOsMessages({ 'dock/open': '{title} openen' });
    assert.equal(t('dock/open', { title: '<b>x</b>' }), '<b>x</b> openen');
    assert.equal(t('window/close'), 'Close');
  });
});

describe('framing an application', () => {
  it('refuses a page on the desktop\'s own origin, and anything not http(s)', () => {
    assert.match(originHostProblem('https://user.github.io/other/app.html', 'https://user.github.io')!, /shares the desktop's origin/);
    assert.match(originHostProblem('javascript:alert(1)', 'https://desk.example')!, /not an http\(s\) page/);
    assert.match(originHostProblem('nope', 'https://desk.example')!, /not a URL/);
    assert.equal(originHostProblem('https://records.example/app', 'https://desk.example'), null);
  });
});
