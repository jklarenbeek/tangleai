/**
 * Radiant OS studio, running (Pages, Tangle edition): settings and the
 * three art directions,
 * the pause menu holding the machine, the music and the council's
 * verdict clock, mail with the oracle answering from the documentation,
 * the board, the library read, heard and asked, a whole crew project
 * shipped through the contract, the arcade hosting a game (its HUD, its
 * menus, its moves for a language model), the coach — and each of the
 * studio's widgets on its own.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { renderToString } from '@jarenjs/view';
import { bootOs, windowHost, findNode, findAll } from './os-harness.ts';
import { fire } from '../assistant/dom.stub.ts';
import type { OsOptions } from '../../apps/pages/src/os/app/createOs.ts';
import { libraryFrom } from '../../apps/pages/src/os/kernel/library.ts';
import { POSES } from '../../apps/pages/src/os/stage/figures.ts';
import { HOME_CAMERA } from '../../apps/pages/src/os/stage/camera.ts';
import { boardWidget, wrapText, squiggle, hitWall, wallVnode, wallFrame, CARD } from '../../apps/pages/src/os/stage/board-widget.ts';
import { miniWidget } from '../../apps/pages/src/os/stage/mini-widget.ts';
import { createArcade, WORK_MS } from '../../apps/pages/src/os/games/arcade.ts';
import { play, idle, IDLE_INPUT, TICK_MS } from '../../apps/pages/src/os/games/game.ts';
import { studioState, restoreStudio, studioSlice, ART, BUDGETS } from '../../apps/pages/src/os/app/studio-state.ts';
import { CREW_BEAT_MS } from '../../apps/pages/src/os/app/studio-host.ts';
import { buildApp } from '../../apps/pages/src/os/kernel/blocks.ts';
import { GAMES } from '../../apps/pages/src/os/games/registry.ts';
import { expected } from '../../apps/pages/src/os/kernel/ladder.ts';

/** A small game every arcade test plays: it moves, reports, and is won by one move. */
const toy = {
  id: 'toy', title: 'Toy', blurb: 'A test game', track: 'arena', duel: true,
  camera: { ...HOME_CAMERA, distance: 20, target: [0, 0, 0] as [number, number, number] },
  create: (init: any) => ({ x: 0, z: 0, best: init.save?.best ?? 0, won: false, players: init.players.length, ticks: 0, taps: 0, lang: init.options?.lang, born: init.options?.now }),
  step: (s: any, input: any) => {
    const events: any[] = [];
    const x = s.x + (input.held.right ? 0.1 : 0) - (input.held.left ? 0.1 : 0);
    const z = s.z + (input.held.down ? 0.1 : 0) - (input.held.up ? 0.1 : 0);
    if (input.pressed.includes('hint')) events.push({ kind: 'follow', target: [x, 0, z], lag: 0.2 });
    if (input.pressed.includes('act')) {
      events.push({ kind: 'sfx', name: 'pop' }, { kind: 'fx', fx: 'sparks', at: [x, 0, z] }, { kind: 'shake', amp: 4 }, { kind: 'flash', color: '#fde68a' },
        { kind: 'kick', body: 'hero', impulse: [2, 3] }, { kind: 'say', who: 'Mimi', text: 'Hi!' }, { kind: 'rate', skill: 'add', correct: true, difficulty: 500 },
        { kind: 'xp', amount: 5, reason: 'act' }, { kind: 'shot', shot: 'close' }, { kind: 'follow', target: [x, 0, z] }, { kind: 'follow', target: null });
    }
    return { state: { ...s, x, z, ticks: s.ticks + 1, taps: s.taps + (input.tap ? 1 : 0) }, events };
  },
  act: (s: any, a: any) => (a.type === 'win'
    ? { state: { ...s, won: true, best: 3 }, events: [{ kind: 'setting', key: 'ai.toolBudget', value: 'small' }] }
    : { state: s, events: [] }),
  draw: (_s: any, ctx: any) => ({
    items: [{ t: 'disc', x: 10, y: 10, r: 5, fill: ctx.theme.ink, stroke: null, w: 0 }],
    figures: [{ id: 'hero', pose: POSES.dance }], picks: [],
  }),
  hud: (s: any) => ({
    title: 'Toy', score: `${s.ticks}`, prompt: 'Go', level: 'One', buttons: [{ id: 'win', label: 'Win', primary: true }],
    players: [{ name: 'P1', score: '0', active: true, color: '#f97316' }], meter: { label: 'x', value: 0.5 }, toast: s.won ? 'Won' : null, help: 'keys',
    grid: { columns: ['a'], rows: [{ label: 'r', cells: [{ id: 'c', text: 'x', active: true, swatch: '#2563eb' }] }] },
  }),
  over: (s: any) => (s.won ? { stars: 3, score: 100, summary: 'You won' } : null),
  save: (s: any) => ({ best: s.best }),
  tools: [{
    name: 'toy_read', description: 'read the toy', inputSchema: { type: 'object', properties: { n: { type: 'integer' } }, additionalProperties: false },
    run: (s: any, input: any) => ({ state: { ...s, read: input.n ?? 0 }, result: { x: s.x }, events: [{ kind: 'sfx', name: 'pop' }] }),
  }, {
    name: 'toy_quiet', description: 'no events', inputSchema: { type: 'object' },
    run: (s: any) => ({ state: s, result: 'ok' }),
  }],
};

/** An audio player that records what it is asked to do. */
function recordingAudio() {
  const calls: any[] = [];
  let track: any = null;
  return {
    calls,
    get track() { return track; },
    sfx: (name: string) => { calls.push(['sfx', name]); return true; },
    play: (name: any, opts: any) => { calls.push(['play', name, opts?.melody?.()]); track = name; return true; },
    pause: () => calls.push(['pause']),
    resume: () => calls.push(['resume']),
    stop: () => { calls.push(['stop']); track = null; },
    setMix: (mix: any) => calls.push(['mix', mix]),
  };
}

const LIBRARY = libraryFrom([
  { id: 'flow', title: '@jarenjs/flow', source: 'flow', markdown: '# Flow\n\nMachines are documents. Transitions carry guards.\n\n## More\n\nA second section.\n\n```js\ncode();\n```\n\n## Last\n\nThe last words.' },
  { id: 'db', title: '@jarenjs/db', source: 'db', markdown: '# Store\n\nThe store keeps documents in SQLite.' },
]);

function studio(options: Partial<OsOptions> = {}) {
  const audio = recordingAudio();
  const budgets: string[] = [];
  const t = bootOs({
    games: { toy: toy as any },
    audio: audio as any,
    loadLibrary: async () => LIBRARY,
    onBudget: (tier) => budgets.push(tier),
    ...options,
  });
  return { ...t, audio, budgets };
}

