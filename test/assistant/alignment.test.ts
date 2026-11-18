/**
 * An aligned table column in a reply follows the reply's direction: the
 * alignment marks of GFM (`:---`, `---:`) mean the reading start and end, so a
 * right-to-left reply aligns them to its right and left.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { replyMarkdown, logicalAlignment } from '../../components/assistant/src/mount.ts';
import { createAssistantMessages } from '../../components/assistant/src/messages.ts';

const styles = (vnode: any, out: string[] = []): string[] => {
  if (!Array.isArray(vnode)) return out;
  if (typeof vnode[0] === 'string' && vnode[1] && typeof vnode[1] === 'object' && !Array.isArray(vnode[1])) {
    if ((vnode[0] === 'th' || vnode[0] === 'td') && vnode[1].style) out.push(`${vnode[0]} ${vnode[1].style}`);
    vnode.slice(2).forEach(c => styles(c, out));
  } else vnode.forEach(c => styles(c, out));
  return out;
};

describe('aligned columns in a reply', () => {
  it('align to the reading start and end, never to a physical side', () => {
    const md = replyMarkdown('a1', createAssistantMessages());
    const found = styles(md.render('| a | b | c |\n|:---|:---:|---:|\n| 1 | 2 | 3 |'));
    assert.deepEqual(found, ['th text-align:start', 'th text-align:center', 'th text-align:end', 'td text-align:start', 'td text-align:center', 'td text-align:end']);
    assert.ok(!found.some(s => /left|right/.test(s)));
  });
  it('leaves every other node as it was', () => {
    const tree = ['article', { class: 'md' }, ['p', { style: 'text-align:left' }, 'x'], 'text'];
    assert.deepEqual(logicalAlignment(tree), tree);
  });
});
