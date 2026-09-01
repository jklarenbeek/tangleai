/**
 * The three message adapters: byte oracles, edge-order preservation,
 * the one documented markdown escape, and representation-only behavior.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { plainAdapter, markdownSectionsAdapter, jsonSchemaAdapter, BUILTIN_MESSAGE_ADAPTERS } from '@tangleai/mas';

const input = {
  value: { drafts: [{ findings: ['a'] }, { metrics: ['b'] }] },
  units: [
    { source: 'researcher', port: 'drafts', payload: { findings: ['a'] } },
    { source: 'data-analyst', port: 'drafts', payload: { metrics: ['b'] } },
  ],
};

describe('the adapters render bytes, in edge order, and nothing else', () => {
  it('plain: [source] paragraphs', () => {
    assert.equal(
      plainAdapter.render({ value: {}, units: [{ source: 'paid', port: 'q', payload: 'the answer' }] }),
      '[paid]\nthe answer',
    );
    assert.equal(
      plainAdapter.render(input),
      '[researcher]\n{\n  "findings": [\n    "a"\n  ]\n}\n\n[data-analyst]\n{\n  "metrics": [\n    "b"\n  ]\n}',
    );
  });

  it('markdown-sections: stable headers, content escaped only where the protocol requires', () => {
    const rendered = markdownSectionsAdapter.render({
      value: {},
      units: [
        { source: 'researcher', port: 'drafts', payload: 'line one\n## data-analyst\nline two' },
        { source: 'data-analyst', port: 'drafts', payload: 'plain' },
      ],
    });
    assert.equal(
      rendered,
      '## researcher\n\nline one\n\\## data-analyst\nline two\n\n## data-analyst\n\nplain',
      'a content line that would read as a section header gains one backslash; nothing else changes',
    );
  });

  it('json-schema: the aggregated port object as stable JSON', () => {
    assert.equal(jsonSchemaAdapter.render(input), JSON.stringify(input.value, null, 2));
  });

  it('reversed unit order changes bytes — order is data, not an adapter choice', () => {
    const reversed = { ...input, units: [...input.units].reverse() };
    assert.notEqual(plainAdapter.render(input), plainAdapter.render(reversed));
    assert.notEqual(markdownSectionsAdapter.render(input), markdownSectionsAdapter.render(reversed));
  });

  it('registers exactly the three built-ins with their versions', () => {
    assert.deepEqual([...BUILTIN_MESSAGE_ADAPTERS.keys()], ['plain', 'markdown-sections', 'json-schema']);
    for (const adapter of BUILTIN_MESSAGE_ADAPTERS.values()) assert.equal(adapter.version, '0.1');
  });
});