describe('settings and the art directions', () => {
  it('switches the art, the sound, the light, the camera, motion and the model’s budget', async () => {
    const t = studio();
    t.dispatch('settings/art', 'neon');
    assert.equal(t.state().os.theme, 'neon');
    assert.equal(t.state().settings.art, 'neon');
    assert.deepEqual(t.prefs.at(-1), { theme: 'neon', reduce: false });
    assert.match(t.html(), /data-theme="neon"/);
    t.dispatch('settings/art', 'chalk');
    assert.equal(t.state().os.theme, 'dark');
    t.os.app.dispatch('os/app', 'settings');
    const sliders = findAll(t.container, (n) => n.tagName === 'input' && n.getAttribute?.('type') === 'range');
    assert.ok(sliders.length >= 5);
    sliders[0].value = '0.4';
    fire(sliders[0], 'input');
    assert.equal(t.state().settings.audio.master, 0.4);
    assert.ok(t.audio.calls.some((c) => c[0] === 'mix' && c[1].master === 0.4));
    t.dispatch('settings/mute');
    assert.equal(t.state().settings.audio.muted, true);
    const hour = sliders.find((n) => n.parentNode?.getAttribute?.('data-coach') === 'settings-light') ?? sliders[3];
    hour.value = '21';
    fire(hour, 'input');
    assert.equal(t.state().settings.light.hour, 21);
    assert.equal(t.state().coach.marks.light, 1);
    t.dispatch('settings/light', { hour: 6, bands: 4 });
    assert.deepEqual([t.state().settings.light.hour, t.state().settings.light.bands], [6, 4]);
    sliders[4].value = '2';
    fire(sliders[4], 'input');
    assert.equal(t.state().settings.light.bands, 2);
    for (const a of ['settings/shadows', 'settings/orbit', 'settings/ragdoll', 'settings/captions']) t.dispatch(a);
    assert.equal(t.state().settings.light.shadows, false);
    assert.equal(t.state().settings.camera.orbit, false);
    assert.equal(t.state().settings.motion.ragdoll, false);
    assert.equal(t.state().settings.captions, false);
    t.dispatch('settings/budget', 'small');
    assert.deepEqual(t.budgets, ['small']);
    const model = findNode(t.container, (n) => n.tagName === 'input' && n.getAttribute?.('placeholder') === 'qwen/qwen3.6-35b-a3b');
    model.value = 'qwen/qwen3.8-27b';
    fire(model, 'change');
    assert.equal(t.state().settings.ai.model, 'qwen/qwen3.8-27b');
    t.dispatch('settings/lang', 'nl');
    assert.equal(t.state().settings.lang, 'nl');
    t.dispatch('settings/lang', 'xx');
    assert.equal(t.state().settings.lang, 'en');
    t.dispatch('studio/shot', 'crane');
    assert.equal(t.state().studio.shot, 'crane');
    assert.equal(t.state().coach.marks.shot, 1);
    assert.match(t.html(), /Pop Shop[\s\S]*Subway Chalk[\s\S]*Neon Night/);
    assert.equal(ART.length, 3);
    assert.ok(BUDGETS.includes('auto'));
    t.os.destroy();
  });
});

describe('the pause menu', () => {
  it('holds the machine, the music and the council, and gives everything back', async () => {
    const t = studio();
    let holds = 0;
    const hold = t.os.council.hold.bind(t.os.council);
    t.os.council.hold = (on: boolean) => { holds += 1; hold(on); };
    assert.equal(t.state().machine.running, true);
    t.keys.press('Escape');
    assert.equal(t.state().studio.paused, true);
    assert.equal(t.state().machine.running, false);
    assert.match(t.html(), /class="os-pause"/);
    assert.ok(t.audio.calls.some((c) => c[0] === 'pause'));
    t.keys.press('p');
    assert.equal(t.state().studio.paused, false);
    assert.equal(t.state().machine.running, true, 'the machine runs again if it ran before');
    assert.ok(t.audio.calls.some((c) => c[0] === 'resume'));
    assert.equal(holds, 2);
    t.dispatch('os/pause');
    t.dispatch('os/options');
    assert.equal(t.state().os.app, 'settings');
    assert.equal(t.state().studio.paused, false);
    t.dispatch('os/stop');
    assert.equal(t.state().machine.running, false);
    assert.ok(t.audio.calls.some((c) => c[0] === 'stop'));
    t.keys.press('m');
    assert.equal(t.state().settings.audio.muted, true, 'M mutes anywhere');
    t.os.destroy();
  });

  it('lets the studio go when a game is quit from its pause menu', () => {
    const t = studio();
    t.dispatch('arcade/open', 'toy');
    t.dispatch('arcade/play');
    assert.equal(t.state().arcade.flow.current, 'playing');
    t.keys.press('Escape');
    assert.equal(t.state().studio.paused, true);
    assert.equal(t.state().arcade.flow.current, 'paused');
    assert.equal(t.state().machine.running, false);
    t.dispatch('arcade/close');
    assert.equal(t.state().studio.paused, false);
    assert.equal(t.state().machine.running, true, 'the machine runs again, as it did before the pause');
    assert.doesNotMatch(t.html(), /class="os-pause"/);
    assert.ok(t.audio.calls.some((c) => c[0] === 'resume'));
    t.os.destroy();
  });

  it('plays the desk once sound is allowed, and brings the music back with the machine and after a game', () => {
    const t = studio({ saved: { settings: { audio: { master: 0.3, music: 0.2, sfx: 0.6, muted: true } } } });
    assert.deepEqual(t.audio.calls[0], ['mix', { master: 0.3, music: 0.2, sfx: 0.6, muted: true }], 'the saved mix comes before the first note');
    const plays = () => t.audio.calls.filter((c) => c[0] === 'play').map((c) => c[1]);
    t.dispatch('studio/music', 'ensure');
    t.dispatch('studio/music', 'ensure');
    assert.deepEqual(plays(), ['desk'], 'ensure starts the music only when none plays');
    t.dispatch('os/stop');
    t.dispatch('machine/toggle');
    assert.equal(t.state().machine.running, true);
    assert.deepEqual(plays(), ['desk', 'desk']);
    t.dispatch('machine/run', false);
    t.dispatch('machine/run', true);
    assert.deepEqual(plays(), ['desk', 'desk'], 'a machine that starts under music leaves it playing');
    t.dispatch('arcade/open', 'toy');
    t.dispatch('arcade/play');
    assert.deepEqual(plays(), ['desk', 'desk', 'arena']);
    t.dispatch('arcade/close');
    assert.deepEqual(plays(), ['desk', 'desk', 'arena', 'desk'], 'leaving the arcade plays the desk again');
    t.os.destroy();
  });

  it('holds the verdict clock: the deadline moves by as long as it was held', async () => {
    const t = studio();
    t.dispatch('machine/run', false);
    t.dispatch('council/convene');
    await t.until(() => t.state().council.phase === 'veto', 'the verdict');
    const deadline = t.state().council.deadline;
    t.dispatch('os/pause');
    t.timers.advance(5000);
    t.dispatch('os/pause');
    assert.equal(t.state().council.deadline, deadline + 5000);
    t.os.council.hold(false);
    t.os.destroy();
  });
});

