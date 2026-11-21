/**
 * An application's right-click menu is a document the desktop checks before it
 * draws it: text and desktop glyphs, separators, disabled and checked items, a
 * shortcut hint, one level of submenus, every id once.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkMenu } from '@tangleai/os';

const code = (value: unknown) => { const outcome = checkMenu(value); return outcome.ok ? 'ok' : outcome.error.code; };

describe('the menu document', () => {
  it('takes items, separators, a glyph, a hint, disabled and checked items, and one submenu level', () => {
    assert.equal(code([
      { id: 'open', label: 'Open', glyph: 'document', hint: 'Enter' },
      'separator',
      { id: 'pin', label: 'Pinned', checked: true },
      { id: 'share', label: 'Share', items: [{ id: 'copy-link', label: 'Copy the link' }, 'separator', { id: 'mail', label: 'Mail it', disabled: true }] },
    ]), 'ok');
  });

  it('refuses what it cannot draw as the desktop\'s own: no markup, no deeper submenus, no stray fields, no empty menu', () => {
    for (const [why, menu] of [
      ['an empty menu', []],
      ['a label that is not text', [{ id: 'a', label: 42 }]],
      ['an empty label', [{ id: 'a', label: '' }]],
      ['an unknown field (markup)', [{ id: 'a', label: 'A', html: '<b>A</b>' }]],
      ['a glyph that is not a desktop glyph name', [{ id: 'a', label: 'A', glyph: '<svg>' }]],
      ['a submenu inside a submenu', [{ id: 'a', label: 'A', items: [{ id: 'b', label: 'B', items: [{ id: 'c', label: 'C' }] }] }]],
      ['an id with spaces', [{ id: 'not ok', label: 'A' }]],
      ['too many entries', Array.from({ length: 41 }, (_, i) => ({ id: `i${i}`, label: `Item ${i}` }))],
    ] as const) assert.equal(code(menu), 'OS0170', why);
  });

  it('refuses an id used twice, in the menu or in a submenu', () => {
    assert.equal(code([{ id: 'a', label: 'A' }, { id: 'a', label: 'Again' }]), 'OS0170');
    assert.equal(code([{ id: 'a', label: 'A' }, { id: 'more', label: 'More', items: [{ id: 'a', label: 'A again' }] }]), 'OS0170');
  });
});
