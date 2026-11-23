/**
 * The Web reader's pure parts: what the address bar takes as an address and
 * what as search words, which links the reader follows, where a paragraph's
 * links stand in its text, and how a page's blocks become the desktop's own
 * elements (never the page's markup). Its manifest is a valid system app.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, unconfiguredWebReader, WEB_CODES } from '@tangleai/os';
import { classifyAddress, admitLink, linkify, blockNodes, webModule } from '@tangleai/os/web';

describe('the address bar', () => {
  it('reads an http(s) address, and a bare host as https', () => {
    assert.deepEqual(classifyAddress('  https://example.org/a?b=1 '), { kind: 'read', url: 'https://example.org/a?b=1' });
    assert.deepEqual(classifyAddress('http://example.org'), { kind: 'read', url: 'http://example.org/' });
    assert.deepEqual(classifyAddress('example.org/docs'), { kind: 'read', url: 'https://example.org/docs' });
    assert.deepEqual(classifyAddress('docs.example.co.uk:8443/x'), { kind: 'read', url: 'https://docs.example.co.uk:8443/x' });
  });

  it('searches anything else, and an empty bar is nothing', () => {
    assert.deepEqual(classifyAddress('json schema validator'), { kind: 'search', query: 'json schema validator' });
    assert.deepEqual(classifyAddress('node.js streams'), { kind: 'search', query: 'node.js streams' });
    assert.deepEqual(classifyAddress('localhost'), { kind: 'search', query: 'localhost' });
    assert.deepEqual(classifyAddress('3.14'), { kind: 'search', query: '3.14' });
    assert.deepEqual(classifyAddress('日本語 ウェブ'), { kind: 'search', query: '日本語 ウェブ' });
    assert.deepEqual(classifyAddress('   '), { kind: 'empty' });
  });

  it('searches an address it will not read', () => {
    assert.equal(classifyAddress('https://user:secret@example.org/').kind, 'search');
  });
});

describe('the links the reader follows', () => {
  it('admits http and https, resolved against the page', () => {
    assert.equal(admitLink('/b', 'https://example.org/a/'), 'https://example.org/b');
    assert.equal(admitLink('c', 'https://example.org/a/'), 'https://example.org/a/c');
    assert.equal(admitLink('http://other.example/'), 'http://other.example/');
  });

  it('refuses other schemes, credentials and what is not an address', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'mailto:a@example.org', 'file:///etc/passwd', 'ftp://example.org/', 'https://a:b@example.org/'])
      assert.equal(admitLink(href, 'https://example.org/'), null, href);
    assert.equal(admitLink('/relative'), null);
  });
});

describe('a paragraph with its links', () => {
  it('places each link where its words stand, in order', () => {
    const a = { text: 'first', href: 'https://example.org/1' }, b = { text: 'second', href: 'https://example.org/2' };
    assert.deepEqual(linkify('the first and the second end', [a, b]), ['the ', a, ' and the ', b, ' end']);
  });

  it('follows a link whose words are not in the text at the end', () => {
    const a = { text: 'elsewhere', href: 'https://example.org/x' };
    assert.deepEqual(linkify('plain text', [a]), ['plain text', ' ', a]);
    assert.deepEqual(linkify('no links'), ['no links']);
  });
});

describe('the page drawn in the desktop look', () => {
  it('maps every block kind to the desktop’s own elements', () => {
    const link = { text: 'here', href: '/x' };
    const nodes = blockNodes([
      { kind: 'heading', level: 1, text: 'Top' },
      { kind: 'heading', level: 6, text: 'Deep' },
      { kind: 'paragraph', text: 'go here now', links: [link] },
      { kind: 'list', ordered: true, items: ['one', 'two'] },
      { kind: 'list', ordered: false, items: ['dot'] },
      { kind: 'quote', text: 'said' },
      { kind: 'code', text: '<script>x()</script>' },
      { kind: 'table', rows: [['a', 'b']] },
    ]);
    assert.deepEqual(nodes.map(n => n.tag), ['h2', 'h6', 'p', 'ol', 'ul', 'blockquote', 'pre', 'table']);
    assert.deepEqual(nodes[2].children, [{ tag: '#text', text: 'go ' }, { tag: 'a', link }, { tag: '#text', text: ' now' }]);
    assert.deepEqual(nodes[3].children, [{ tag: 'li', text: 'one' }, { tag: 'li', text: 'two' }]);
    // markup in a page's text stays text
    assert.deepEqual(nodes[6].children, [{ tag: 'code', text: '<script>x()</script>' }]);
    assert.deepEqual(nodes[7].children, [{ tag: 'tbody', children: [{ tag: 'tr', children: [{ tag: 'td', text: 'a' }, { tag: 'td', text: 'b' }] }] }]);
  });
});

describe('the Web module', () => {
  it('is a valid system app, titled in the desktop language', () => {
    const { manifest } = webModule({ reader: unconfiguredWebReader() });
    assert.equal(validateManifest(manifest).ok, true);
    assert.equal(manifest.category, 'system');
    assert.deepEqual(manifest.title, { en: 'Web' });
    assert.deepEqual(webModule({ reader: unconfiguredWebReader(), locale: 'ja', messages: { 'web/title': 'ウェブ' } }).manifest.title, { en: 'Web', ja: 'ウェブ' });
  });

  it('an unconfigured reader refuses with OS0180', async () => {
    await assert.rejects(unconfiguredWebReader().read({ url: 'https://example.org/' }), (e: any) => e.code === WEB_CODES.unconfigured);
  });
});