describe('mail', () => {
  it('files a letter to the oracle, which answers from the documentation', async () => {
    const t = studio();
    t.dispatch('os/app', 'mail');
    assert.equal(t.state().coach.marks.open_mail, 1);
    t.dispatch('mail/send');
    assert.equal(t.state().mail.threads.length, 0, 'nothing to send');
    const area = findNode(t.container, (n) => n.tagName === 'textarea');
    area.value = 'Where does the store keep documents?';
    fire(area, 'input');
    const subject = findNode(t.container, (n) => n.tagName === 'input' && n.getAttribute?.('placeholder') === 'Subject');
    subject.value = 'Storage';
    fire(subject, 'input');
    t.dispatch('mail/send');
    await t.until(() => (t.state().mail.threads[0]?.messages.length ?? 0) === 2, 'the oracle’s answer');
    const thread = t.state().mail.threads[0];
    assert.equal(t.state().mail.open, thread.id, 'a letter just sent stays in view');
    assert.equal(thread.subject, 'Storage');
    assert.match(thread.messages[1].text, /SQLite/);
    assert.equal(t.state().ui?.studio, undefined, 'the view model is not state');
    t.dispatch('mail/open', thread.id);
    await t.settle();
    assert.equal(t.state().mail.threads[0].unread, 0);
    assert.match(t.html(), /class="os-messages"/);
    const reply = findNode(t.container, (n) => n.tagName === 'textarea');
    reply.value = 'Thanks!';
    fire(reply, 'input');
    t.dispatch('mail/send');
    await t.until(() => t.state().mail.threads[0].messages.length === 4, 'the reply in the thread, and its answer');
    t.dispatch('mail/failed', { message: 'The post is closed.' });
    assert.deepEqual(t.state().os.notice, { tone: 'warn', text: 'The post is closed.' });
    t.dispatch('mail/folder', 'council');
    assert.equal(t.state().mail.open, null);
    t.dispatch('mail/close');
    const read = await t.os.system.client.invoke('mail.read', { thread: thread.id });
    assert.equal(read.value.messages.length, 4);
    assert.equal((await t.os.system.client.invoke('mail.read', { folder: 'inbox' })).value.threads.length, 1);
    assert.equal((await t.os.system.client.invoke('mail.read', { thread: 'none' })).error?.code, 'not-found');
    assert.equal((await t.os.system.client.invoke('mail.send', { by: 'oracle', thread: 'none', text: 'x' })).error?.code, 'not-found');
    t.os.destroy();
  });

  it('keeps the council’s words and verdicts in its threads', async () => {
    const t = studio();
    t.dispatch('machine/run', false);
    t.dispatch('os/app', 'council');
    const input = findNode(t.container, (n) => n.getAttribute?.('id') === 'os-say-input');
    input.value = 'more colour';
    fire(input, 'input');
    t.dispatch('council/say');
    await t.until(() => t.state().mail.threads.some((th: any) => th.folder === 'council'), 'the council thread');
    assert.equal(t.state().coach.marks.say, 1);
    t.dispatch('council/convene');
    await t.until(() => t.state().council.phase === 'veto', 'the verdict');
    await t.until(() => t.state().mail.threads.some((th: any) => th.messages.some((m: any) => /veto it, or let it pass/.test(m.text))), 'the verdict letter');
    t.os.destroy();
  });
});

describe('the board', () => {
  it('pins, ticks, colours, edits, connects and removes cards through the contract', async () => {
    const t = studio();
    t.dispatch('os/app', 'board');
    t.dispatch('board/add');
    assert.equal(t.state().board.cards.length, 0);
    const input = findNode(t.container, (n) => n.getAttribute?.('id') === 'os-board-input');
    input.value = 'Write the brief';
    fire(input, 'input');
    t.dispatch('board/kind', 'todo');
    t.dispatch('board/add');
    await t.settle();
    input.value = 'Ship it';
    fire(input, 'input');
    t.dispatch('board/add');
    await t.settle();
    const [a, b] = t.state().board.cards;
    assert.equal(a.kind, 'todo');
    t.dispatch('board/link-start', a.id);
    t.dispatch('board/link-to', { id: b.id, todo: true });
    await t.settle();
    assert.equal(t.state().board.links[0].kind, 'blocks');
    assert.match(t.html(), /waits/);
    t.dispatch('board/link-start', a.id);
    t.dispatch('board/link-to', { id: a.id, todo: true });
    assert.equal(t.state().board.linking, null, 'linking a card to itself just stops');
    t.dispatch('board/tick', { id: a.id, done: false });
    await t.settle();
    assert.equal(t.state().board.cards[0].done, true);
    t.dispatch('board/select', b.id);
    const edit = findNode(t.container, (n) => n.getAttribute?.('id') === 'os-board-edit');
    edit.value = 'Ship it today';
    fire(edit, 'change');
    await t.settle();
    assert.equal(t.state().board.cards[1].text, 'Ship it today');
    t.dispatch('board/color', { id: b.id, color: 3 });
    t.dispatch('board/move', { id: b.id, x: 600, y: 400 });
    await t.settle();
    assert.deepEqual([t.state().board.cards[1].color, t.state().board.cards[1].x], [3, 600]);
    t.dispatch('board/pin', { kind: 'doc', id: 'flow', label: 'Flow docs' });
    await t.settle();
    assert.equal(t.state().board.cards[2].ref.kind, 'doc');
    t.dispatch('board/remove', b.id);
    await t.settle();
    assert.equal(t.state().board.cards.length, 2);
    assert.equal(t.state().board.links.length, 0);
    const read = await t.os.system.client.invoke('board.read');
    assert.equal(read.value.cards.length, 2);
    for (const [op, input2, code] of [['board.edit', { by: 'oracle', id: 'nope' }, 'not-found'], ['board.link', { by: 'oracle', from: 'x', to: 'x' }, 'self'], ['board.remove', { by: 'oracle', id: 'nope' }, 'not-found']] as const) {
      assert.equal((await t.os.system.client.invoke(op, input2)).error?.code, code);
    }
    t.os.destroy();
  });
});

describe('the library', () => {
  it('opens, pages, reads aloud and answers', async () => {
    let spoken: any = null;
    const speech = {
      speak: (lines: string[], hooks: any) => { spoken = { lines, hooks }; },
      cancel: () => {},
    };
    const t = studio({ speech });
    t.dispatch('os/app', 'library');
    await t.until(() => t.state().library.status === 'ready', 'the library');
    assert.equal(t.state().library.docs.length, 2);
    t.dispatch('library/open', 'flow');
    await t.until(() => t.state().library.page !== null, 'the page');
    assert.equal(t.state().library.page.sections.length, 3);
    t.dispatch('library/listen');
    assert.deepEqual(spoken.lines.slice(0, 3), ['Flow', 'Machines are documents.', 'Transitions carry guards.']);
    spoken.hooks.sentence(1);
    assert.match(t.html(), /class="os-sentence is-spoken">Machines are documents\./);
    spoken.hooks.sentence(0);
    assert.match(t.html(), /<h4 class="is-spoken">Flow<\/h4>/);
    spoken.hooks.end();
    assert.equal(t.state().library.speaking, false);
    t.dispatch('library/listen');
    t.dispatch('library/listen');
    assert.equal(t.state().library.speaking, false, 'a second press stops');
    t.dispatch('library/more');
    await t.until(() => t.state().library.page.sections[0].index === 3, 'the next page');
    t.dispatch('library/more');
    t.dispatch('library/back');
    assert.equal(t.state().library.page, null);
    t.dispatch('library/open', 'nope');
    await t.until(() => /could not open/.test(t.state().studio.toast ?? ''), 'the refusal');
    const ask = findNode(t.container, (n) => n.getAttribute?.('id') === 'os-library-ask');
    ask.value = 'sqlite store';
    fire(ask, 'input');
    t.dispatch('library/ask');
    await t.until(() => t.state().library.answer?.pending !== true, 'the answer');
    assert.match(t.state().library.answer.text, /SQLite/);
    assert.ok(t.state().mail.threads.some((th: any) => th.folder === 'library' && th.messages.length === 2));
    assert.equal((await t.os.system.client.invoke('library.read', { doc: 'nope' })).error?.code, 'not-found');
    assert.equal((await t.os.system.client.invoke('library.search', { query: 'store' })).value.hits[0].doc, 'db');
    t.os.destroy();
  });

  it('says so where it cannot read aloud or open the library', async () => {
    const t = studio({ loadLibrary: async () => ({ not: 'a library' }) });
    t.dispatch('os/app', 'library');
    await t.until(() => t.state().library.status === 'unavailable', 'the refusal');
    assert.equal((await t.os.system.client.invoke('library.search', { query: 'x' })).error?.code, 'unavailable');
    assert.equal((await t.os.system.client.invoke('library.read', { doc: 'x' })).error?.code, 'unavailable');
    t.dispatch('library/page', { value: { doc: 'x', title: 'X', sections: [{ index: 0, heading: 'H', text: 'Words.', code: false }], next: null } });
    t.dispatch('library/listen');
    assert.equal(t.state().studio.toast, 'This browser cannot read aloud.');
    t.dispatch('library/ask');
    assert.equal(t.state().library.answer, null, 'nothing asked, nothing answered');
    t.os.destroy();
    const failing = studio({ loadLibrary: () => Promise.reject(new Error('offline')) });
    failing.dispatch('os/app', 'library');
    await failing.until(() => failing.state().library.status === 'unavailable', 'the failure');
    failing.os.destroy();
    const none = studio({ loadLibrary: null });
    none.dispatch('os/app', 'library');
    await none.until(() => none.state().library.status === 'unavailable', 'no loader');
    none.os.destroy();
  });
});

