/**
 * Theme kits and procedural wallpapers: every kit composes into a theme the
 * desktop accepts, in light and dark; a person's changes apply, and malformed
 * ones are ignored; every pattern is deterministic for a seed, changes with
 * the seed, and draws only with the theme's own colours.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { THEME_KITS, composeTheme, checkTheme, PATTERNS, patternBackground } from '@tangleai/os';

describe('theme kits', () => {
  it('compose into an accepted theme for every kit and scheme', () => {
    assert.ok(THEME_KITS.length >= 5);
    for (const kit of THEME_KITS) for (const scheme of ['light', 'dark'] as const) {
      const theme = composeTheme(kit.id, scheme);
      assert.deepEqual(checkTheme(theme), [], `${kit.id} ${scheme}`);
      assert.equal(theme.name, kit.name);
      assert.equal(theme.tokens['--os-desktop'], kit.pattern);
    }
  });
  it('give the failure colour an ink that reads on it (a badge, a hovered close) in every kit and scheme', () => {
    const channel = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const luminance = (hex: string) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255); };
    const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    for (const kit of THEME_KITS) for (const scheme of ['light', 'dark'] as const) {
      const { tokens } = composeTheme(kit.id, scheme);
      assert.match(tokens['--fail-fg'] ?? '', /^#[0-9a-f]{6}$/i, `${kit.id} ${scheme} names an ink for --fail`);
      assert.ok(contrast(tokens['--fail'], tokens['--fail-fg']) >= 4.5, `${kit.id} ${scheme}: ${contrast(tokens['--fail'], tokens['--fail-fg']).toFixed(2)}:1`);
    }
  });

  it('apply an accent, a pattern, glass, corners and spacing, and ignore malformed changes', () => {
    const theme = composeTheme('loom', 'light', { accent: '#c81e64', pattern: 'moire', seed: 42, glass: 0, corners: 'sharp', spacing: 'compact' });
    assert.equal(theme.tokens['--accent'], '#c81e64');
    assert.equal(theme.tokens['--accent-fg'], '#ffffff');
    assert.equal(theme.tokens['--os-desktop'], 'moire');
    assert.equal(theme.tokens['--os-pattern-seed'], '42');
    assert.equal(theme.tokens['--os-radius-window'], '6px');
    assert.equal(theme.tokens['--os-titlebar-height'], '34px');
    assert.match(theme.tokens['--os-glass'], /blur\(4px\)/);
    const bad = composeTheme('loom', 'light', { accent: 'url(https://x.example)' as any, knot: 'red' as any });
    assert.equal(bad.tokens['--accent'], composeTheme('loom', 'light').tokens['--accent']);
    assert.equal(composeTheme('no-such-kit', 'dark').name, THEME_KITS[0].name);
  });
});

describe('procedural wallpapers', () => {
  it('draw the same picture for a seed, a different one for another seed, in the theme\'s colours', () => {
    for (const pattern of Object.keys(PATTERNS)) {
      const tokens: Record<string, string> = { ...composeTheme('loom', 'light').tokens, '--os-desktop': pattern };
      const a = patternBackground(tokens)!, b = patternBackground(tokens)!;
      const c = patternBackground({ ...tokens, '--os-pattern-seed': '99' })!;
      assert.equal(a, b, `${pattern} is deterministic`);
      assert.notEqual(a, c, `${pattern} follows the seed`);
      const svg = decodeURIComponent(a.slice(a.indexOf(',') + 1, a.lastIndexOf('")')));
      const colours = new Set([...svg.matchAll(/#[0-9a-f]{6}/gi)].map(m => m[0].toLowerCase()));
      const allowed = new Set(['--os-ground-1', '--os-ground-2', '--os-thread-1', '--os-thread-2', '--os-thread-3', '--os-knot'].map(t => tokens[t].toLowerCase()));
      assert.deepEqual([...colours].filter(c => !allowed.has(c)), [], `${pattern} uses only theme colours`);
      assert.ok(!/<script|javascript:|href=/i.test(svg), `${pattern} draws no script or link`);
    }
    assert.equal(patternBackground({ '--os-desktop': 'linear-gradient(red, blue)' }), null);
  });
});
