/**
 * The studio's side of the OS host: the effects its action documents
 * name (sound and music, the pause hold, reading aloud, asking the docs,
 * the crew's turn, experience, what the games report), the subscriptions
 * that keep time for it (the coach watching its signals, the toast and
 * the spotlight fading), its widgets (the board, a built app, the
 * arcade) and the hooks the contract's studio handlers read (the
 * library, the arcade, the oracle's reply to a letter).
 *
 * Nothing here needs a browser either: sound, speech and the library are
 * handed in by the bootstrap and simply absent in a test, where every
 * effect still runs and says what it would have done.
 */

import { post } from '../kernel/studio.ts';
import type { StudioHost } from '../kernel/studio.ts';
import { createLibraryIndex, answerFromDocs, speechOf, isLibrary } from '../kernel/library.ts';
import type { Library, LibraryIndex, Hit } from '../kernel/library.ts';
import { scriptedCrew } from '../kernel/crew.ts';
import type { Project } from '../kernel/crew.ts';
import { advanceCoach, COACH_SIGNALS } from '../kernel/coach.ts';
import { award, rate } from '../kernel/ladder.ts';
import { tapeMelody } from '../engine/audio.ts';
import type { createAudio } from '../engine/audio.ts';
import { createArcade } from '../games/arcade.ts';
import type { GameModule } from '../games/game.ts';
import { boardWidget } from '../stage/board-widget.ts';
import { miniWidget } from '../stage/mini-widget.ts';

export type Speech = { speak: (lines: string[], hooks: { sentence: (i: number) => void, end: () => void }) => void, cancel: () => void };
export type StudioHostOptions = {
  getState: () => any, dispatch: (action: string, payload?: any) => void,
  timers: { setTimeout: (fn: () => void, ms: number) => any, clearTimeout: (id: any) => void },
  now: () => number,
  council: { hold: (on: boolean) => void },
  invoke: (op: string, input?: any) => Promise<any>,
  games?: Record<string, GameModule>,
  audio?: ReturnType<typeof createAudio> | null,
  speech?: Speech | null,
  loadLibrary?: (() => Promise<Library | null>) | null,
  askDocs?: ((question: string, hits: Hit[]) => Promise<{ text: string, citations: any[] }>) | null,
  crewTurn?: ((project: Project) => Promise<boolean>) | null,
  onBudget?: (tier: string) => void,
  report: (error: any) => void,
};
type Send = (action: string, payload?: any) => void;

/** Which ladder area each game reports into. */
const AREAS: Record<string, string> = { grove: 'math', dancers: 'turing', arena: 'ai' };

/** The pause between two of the scripted crew's moves, ms — long enough to watch. */
export const CREW_BEAT_MS = 650;