describe('the crew', () => {
  it('plays a whole project: ideas, the crew’s turn, review, the veto, the launch', async () => {
    const t = studio();
    t.dispatch('os/app', 'crew');
    const title = findNode(t.container, (n) => n.tagName === 'input' && n.getAttribute?.('placeholder') === 'A habit tracker');
    title.value = 'Water';
    fire(title, 'input');
    const players = findAll(t.container, (n) => n.tagName === 'input' && n.getAttribute?.('type') === 'text')[1];
    players.value = 'Ada, Bo';
    fire(players, 'input');
    const goal = findNode(t.container, (n) => n.tagName === 'input' && n.getAttribute?.('type') === 'range');
    goal.value = '2';
    fire(goal, 'input');
    t.dispatch('crew/start');
    await t.until(() => t.state().crew.project !== null, 'the project');
    const project = () => t.state().crew.project;
    assert.deepEqual(project().players.map((p: any) => p.name), ['Ada', 'Bo']);
    assert.equal(project().goal, 2);
    assert.equal(project().title, 'Water');
    const idea = () => findNode(t.container, (n) => n.getAttribute?.('id') === 'os-crew-idea');
    idea().value = 'a counter for glasses of water';
    fire(idea(), 'input');
    t.dispatch('crew/idea');
    await t.settle();
    t.dispatch('crew/idea');
    t.dispatch('crew/end');
    await t.settle();
    assert.equal(project().turn, 1, 'Bo’s turn');
    assert.match(t.html(), /Bo’s turn: add up to 2 ideas/);
    idea().value = 'call it "Water"';
    fire(idea(), 'input');
    t.dispatch('crew/idea');
    await t.settle();
    t.dispatch('crew/end');
    await t.until(() => project().phase === 'review', 'the crew’s builds');
    assert.equal(t.state().crew.busy, false);
    assert.equal(project().tasks.length, 2);
    assert.ok(t.state().mail.threads.some((th: any) => th.folder === 'crew' && th.messages.some((m: any) => m.tool?.name === 'crew.build')));
    assert.ok(t.state().studio.cheerSeq > 0, 'each builder hops for joy on the stage');
    assert.match(t.html(), /class="os-mini"/);
    const [k1, k2] = project().tasks;
    t.dispatch('crew/review', { task: k1.id, verdict: 'veto' });
    await t.settle();
    t.dispatch('crew/review', { task: k2.id, verdict: 'approve' });
    await t.until(() => project().phase === 'employer', 'round two');
    t.dispatch('crew/end');
    await t.settle();
    t.dispatch('crew/end');
    await t.until(() => project().phase === 'review', 'the retry');
    t.dispatch('crew/review', { task: project().tasks[2].id, verdict: 'approve' });
    await t.until(() => project().phase === 'shipped', 'the launch');
    assert.equal(t.state().crew.made.length, 1);
    assert.equal(t.state().crew.made[0].blocks.length, 2);
    assert.ok(t.state().mail.threads.length > 0);
    assert.ok(t.state().profile.xp >= 120);
    t.dispatch('crew/made-open', t.state().crew.made[0].id);
    assert.match(t.html(), /class="os-made-preview"/);
    t.dispatch('crew/made-close');
    t.dispatch('crew/new');
    assert.equal(project(), null);
    for (const [op, input] of [['crew.idea', { by: 'human', text: 'x' }], ['crew.end', { by: 'human' }], ['crew.build', { by: 'critic', idea: 'i1', block: { kind: 'note', text: 'x' } }], ['crew.say', { by: 'critic', text: 'x' }], ['crew.done', { by: 'critic' }], ['crew.review', { by: 'human', task: 'k', verdict: 'approve' }]] as const) {
      assert.equal((await t.os.system.client.invoke(op, input)).error?.code, 'no-project', op);
    }
    assert.equal((await t.os.system.client.invoke('crew.read')).value.catalog.length, 8);
    t.os.destroy();
  });

  it('reads the employers off the form: commas between names, four at most, You when none', async () => {
    const t = studio();
    t.dispatch('os/app', 'crew');
    const players = findAll(t.container, (n) => n.tagName === 'input' && n.getAttribute?.('type') === 'text')[1];
    players.value = ' Ada ,, Bo,Cy , Di, Eve ';
    fire(players, 'input');
    t.dispatch('crew/start');
    await t.until(() => t.state().crew.project !== null, 'the project');
    assert.deepEqual(t.state().crew.project.players.map((p: any) => p.name), ['Ada', 'Bo', 'Cy', 'Di']);
    assert.equal(t.state().crew.project.title, 'Our first app');
    t.dispatch('crew/new');
    players.value = ' , ';
    fire(players, 'input');
    t.dispatch('crew/start');
    await t.until(() => t.state().crew.project !== null, 'the second project');
    assert.deepEqual(t.state().crew.project.players.map((p: any) => p.name), ['You']);
    assert.match(t.html(), /Your turn: add up to 2 ideas/, 'and You is spoken to as you');
    const refused = studio();
    await refused.os.studio.effects['crew-start']({ players: 'A', goal: 99 }, (a: string, p: any) => refused.dispatch(a, p));
    assert.equal(refused.state().os.notice?.tone, 'warn', 'a refused start says so');
    refused.os.destroy();
    t.os.destroy();
  });

  it('takes a language model in the crew’s seats, and refuses moves out of turn', async () => {
    const turns: any[] = [];
    const t = studio({ crewTurn: async (p) => { turns.push(p.id); return true; } });
    const started = await t.os.system.client.invoke('crew.start', { by: 'human', title: 'T', players: ['A'] });
    assert.equal(started.ok, true);
    assert.equal((await t.os.system.client.invoke('crew.build', { by: 'critic', idea: 'i1', block: { kind: 'note', text: 'x' } })).error?.code, 'not-crew-turn');
    assert.equal((await t.os.system.client.invoke('crew.done', { by: 'critic' })).error?.code, 'not-crew-turn');
    assert.equal((await t.os.system.client.invoke('crew.review', { by: 'human', task: 'k', verdict: 'veto' })).error?.code, 'not-in-review');
    assert.equal((await t.os.system.client.invoke('crew.idea', { by: 'human', text: ' ' })).error?.code, 'empty');
    await t.os.system.client.invoke('crew.idea', { by: 'human', text: 'a note' });
    assert.equal((await t.os.system.client.invoke('crew.say', { by: 'oracle', idea: 'i1', text: 'On it' })).ok, true);
    await t.os.system.client.invoke('crew.end', { by: 'human' });
    await t.until(() => turns.length === 1 && t.state().crew.project.phase === 'employer', 'the model’s (empty) turn');
    assert.equal((await t.os.system.client.invoke('crew.end', { by: 'human' })).ok, true);
    t.os.destroy();
    const broken = studio({ crewTurn: async () => { throw new Error('model down'); }, onError: () => {} });
    await broken.os.system.client.invoke('crew.start', { by: 'human', title: 'T', players: ['A'] });
    await broken.os.system.client.invoke('crew.end', { by: 'human' });
    await broken.until(() => broken.state().crew.busy === false && broken.state().crew.project.phase !== 'crew', 'the failure');
    broken.os.destroy();
    // a seat with no model sits the turn out, and the scripted crew plays it
    const idle = studio({ crewTurn: async () => false });
    await idle.os.system.client.invoke('crew.start', { by: 'human', title: 'T', players: ['A'] });
    await idle.os.system.client.invoke('crew.idea', { by: 'human', text: 'a counter for laps' });
    await idle.os.system.client.invoke('crew.end', { by: 'human' });
    await idle.until(() => idle.state().crew.project.phase === 'review', 'the scripted crew’s build');
    assert.equal(idle.state().crew.project.tasks[0].block.kind, 'counter');
    idle.os.destroy();
    assert.ok(CREW_BEAT_MS > 0);
  });
});

