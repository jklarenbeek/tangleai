/**
 * Radiant OS stage (Pages, Tangle edition): the camera, the figures, the
 * frame composer, both paint backends, the stage widget and the
 * sculpture — still frames, verdict animation, picks and the sculptor.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { renderToString } from '@jarenjs/view';
import { createStubHost, serialize } from '../assistant/dom.stub.ts';
import { HOME_CAMERA, viewOf, project, orbit, dolly, DISTANCE_MAX } from '../../apps/pages/src/os/stage/camera.ts';
import { POSES, person, baby, hand, signGlyph } from '../../apps/pages/src/os/stage/figures.ts';
import { composeFrame, HUMAN_INK, STAGE_THEMES } from '../../apps/pages/src/os/stage/scene.ts';
import type { Motion } from '../../apps/pages/src/os/stage/scene.ts';
import { paintCanvas, toSvg } from '../../apps/pages/src/os/stage/paint.ts';
import { stillFrame, stageWidget, createAnim, absorb, motionAt } from '../../apps/pages/src/os/stage/widget.ts';
import { sculpt, layoutSculpture, composeSculpture, labelOf } from '../../apps/pages/src/os/stage/sculpture.ts';
import { sceneOf } from '../../apps/pages/src/os/app/scene.ts';
import { initialState } from '../../apps/pages/src/os/app/state.ts';
import { compileMachine, stepWorld } from '../../apps/pages/src/os/kernel/machine.ts';

function sceneAfter(ticks = 120, tweak?: (state: any) => void) {
  const state = initialState({ edition: 'test', title: 'Radiant OS' });
  state.world = stepWorld(compileMachine(state.program.machine), state.world, ticks).world;
  tweak?.(state);
  return sceneOf(state);
}
const still = (): Motion => ({ time: 0, now: 0, moving: false, heads: {}, heights: null, stamps: [], effects: [] });
const view = viewOf(HOME_CAMERA, 960, 640);

describe('the stage', () => {
  it('projects, orbits and dollies the camera', () => {
    assert.ok(Math.abs(project(view, 0, 0, 0)[0] - 480) < 1e-6);
    assert.ok(orbit(HOME_CAMERA, 100, 0).azimuth > HOME_CAMERA.azimuth);
    assert.equal(dolly(HOME_CAMERA, 100).distance, DISTANCE_MAX);
  });

  it('draws figures, signs and the human’s hand', () => {
    assert.equal(person(POSES.dance).strokes.length, 5);
    assert.ok(person(POSES.dance, { head: 'tv' }).screen);
    assert.equal(baby(0).dots.length, 1);
    assert.equal(hand().strokes.length, 6);
    assert.deepEqual(signGlyph({ kind: 'rule', member: 'write', value: 3 }), { strokes: [], swatch: 3 });
    assert.equal(signGlyph({ kind: 'tape', op: 'mirror' }).strokes.length, 3);
  });

  it('composes the floor, the dancers, the seats and the verdict', () => {
    const { items, picks } = composeFrame(sceneAfter(200), view, still());
    assert.deepEqual(picks.map((p) => p.id).sort(), ['architect', 'critic', 'dancer', 'human', 'oracle', 'painter']);
    const winner = { id: 'critic-1', by: 'critic', title: 'Wash', why: '', change: { kind: 'tape', op: 'clear' } };
    const verdict = composeFrame(sceneAfter(80, (s) => { Object.assign(s.council, { phase: 'veto', winner, proposals: [winner], deadline: 9000, window: 9000 }); }), view, still());
    assert.ok(verdict.picks.some((p) => p.kind === 'sign'));
    assert.ok(verdict.items.some((i) => i.t === 'arc'), 'the countdown ring');
    const vetoed = composeFrame(sceneAfter(80), view, { ...still(), time: 5000, moving: true, effects: [{ kind: 'veto', age: 800, by: 'critic', change: winner.change }] });
    assert.ok(vetoed.items.some((i) => i.t === 'line' && i.stroke === HUMAN_INK), 'the hand comes down');
    assert.ok(items.length > 100);
  });

  it('paints the same list to a canvas and to SVG', () => {
    const calls: string[] = [];
    const ctx: any = new Proxy({}, { get: (t: any, p) => (p in t ? t[p] : () => { calls.push(String(p)); }), set: (t: any, p, v) => { t[p] = v; return true; } });
    const items = composeFrame(sceneAfter(40), view, still()).items;
    paintCanvas(ctx, items, '#fff7e6', 960, 640);
    assert.equal(calls[0], 'fillRect');
    const svg = toSvg(items, { width: 960, height: 640, background: '#fff7e6', title: 'Still' });
    assert.match(renderToString(svg as any), /^<svg[^>]*aria-label="Still"/);
    assert.equal(stillFrame(sceneAfter(40), { title: 'Snapshot' })[2][2], 'Snapshot');
  });

  it('mounts as a widget that draws still frames under reduced motion, and animates hops', () => {
    const { document, container } = createStubHost();
    const host = document.createElement('div');
    container.appendChild(host);
    const scene = sceneAfter(30);
    const handle = stageWidget.mount(host, { scene, reduce: true, label: 'Stage' }, () => {}, { document });
    assert.match(serialize(container as any), /aria-label="Stage"/);
    stageWidget.update(handle, { scene: sceneAfter(31), reduce: true, label: 'Stage 31' }, { scene, reduce: true, label: 'Stage' });
    assert.equal(host.getAttribute('aria-label'), 'Stage 31');
    stageWidget.unmount(handle);
    const anim = createAnim(scene);
    const moved = { ...scene, heads: scene.heads.map((h, i) => (i === 0 ? { ...h, x: (h.x + 1) % scene.width } : h)) };
    absorb(anim, moved, 100, 10);
    assert.ok(motionAt(anim, 150, true).heads[scene.heads[0].id].hop > 0.9, 'mid-hop is the top of the jump');
    assert.deepEqual(motionAt(anim, 150, false).heads, {});
  });

  it('sculpts any document into a crowd of figures', () => {
    const layout = layoutSculpture(sculpt({ name: 'radiant', ok: true, list: [1, 'two', null] }));
    assert.equal(layout.nodes.length, 7);
    assert.equal(labelOf("$['list'][2]"), '#2');
    const items = composeSculpture(layout, viewOf({ azimuth: 0.5, elevation: 0.62, distance: 24, lift: 0.6, fov: 0.62 }, 640, 480),
      { time: 0, moving: false, active: new Set(['$']) }, 'dark');
    assert.equal((items[0] as any).fill, STAGE_THEMES.dark.floor);
    assert.ok(items.some((i) => i.t === 'disc' && i.fill === STAGE_THEMES.dark.glow), 'what executes glows');
  });
});
