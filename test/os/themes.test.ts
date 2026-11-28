/**
 * Theme kits and procedural wallpapers: every kit composes into a theme the
 * desktop accepts, in light and dark; a person's changes apply, and malformed
 * ones are ignored; every pattern is deterministic for a seed, changes with
 * the seed, and draws only with the theme's own colours. Every text colour
 * reads at WCAG AA on the grounds the chrome draws it on, and the chrome's
 * stylesheet takes every text ink from a token, so a host's theme reaches it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  it('draw every text colour at WCAG AA on every ground the chrome puts it on, in every kit and scheme', () => {
    const parse = (value: string) => {
      const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
      if (hex) { const n = parseInt(hex[1], 16); return [n >> 16, (n >> 8) & 255, n & 255, 1]; }
      const fn = /^rgba?\(([^)]+)\)$/.exec(value.trim());
      assert.ok(fn, `a colour: ${value}`);
      const [r, g, b, a = 1] = fn![1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return [r, g, b, a];
    };
    const over = (top: number[], ground: number[]) => [0, 1, 2].map(i => top[i] * top[3] + ground[i] * (1 - top[3])).concat(1);
    const channel = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const luminance = (c: number[]) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
    const contrast = (a: number[], b: number[]) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const failures: string[] = [];
    for (const kit of THEME_KITS) for (const scheme of ['light', 'dark'] as const) {
      const { tokens } = composeTheme(kit.id, scheme);
      const surface = parse(tokens['--surface']), bg = parse(tokens['--bg']);
      const grounds: [string, number[]][] = [['--surface', surface], ['--bg', bg]];
      const check = (text: string, ground: string, a: number[], b: number[]) => {
        const ratio = contrast(a, b);
        if (ratio < 4.5) failures.push(`${kit.id} ${scheme}: ${text} on ${ground} ${ratio.toFixed(2)}:1`);
      };
      for (const text of ['--fg', '--muted', '--accent', '--ok', '--warn', '--fail']) for (const [name, ground] of grounds) check(text, name, parse(tokens[text]), ground);
      // a selected entry or a badge: the colour as text on its own soft tint
      for (const [text, soft] of [['--accent', '--accent-soft'], ['--ok', '--ok-soft'], ['--warn', '--warn-soft'], ['--fail', '--fail-soft']]) for (const [name, ground] of grounds)
        check(text, `${soft} over ${name}`, parse(tokens[text]), over(parse(tokens[soft]), ground));
      check('--accent-fg', '--accent', parse(tokens['--accent-fg']), parse(tokens['--accent']));
      check('--fail-fg', '--fail', parse(tokens['--fail-fg']), parse(tokens['--fail']));
    }
    assert.deepEqual(failures, []);
  });
  it('keep a person\'s accent as chosen where it reads, and move it toward readable where it does not', () => {
    const channel = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const luminance = (c: number[]) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
    const contrast = (a: string, b: string) => { const [x, y] = [luminance(rgb(a)), luminance(rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    // a light-only swatch, a dark-only one, a pale yellow, a near-black, a mid grey and the kits' own
    for (const accent of ['#334155', '#9fc2f0', '#ffe066', '#0b0b0b', '#808080', '#b81c5c', '#1f5fa8'])
      for (const kit of THEME_KITS) for (const scheme of ['light', 'dark'] as const) {
        const { tokens } = composeTheme(kit.id, scheme, { accent });
        for (const ground of ['--surface', '--bg'])
          assert.ok(contrast(tokens['--accent'], tokens[ground]) >= 4.5, `${accent} in ${kit.id} ${scheme}: ${tokens['--accent']} on ${ground} ${contrast(tokens['--accent'], tokens[ground]).toFixed(2)}:1`);
        assert.ok(contrast(tokens['--accent-fg'], tokens['--accent']) >= 4.5, `${accent} in ${kit.id} ${scheme}: its ink`);
      }
    assert.equal(composeTheme('loom', 'light', { accent: '#1f5fa8' }).tokens['--accent'], '#1f5fa8');
    assert.equal(composeTheme('loom', 'dark', { accent: '#9fc2f0' }).tokens['--accent'], '#9fc2f0');
    assert.notEqual(composeTheme('loom', 'dark', { accent: '#334155' }).tokens['--accent'], '#334155');
  });
  it('take every text ink of the chrome from a token, never a literal colour', () => {
    const css = readFileSync(new URL('../../components/os/styles/os.css', import.meta.url), 'utf8');
    const literal = [...css.matchAll(/(?:^|[;{\s])color:\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\)|white|black)\s*[;}]/gim)].map(m => m[1]);
    assert.deepEqual(literal, []);
  });

  it('apply an accent, a pattern, glass, corners and spacing, and ignore malformed changes', () => {
    const theme = composeTheme('loom', 'light', { accent: '#b81c5c', pattern: 'moire', seed: 42, glass: 0, corners: 'sharp', spacing: 'compact' });
    assert.equal(theme.tokens['--accent'], '#b81c5c');
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