describe('the arcade', () => {
  it('opens a game, plays it through its lifecycle document, and reports to the OS', async () => {
    const t = studio();
    t.dispatch('os/app', 'arcade');
    assert.match(t.html(), /data-game="toy"/);
    t.dispatch('arcade/open', 'toy');
    assert.match(t.html(), /class="os-arcade"/);
    assert.match(t.html(), /Two players, taking turns/);
    t.dispatch('arcade/players', 2);
    assert.equal(t.state().arcade.players, 2);
    t.dispatch('arcade/play');
    assert.equal(t.state().arcade.flow.current, 'playing');
    assert.equal(t.state().coach.marks.play_toy, 1);
    await t.until(() => t.state().arcade.hud?.title === 'Toy', 'the HUD');
    assert.match(t.html(), /class="os-hud"/);
    t.keys.press('v');
    assert.equal(t.state().council.log.length, 0, 'the council’s keys are the game’s while it plays');
    t.keys.press('Escape');
    assert.equal(t.state().arcade.flow.current, 'paused');
    assert.match(t.html(), /aria-label="Paused"/);
    t.keys.press('Escape');
    assert.equal(t.state().arcade.flow.current, 'playing');
    t.dispatch('arcade/pause');
    t.dispatch('arcade/resume');
    t.dispatch('arcade/act', { type: 'win' });
    await t.until(() => t.state().arcade.outcome !== null, 'the outcome');
    assert.equal(t.state().arcade.flow.current, 'over');
    assert.deepEqual(t.state().arcade.saves.toy, { best: 3 });
    assert.equal(t.state().coach.marks.win_toy, 1);
    assert.deepEqual(t.budgets, ['small'], 'the measured budget is applied');
    t.dispatch('arcade/play');
    assert.equal(t.state().arcade.flow.current, 'playing', 'play again');
    const read = await t.os.system.client.invoke('arcade.read');
    assert.equal(read.value.game, 'toy');
    assert.deepEqual(read.value.tools.map((x: any) => x.name), ['toy_read', 'toy_quiet']);
    assert.deepEqual((await t.os.system.client.invoke('arcade.tool', { by: 'oracle', name: 'toy_read', input: { n: 2 } })).value.result, { x: 0 });
    assert.equal((await t.os.system.client.invoke('arcade.tool', { by: 'oracle', name: 'toy_read', input: { n: 'two' } })).error?.code, 'invalid');
    assert.equal((await t.os.system.client.invoke('arcade.tool', { by: 'oracle', name: 'nope' })).error?.code, 'not-found');
    t.dispatch('arcade/stop');
    t.dispatch('arcade/close');
    assert.equal(t.state().arcade.game, null);
    assert.ok(t.audio.calls.some((c) => c[0] === 'play' && c[1] === 'arena'));
    t.os.destroy();
  });

  it('turns game events into mail, ratings, experience and settings', async () => {
    const t = studio();
    t.dispatch('arcade/open', 'toy');
    t.dispatch('arcade/event', { kind: 'say', who: 'Mimi', text: 'Well done' });
    assert.equal(t.state().studio.toast, 'Mimi: Well done', 'captions show what is said');
    assert.ok(t.state().mail.threads.some((th: any) => th.id === 'arcade-toy'));
    t.dispatch('arcade/event', { kind: 'rate', skill: 'add', correct: true, difficulty: 500 });
    assert.ok(t.state().profile.skills['toy:add']);
    t.dispatch('arcade/event', { kind: 'xp', amount: 70 });
    assert.equal(t.state().studio.toast, 'You climbed a rank!');
    t.dispatch('arcade/event', { kind: 'setting', key: 'ai.toolBudget', value: 'tiny' });
    assert.equal(t.state().settings.ai.budget, 'tiny');
    t.dispatch('arcade/event', { kind: 'setting', key: 'other', value: 1 });
    t.dispatch('arcade/save', { game: 'toy', save: { best: 1 } });
    t.os.destroy();
    const plain = studio();
    plain.dispatch('arcade/event', { kind: 'rate', skill: 'x', correct: false, difficulty: 600 });
    assert.ok(plain.state().profile.skills['arcade:x'], 'with no game open, the arcade itself');
    plain.os.destroy();
  });

  it('runs a game in its widget: frames, controls, taps, effects, ragdolls, its moves', () => {
    const { win, document, host } = windowHost();
    const emitted: any[] = [];
    const audio = recordingAudio();
    const arcade = createArcade({ games: { toy: toy as any }, audio: audio as any });
    assert.deepEqual(arcade.read(), { game: null, phase: 'title', hud: null, tools: [] });
    assert.deepEqual(arcade.tool('toy_read', {}), { ok: false, error: 'no-game' });
    const props: any = { game: 'toy', phase: 'title', seed: 1, save: null, players: 1, act: { seq: 0, action: null }, theme: 'light', reduce: false, ragdoll: true, light: { hour: 10, bands: 3, shadows: true }, lang: 'en' };
    const handle = arcade.widget.mount(host, props, (b: any) => emitted.push(b), { document });
    assert.equal(arcade.read().game, 'toy');
    assert.ok(emitted.some((b) => b.action === 'arcade/hud'));
    win.time = 1100;
    win.flush();
    const playing = { ...props, phase: 'playing' };
    arcade.widget.update(handle, playing, props);
    win.fire('keydown', { key: 'ArrowRight', target: { tagName: 'BODY' }, preventDefault() {} });
    win.fire('keydown', { key: ' ', target: { tagName: 'BODY' }, preventDefault() {} });
    win.fire('keydown', { key: 'Escape', target: { tagName: 'BODY' }, preventDefault() {} });
    fire(host, 'pointerdown', { clientX: 400, clientY: 300 });
    for (let i = 0; i < 6; i++) { win.time += TICK_MS; win.flush(); }
    const framed = handle.director.camera.target?.slice();
    win.fire('keyup', { key: ' ', target: { tagName: 'BODY' }, preventDefault() {} });
    win.fire('keydown', { key: 'e', target: { tagName: 'BODY' }, preventDefault() {} });
    for (let i = 0; i < 4; i++) { win.time += TICK_MS; win.flush(); }
    assert.notDeepEqual(handle.director.camera.target, framed, 'the camera follows what the game points it at');
    assert.ok(audio.calls.some((c) => c[0] === 'sfx' && c[1] === 'pop'));
    assert.ok(emitted.some((b) => b.action === 'arcade/event' && b.with.kind === 'say'));
    assert.ok(handle.bodies.has('hero'), 'the figure the game named has a ragdoll');
    const moved = arcade.read().hud;
    assert.ok(Number(moved?.score) > 0);
    const reading = arcade.tool('toy_read', {});
    assert.equal(reading.ok, true);
    assert.equal(typeof arcade.read().game, 'string');
    assert.ok(reading.ok && reading.result.x > 0, 'the hero walked right while the key was held');
    assert.deepEqual(arcade.tool('toy_quiet', {}), { ok: true, result: 'ok' });
    assert.deepEqual(arcade.tool('nope', {}), { ok: false, error: 'not-found' });
    assert.equal(arcade.tool('toy_read', { n: 'x' }).ok, false);
    arcade.widget.update(handle, { ...playing, act: { seq: 1, action: { type: 'win' } }, light: { hour: 22, bands: 2, shadows: false }, label: 'Toy!' }, playing);
    assert.ok(emitted.some((b) => b.action === 'arcade/over'));
    assert.equal(host.getAttribute('aria-label'), 'Toy!');
    arcade.widget.update(handle, { ...playing, seed: 2, act: { seq: 1, action: { type: 'win' } } }, { ...playing, act: { seq: 1, action: { type: 'win' } } });
    assert.equal(arcade.read().hud?.toast, null, 'a new seed is a new run');
    arcade.widget.update(handle, { ...playing, seed: 2, phase: 'paused', reduce: true, act: { seq: 1, action: null } }, { ...playing, seed: 2, act: { seq: 1, action: { type: 'win' } } });
    win.time += 100;
    win.flush();
    arcade.widget.unmount(handle);
    assert.equal(arcade.tool('toy_read', {}).ok, true, 'the game outlives its widget');
    const still = renderToString(arcade.widget.ssr({ ...props, label: 'Still' }) as any);
    assert.match(still, /^<svg[^>]*aria-label="Still"/);
    assert.match(renderToString(arcade.widget.ssr({ ...props, game: 'none' }) as any), /No game/);
    const again = arcade.widget.mount(host, { ...props, phase: 'over' }, () => {}, { document });
    arcade.widget.unmount(again);
    // a widget with no frame loop still draws on request
    const noRaf = windowHost({ raf: false });
    const quiet = createArcade({ games: { toy: toy as any } });
    const h2 = quiet.widget.mount(noRaf.host, { ...props, game: 'missing' }, () => {}, { document: noRaf.document });
    quiet.widget.update(h2, { ...props, game: 'missing', phase: 'playing', act: { seq: 1, action: { type: 'win' } } }, { ...props, game: 'missing' });
    quiet.widget.unmount(h2);
    const h3 = quiet.widget.mount(noRaf.host, { ...props, phase: 'playing' }, () => {}, { document: noRaf.document });
    quiet.tool('toy_read', {});
    h3.loop.tick(0);
    h3.loop.tick(40);
    quiet.widget.unmount(h3);
    assert.deepEqual(IDLE_INPUT.pressed, []);
  });

  it('runs a game’s own work between frames, starts each run clean and never lets a model’s move rate the person', () => {
    const { win, document, host } = windowHost();
    let made = 0;
    const asked: any[] = [];
    const worker = {
      ...toy, id: 'worker',
      tools: [{ name: 'worker_solve', description: 'a model solves it', inputSchema: { type: 'object' },
        run: (s: any) => ({ state: s, result: 'solved', events: [{ kind: 'rate', skill: 'add', correct: true, difficulty: 500 }, { kind: 'xp', amount: 9, reason: 'model' }, { kind: 'say', who: 'Bot', text: 'Done' }] }) }],
      work: (env: { now: () => number }) => {
        made += 1;
        return {
          frame: (s: any, budget: number) => { asked.push([typeof env.now(), budget]); return s.won ? null : { type: 'win' }; },
          dispose: () => { made -= 1; },
        };
      },
    };
    const emitted: any[] = [];
    const arcade = createArcade({ games: { worker: worker as any } });
    const props: any = { game: 'worker', phase: 'title', seed: 1, save: null, players: 1, act: { seq: 0, action: null }, theme: 'neon', reduce: false, ragdoll: true, light: { hour: 10, bands: 3, shadows: true }, lang: 'en' };
    const handle = arcade.widget.mount(host, props, (b: any) => emitted.push(b), { document });
    assert.equal(made, 0, 'no work before the game is played');
    const playing = { ...props, phase: 'playing' };
    arcade.widget.update(handle, playing, props);
    assert.equal(made, 1);
    assert.deepEqual(asked[0], ['number', WORK_MS]);
    assert.ok(emitted.some((b) => b.action === 'arcade/over'), 'what the work answers is acted like any move');
    win.time += TICK_MS;
    win.flush();
    assert.equal(made, 1, 'made once, kept for the widget');
    win.fire('keydown', { key: ' ', target: { tagName: 'BODY' }, preventDefault() {} });
    assert.deepEqual(handle.pressed, ['act']);
    arcade.widget.update(handle, { ...playing, seed: 2 }, playing);
    assert.deepEqual(handle.pressed, [], 'a press on the last result card is not the next run’s first move');
    assert.equal(handle.time, 0);
    emitted.length = 0;
    assert.deepEqual(arcade.tool('worker_solve', {}), { ok: true, result: 'solved' });
    assert.deepEqual(emitted.filter((b) => b.action === 'arcade/event').map((b) => b.with.kind), ['say'], 'a tool’s rate and xp are dropped');
    arcade.widget.unmount(handle);
    assert.equal(made, 0, 'the work goes with its widget');
  });

  it('starts a game on the wall clock’s date', () => {
    const { document, host } = windowHost();
    const born: any[] = [];
    const dated = { ...toy, id: 'dated', create: (init: any) => { born.push(init.options.now); return toy.create(init); } };
    const arcade = createArcade({ games: { dated: dated as any }, now: () => 1_760_000_000_000 });
    const props: any = { game: 'dated', phase: 'title', seed: 1, save: null, players: 1, act: { seq: 0, action: null }, theme: 'light', reduce: true, ragdoll: false, light: { hour: 10, bands: 3, shadows: true }, lang: 'nl' };
    arcade.widget.unmount(arcade.widget.mount(host, props, () => {}, { document }));
    assert.deepEqual(born, [1_760_000_000_000]);
  });

  it('lets a model move the camera and the sun through the contract', async () => {
    const t = studio();
    const shot = await t.os.system.client.invoke('studio.camera', { by: 'oracle', shot: 'crane' });
    assert.equal(shot.ok, true);
    assert.equal(t.state().studio.shot, 'crane');
    const light = await t.os.system.client.invoke('studio.light', { by: 'oracle', hour: 20.5 });
    assert.equal(light.ok, true);
    assert.equal(t.state().settings.light.hour, 20.5);
    t.os.destroy();
  });

  it('rates a hinted success for less on the person’s ladder', () => {
    const t = studio();
    t.dispatch('arcade/open', 'toy');
    t.dispatch('arcade/event', { kind: 'rate', skill: 'add', correct: true, difficulty: 600, hinted: true });
    t.dispatch('arcade/event', { kind: 'rate', skill: 'sub', correct: true, difficulty: 600 });
    const skills = t.state().profile.skills;
    assert.ok(Math.abs(skills['toy:add'].r - (600 + 32 * (0.7 - expected(600, 600)))) < 1e-9);
    assert.ok(Math.abs(skills['toy:sub'].r - (600 + 32 * (1 - expected(600, 600)))) < 1e-9);
    t.os.destroy();
  });

  it('shelves the three games, each a whole game module', () => {
    assert.deepEqual(Object.keys(GAMES), ['grove', 'dancers', 'arena']);
    for (const [id, game] of Object.entries(GAMES)) {
      assert.equal(game.id, id);
      for (const fn of ['create', 'step', 'act', 'draw', 'hud', 'over', 'save']) assert.equal(typeof (game as any)[fn], 'function', `${id}.${fn}`);
      const state = game.create({ seed: 1, save: null, players: [{ id: 'p1', name: 'P1', color: '#f97316' }], options: { lang: 'en', now: 1 } });
      assert.equal(typeof game.hud(state).title, 'string', `${id} has a HUD`);
      assert.equal(game.over(state), null, `${id} starts unfinished`);
      assert.deepEqual(JSON.parse(JSON.stringify(game.save(state))), game.save(state), `${id} saves plain JSON`);
    }
    assert.equal(GAMES.grove.duel, true);
  });

  it('plays a game headlessly from a script', () => {
    const start = toy.create({ seed: 1, save: null, players: [{}], options: {} });
    const out = play(toy as any, start, [{ held: { right: true } } as any, ...idle(2), { pressed: ['act'] }, { act: { type: 'win' } }]);
    assert.equal(out.state.won, true);
    assert.ok(out.events.some((e) => e.kind === 'setting'));
    assert.equal(out.state.ticks, 4);
    assert.equal(out.time, 4 * TICK_MS);
    assert.equal(play(toy as any, out.state, idle(1), { from: out.time }).time, 5 * TICK_MS, 'a second script continues the clock');
    assert.deepEqual(idle(-1), []);
  });
});