/** Build the studio's host. */
export function createStudioHost(o: StudioHostOptions) {
  const games = o.games ?? {};
  const audio = o.audio ?? null;
  const arcade = createArcade({ games, audio, now: o.now });
  let library: { library: Library, index: LibraryIndex } | null = null;
  let loading: Promise<boolean> | null = null;
  let questions = 0;
  // the post office is all `post` touches; the rest of the host is the studio's own hooks
  const hostOf = (): StudioHost => ({ getState: o.getState, dispatch: o.dispatch, now: o.now, library: () => library, arcade: () => arcade });

  /** Open the library once; answer whether it is there. */
  function ensureLibrary(): Promise<boolean> {
    if (library) return Promise.resolve(true);
    if (!loading) {
      loading = (o.loadLibrary ? o.loadLibrary() : Promise.resolve(null)).then((lib) => {
        if (!isLibrary(lib)) return false;
        library = { library: lib, index: createLibraryIndex(lib) };
        return true;
      }, () => false).finally(() => { loading = null; });
    }
    return loading;
  }

  async function answer(question: string) {
    const ready = await ensureLibrary();
    const hits = ready && library ? library.index.search(question, 5) : [];
    const reply = o.askDocs ? await o.askDocs(question, hits) : answerFromDocs(question, hits);
    return { reply, hits };
  }

  /** The tape as the desk track's melody: the row under the painter. */
  const deskMelody = () => {
    const s = o.getState();
    const lead = s.world.heads[0];
    return tapeMelody(s.world.tape, s.world.width, lead ? lead.y : 0);
  };

  const effects = {
    sound(name: string) {
      audio?.sfx(name);
    },
    /** The open game's track, or the desk's (`desk` insists on the desk);
     * `ensure` starts one only when nothing is playing. */
    music(mode: 'play' | 'desk' | 'ensure' | 'pause' | 'resume' | 'stop') {
      if (!audio) return;
      if (mode === 'pause') audio.pause();
      else if (mode === 'resume') audio.resume();
      else if (mode === 'stop') audio.stop();
      else if (mode !== 'ensure' || !audio.track) {
        const s = o.getState();
        const game = mode !== 'desk' && s.arcade.game ? games[s.arcade.game] : null;
        if (game) audio.play(game.track);
        else audio.play('desk', { melody: deskMelody, bpm: 84 + s.program.tempo * 3 });
      }
    },
    mix() {
      const a = o.getState().settings.audio;
      audio?.setMix({ master: a.master, music: a.music, sfx: a.sfx, muted: a.muted });
    },
    hold(on: boolean) {
      o.council.hold(on);
      if (on) audio?.pause();
      else audio?.resume();
    },
    budget(tier: string) {
      o.onBudget?.(tier);
    },
    /** A game's lifecycle asked for a reset; the arcade starts the run from the new seed. */
    game() {},
    async 'library-load'(_props: unknown, send: Send) {
      if (await ensureLibrary() && library) {
        send('library/ready', library.library.docs.map((d) => ({ id: d.id, title: d.title, sections: d.sections.length })));
      }
      else send('library/unavailable');
    },
    /** Read a page aloud, or (null) stop. */
    speak(sections: any, send: Send) {
      o.speech?.cancel();
      if (!Array.isArray(sections)) return;
      if (!o.speech) {
        send('library/spoken');
        send('studio/toast', 'This browser cannot read aloud.');
        return;
      }
      o.speech.speak(speechOf(sections), { sentence: (i) => send('library/sentence', i), end: () => send('library/spoken') });
    },
    async ask(question: string, send: Send) {
      const { reply, hits } = await answer(question);
      send('library/answered', { answer: reply, hits });
      questions += 1;
      const thread = `library-${o.now().toString(36)}-${questions}`;
      post(hostOf(), { thread, subject: `Asked the docs: ${question}`, folder: 'library', from: 'human', to: ['oracle'], text: question, at: o.now() });
      post(hostOf(), { thread, folder: 'library', from: 'oracle', to: ['human'], text: reply.text, at: o.now() });
    },
    /** A project from the setup form: the title, the employers' names split
     * at their commas (four at most, "You" when none), the goal. */
    async 'crew-start'(setup: { title?: string, players?: string, goal?: number }, send: Send) {
      const names = String(setup.players ?? '').split(',').map((n) => n.replace(/\s+/g, ' ').trim().slice(0, 24)).filter((n) => n.length > 0).slice(0, 4);
      const title = String(setup.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
      const outcome = await o.invoke('crew.start', { by: 'human', title: title || 'Our first app', players: names.length > 0 ? names : ['You'], goal: setup.goal ?? 4 });
      if (!outcome.ok) send('os/notice', { tone: 'warn', text: outcome.error?.message ?? 'The project could not start.' });
    },
    /** The crew's turn through the contract: the language model's when a
     * seat plays it (`crewTurn` answers whether it did), else the scripted crew's. */
    async crew(_id: string, send: Send) {
      const project = o.getState().crew.project;
      try {
        const played = o.crewTurn && project ? await o.crewTurn(project) : false;
        if (!played && project) {
          for (const move of scriptedCrew(project)) {
            await wait(o.timers, CREW_BEAT_MS);
            await o.invoke('crew.say', { by: move.by, idea: move.idea, text: move.say });
            await o.invoke('crew.build', { by: move.by, idea: move.idea, block: move.block });
            audio?.sfx('pop');
          }
          await wait(o.timers, CREW_BEAT_MS);
        }
      }
      catch (error) {
        o.report(error);
      }
      // however the turn went, it ends: a crew that stalls must not hold the round
      if (o.getState().crew.project?.phase === 'crew') await o.invoke('crew.done', { by: 'architect' });
      send('crew/idle');
    },
    xp(props: { amount: number, badge?: string }, send: Send) {
      const earned = award(o.getState().profile, Number(props.amount) || 0, props.badge);
      send('profile/set', earned.profile);
      if (earned.rankUp) {
        audio?.sfx('levelup');
        send('studio/toast', 'You climbed a rank!');
      }
    },
    /** What a game reported: dialogue, a rating, experience, a proposed setting. */
    'game-event'(e: any, send: Send) {
      const s = o.getState();
      const game = s.arcade.game ?? 'arcade';
      if (e.kind === 'say') {
        post(hostOf(), { thread: `arcade-${game}`, subject: games[game]?.title ?? 'Arcade', folder: 'arcade', from: e.who, to: ['human'], text: e.text, at: o.now() });
        if (s.settings.captions) send('studio/toast', `${e.who}: ${e.text}`);
      }
      else if (e.kind === 'rate') {
        const attempt = { correct: e.correct, difficulty: e.difficulty, hinted: e.hinted === true };
        let profile = rate(s.profile, { ...attempt, skill: `${game}:${e.skill}` }).profile;
        profile = rate(profile, { ...attempt, skill: AREAS[game] ?? 'apps' }).profile;
        send('profile/set', profile);
      }
      else if (e.kind === 'xp') effects.xp({ amount: e.amount }, send);
      else if (e.kind === 'setting' && e.key === 'ai.toolBudget') {
        send('settings/budget', e.value);
        send('studio/toast', `Tool budget set to ${e.value}, as measured.`);
      }
    },
    post(props: any) {
      post(hostOf(), { ...props, at: o.now() });
    },
  };

  const subs = {
    /** The coach watches its signals and moves on when a step's check holds. */
    coach(props: { signals: any }, send: Send) {
      // a turn later: the first start happens while the app is still booting
      const id = o.timers.setTimeout(() => {
        const s = o.getState();
        const out = advanceCoach(s.coach, s.profile, props.signals);
        if (out.events.length === 0) return;
        const last = out.events[out.events.length - 1];
        audio?.sfx(out.events.some((e) => e.kind === 'quest') ? 'levelup' : 'chime');
        send('coach/set', { coach: out.coach, profile: out.profile, toast: last.text });
      }, 0);
      return () => o.timers.clearTimeout(id);
    },
    /** A toast fades on its own. */
    toast(_props: unknown, send: Send) {
      const id = o.timers.setTimeout(() => send('studio/toast', null), 3800);
      return () => o.timers.clearTimeout(id);
    },
    /** So does the coach's spotlight. */
    spotlight(_props: unknown, send: Send) {
      const id = o.timers.setTimeout(() => send('studio/spotlight', null), 4200);
      return () => o.timers.clearTimeout(id);
    },
  };

  return {
    effects,
    subs,
    /** The studio's subscription entries for the app document. */
    entries: [
      { run: 'coach', withQuery: { quest: '$.coach.quest', step: '$.coach.step', signals: COACH_SIGNALS } },
      { run: 'toast', when: { $not: { '$is-null': '$.studio.toast' } }, withQuery: { seq: '$.studio.toastSeq' } },
      { run: 'spotlight', when: { $not: { '$is-null': '$.studio.spotlight' } }, withQuery: { target: '$.studio.spotlight' } },
    ],
    widgets: { board: boardWidget, mini: miniWidget, arcade: arcade.widget },
    arcade,
    /** The hooks the contract's studio handlers read. */
    system: {
      library: () => library,
      arcade: () => arcade,
      /** The oracle answers a letter, from the documentation. */
      reply(thread: string, text: string) {
        answer(text).then(({ reply }) => {
          post(hostOf(), { thread, folder: 'inbox', from: 'oracle', to: ['human'], text: reply.text, at: o.now() });
        }, o.report);
      },
    },
    ensureLibrary,
  };
}

function wait(timers: StudioHostOptions['timers'], ms: number): Promise<void> {
  return new Promise((resolve) => { timers.setTimeout(() => resolve(undefined), ms); });
}
