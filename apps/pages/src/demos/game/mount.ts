import { createApp, formEventFields } from '@jarenjs/app';
import { isConfigured, DEFAULT_AI_SETTINGS } from '@tangleai/assistant';
import { createGameRuntime, GAME_ACTIONS, gamePageViewModel } from './runtime.ts';
import { createGameState } from './state.ts';
import { GAME_RULES } from './views.ts';
import { documentHost } from '../playground/services.ts';
/** @param node @param [options] */
export function mountGame(node: HTMLElement | null, options: any = {}) {
  let app: any, disposed = false;
  const runtime = createGameRuntime({ ...options, isConfigured, getApp: () => ({ getState: () => ({ ...app.getState(), ai: { settings: options.settings?.() ?? DEFAULT_AI_SETTINGS } }) }) });
  app = createApp({
    state: { game: options.state ? { ...structuredClone(options.state), thinking: false } : createGameState() }, actions: GAME_ACTIONS,
    view: {
      $jslt: '0.1', modes: { game: { unmatched: 'error' } }, rules: [
        { match: '$', body: ['div', { class: 'tangle-game' }, { $apply: ['$.ui.game', 'game'] }] }, ...GAME_RULES,
      ]
    },
  }, {
    node, document: node?.ownerDocument, schedule: options.schedule, onError: options.onError,
    eventFields: formEventFields(), effects: runtime.effects, widgets: documentHost.STUDIO_WIDGETS,
    viewModel: (state: any) => ({ ui: { game: gamePageViewModel(state.game) } }),
  });
  return {
    read: () => structuredClone(app.getState().game), getState: app.getState, getVnode: app.getVnode,
    dispatch: app.dispatch, subscribe: app.subscribe,
    dispose() { if (disposed) return; disposed = true; runtime.dispose(); app.destroy(); },
  };
}