describe('the coach', () => {
  it('moves on when the player does what a step asks, and lights what it points at', async () => {
    const t = studio();
    assert.match(t.html(), /class="os-coach is-open"/);
    assert.match(t.html(), /Open the Machine app/);
    t.dispatch('studio/spotlight', 'dock-machine');
    assert.match(t.html(), /class="os-dock-btn is-spotlit" data-coach="dock-machine"/);
    t.timers.advance(5000);
    assert.equal(t.state().studio.spotlight, null, 'the spotlight fades');
    t.dispatch('os/app', 'machine');
    await t.settle();
    t.timers.advance(10);
    await t.settle();
    assert.equal(t.state().coach.step, 1);
    assert.match(t.state().studio.toast ?? '', /rule cell/);
    t.timers.advance(4000);
    assert.equal(t.state().studio.toast, null, 'the toast fades');
    t.dispatch('coach/mark', 'draft');
    t.dispatch('coach/mark', 'propose');
    await t.settle();
    t.timers.advance(10);
    await t.settle();
    assert.deepEqual(t.state().coach.done, ['first-dance']);
    assert.ok(t.audio.calls.some((c) => c[1] === 'levelup'));
    t.dispatch('coach/toggle');
    assert.match(t.html(), /aria-label="Open the coach"/);
    t.dispatch('studio/toast', 'Hello');
    t.dispatch('studio/burst', 'confetti');
    t.dispatch('profile/set', { xp: 5, skills: {}, badges: [] });
    t.dispatch('crew/idle');
    t.dispatch('council/deadline', 5);
    t.os.destroy();
  });
});

describe('the studio’s state', () => {
  it('restores what passes its checks and leaves the rest', () => {
    const fresh = studioState();
    assert.equal(restoreStudio(fresh, null), fresh);
    const restored = restoreStudio(fresh, {
      settings: { art: 'neon', audio: { master: 2, music: 0.3, sfx: 'loud', muted: true }, camera: { orbit: false }, light: { hour: 30, bands: 2, shadows: false }, motion: { ragdoll: false }, ai: { budget: 'small', model: 'm'.repeat(200) }, lang: 'nl', captions: false },
      mail: { threads: 'bad' },
      board: { cards: [], links: [], seq: 3 },
      crew: { project: { nope: true }, made: [{ id: 'm', title: 'M', stars: 2, blocks: [{ kind: 'note', text: 'x' }] }, { id: 'bad', blocks: [{ kind: 'video' }] }] },
      arcade: { saves: { toy: { best: 1 } } },
      coach: { quest: null, step: 0, done: [], marks: {}, open: false },
      profile: { xp: 9, skills: {}, badges: [] },
    });
    assert.equal(restored.settings.art, 'pop', 'the art direction is the boot theme’s, never a stale saved copy');
    assert.equal(restoreStudio(studioState('neon'), { settings: { art: 'chalk' } }).settings.art, 'neon');
    assert.equal(restored.settings.audio.master, fresh.settings.audio.master, 'out of range keeps the default');
    assert.equal(restored.settings.audio.music, 0.3);
    assert.equal(restored.settings.light.hour, fresh.settings.light.hour);
    assert.equal(restored.settings.ai.model.length, 120);
    assert.equal(restored.mail, fresh.mail);
    assert.equal(restored.board.seq, 3);
    assert.equal(restored.crew.project, null);
    assert.deepEqual(restored.crew.made.map((m: any) => m.id), ['m']);
    assert.deepEqual(restored.arcade.saves, { toy: { best: 1 } });
    assert.equal(restored.coach.open, false);
    assert.equal(restored.profile.xp, 9);
    const thin = restoreStudio(fresh, { settings: 'x', crew: {}, arcade: {} });
    assert.equal(thin.settings, fresh.settings);
    assert.deepEqual(thin.crew.made, []);
    assert.deepEqual(Object.keys(studioSlice({ ...fresh })), ['settings', 'mail', 'board', 'crew', 'arcade', 'coach', 'profile']);
    const odd = restoreStudio(fresh, { settings: { ai: { budget: 'galactic' }, lang: 'fr' } });
    assert.equal(odd.settings.ai.budget, 'auto');
    assert.equal(odd.settings.lang, 'en');
  });
});

describe('the studio’s widgets', () => {
  const cards: any[] = [
    { id: 'c1', kind: 'todo', text: 'A rather long first card that needs wrapping over several lines to fit', done: false, x: 0, y: 0, fill: '#2563eb', blocked: false, todo: true, label: '' },
    { id: 'c2', kind: 'note', text: 'Second', done: true, x: 400, y: 0, fill: '#fbbf24', blocked: true, todo: false, label: 'Flow docs' },
  ];
  const links = [{ id: 'l1', from: 'c1', to: 'c2', kind: 'blocks' as const, x1: 100, y1: 58, x2: 500, y2: 58 }];

  it('frames the wall around its cards, never smaller than a readable stretch and never past its edges', () => {
    const wall = { links: [], width: 1600, height: 1000, selected: null, theme: 'light' };
    const card = (x: number, y: number) => ({ id: `c${x}-${y}`, kind: 'note', text: 'x', done: false, x, y, fill: '#2563eb', blocked: false, todo: false, label: '' });
    assert.deepEqual(wallFrame({ ...wall, cards: [] } as any), { x: 0, y: 0, w: 720, h: 450 });
    const one = wallFrame({ ...wall, cards: [card(700, 400)] } as any);
    assert.deepEqual([one.w, one.h], [720, 450], 'one card is not drawn poster-sized');
    assert.ok(one.x <= 700 && one.x + one.w >= 700 + CARD.w && one.y <= 400 && one.y + one.h >= 400 + CARD.h, 'and is in the frame');
    const corner = wallFrame({ ...wall, cards: [card(1380, 860)] } as any);
    assert.deepEqual([corner.x + corner.w, corner.y + corner.h], [1600, 1000], 'slid back inside the wall');
    const spread = wallFrame({ ...wall, cards: [card(0, 0), card(1400, 880)] } as any);
    assert.deepEqual(spread, { x: 0, y: 0, w: 1600, h: 1000 }, 'a full wall shows all of it');
  });

  it('draws the board and reports drags, links, ticks and taps', () => {
    assert.deepEqual(wrapText('one two three four five six', 9, 2), ['one two', 'three…']);
    assert.deepEqual(wrapText('short', 20, 3), ['short']);
    assert.match(squiggle(links[0]), /^M100 58Q\d+ -?\d+ 500 58$/);
    assert.equal(hitWall(cards, 200, 58)?.part, 'port');
    assert.equal(hitWall(cards, 20, 20)?.part, 'box');
    assert.equal(hitWall(cards, 100, 90)?.part, 'body');
    assert.equal(hitWall(cards, 450, 90)?.part, 'body', 'a note has no box');
    assert.equal(hitWall(cards, 1500, 900), null);
    const html = renderToString(boardWidget.ssr({ cards, links: [...links, { ...links[0], id: 'l2', kind: 'relates' }], width: 1600, height: 1000, selected: 'c1', theme: 'light' }) as any);
    assert.match(html, /marker-end="url\(#os-wall-arrow\)"/);
    assert.match(html, /is-selected/);
    assert.match(html, /↗ Flow docs/);
    assert.match(html, /waits/);
    const { document, host } = windowHost();
    const emitted: any[] = [];
    const props: any = { cards, links, width: 1600, height: 1000, selected: null, theme: 'light', label: 'Board' };
    // the wall shows the frame around its cards; a host exactly that size maps the pointer one to one
    const frame = wallFrame(props);
    assert.match(html, new RegExp(`viewBox="${frame.x} ${frame.y} ${frame.w} ${frame.h}"`));
    host.getBoundingClientRect = () => ({ left: frame.x, top: frame.y, width: frame.w, height: frame.h });
    const handle = boardWidget.mount(host, props, (b: any) => emitted.push(b), { document });
    const at = (type: string, x: number, y: number) => fire(host, type, { clientX: x, clientY: y, pointerId: 1 });
    at('pointerdown', 100, 90);
    at('pointermove', 102, 91);
    at('pointermove', 300, 300);
    assert.match(renderToString(wallVnode(handle.props, handle.local) as any), /translate\(200 210\)/, 'the card follows the hand');
    at('pointerup', 300, 300);
    assert.deepEqual(emitted.at(-1), { action: 'board/move', with: { id: 'c1', x: 200, y: 210 } });
    at('pointerdown', 200, 58);
    at('pointermove', 450, 60);
    at('pointerup', 450, 60);
    assert.deepEqual(emitted.slice(-2).map((b) => b.action), ['board/link-start', 'board/link-to']);
    assert.deepEqual(emitted.at(-1).with, { id: 'c2', todo: false });
    at('pointerdown', 200, 58);
    at('pointermove', 900, 900);
    at('pointerup', 900, 900);
    assert.equal(emitted.at(-1).action, 'board/link-to', 'a link dropped on nothing makes none');
    at('pointerdown', 20, 20);
    at('pointerup', 20, 20);
    assert.deepEqual(emitted.at(-1), { action: 'board/tick', with: { id: 'c1', done: false } });
    at('pointerdown', 450, 90);
    at('pointerup', 450, 90);
    assert.deepEqual(emitted.at(-1), { action: 'board/select', with: 'c2' });
    at('pointerdown', 1500, 900);
    assert.deepEqual(emitted.at(-1), { action: 'board/select', with: null });
    at('pointermove', 10, 10);
    at('pointerup', 10, 10);
    boardWidget.update(handle, { ...props, cards: [cards[1]], links: [] });
    boardWidget.unmount(handle);
    const bare = windowHost();
    delete bare.host.getBoundingClientRect;
    const h2 = boardWidget.mount(bare.host, props, () => {}, { document: bare.document });
    fire(bare.host, 'pointerdown', { clientX: 1, clientY: 1 });
    boardWidget.unmount(h2);
    assert.equal(CARD.w, 200);
  });

  it('mounts an app the crew built, remounts it when it grows, renders it on the server', () => {
    const { document, host } = windowHost();
    const one = buildApp([{ kind: 'counter', label: 'cups' }]);
    const handle = miniWidget.mount(host, { app: one }, () => {}, { document });
    assert.match(JSON.stringify(host.childNodes.length), /\d/);
    miniWidget.update(handle, { app: one });
    const two = buildApp([{ kind: 'counter', label: 'cups' }, { kind: 'note', text: 'more' }]);
    miniWidget.update(handle, { app: two });
    assert.equal(handle.current, two);
    miniWidget.unmount(handle);
    assert.match(renderToString(miniWidget.ssr({ app: two }) as any), /<section class="mini"/);
    // a block that misbehaves stays inside its app
    const broken = buildApp([{ kind: 'counter', label: 'cups' }]);
    const boom = { ...broken, actions: { ...broken.actions, 'b0/up': { effects: [{ run: 'nowhere' }] } } };
    const held = miniWidget.mount(host, { app: boom }, () => {}, { document });
    const more = findNode(host, (n) => n.getAttribute?.('aria-label') === 'More cups');
    assert.doesNotThrow(() => fire(more, 'click'));
    assert.ok(findNode(host, (n) => n.getAttribute?.('aria-label') === 'More cups'), 'and the app is still there');
    miniWidget.unmount(held);
  });
});
