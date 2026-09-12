//@ts-check
/** The Pages play host composes the published component and its engine services. */
import { createApp, createDocStore, createFormView, formEventFields } from '@jarenjs/app';
import { PLAY_ACTIONS } from './actions.js';
import { playEffects } from './effects.js';
import { PLAY_START, playComponent, runPlay, sessionToLoaded, createPlaySplitterWidget } from './play.js';
import { formViewFor } from './services.js';
const CHROME = new Set(['result', 'panel', 'deep', 'deepPick', 'mobilePane', 'name', 'savedName', 'names', 'shared', 'ratio']);
/** @param {HTMLElement|null} node @param {any} [options] */
export function mountPlay(node, options = {}) {
  let app, disposed = false, sequence = 0, timer;
  const store = options.store ?? createDocStore({ storage: { read: () => null, write() {} } });
  const rawEffects = playEffects({ getState: () => app.getState() }, store, options);
  const effects = Object.fromEntries(Object.entries(rawEffects).map(([key, effect]) => [key, (props, dispatch) => {
    if (!disposed) return effect(props, (action, payload) => { if (!disposed) dispatch(action, payload); });
  }]));
  app = createApp({ state: { play: { ...structuredClone(PLAY_START), ...options.state, names: store.names() } }, actions: PLAY_ACTIONS,
    view: { $jslt: '0.1', modes: playComponent.modes, rules: [
      { match: '$', body: { $apply: ['$.ui.play', 'play'] } }, ...playComponent.rules,
      ...createFormView({ root: '$.ui.play.dataForm', actions: {
        input: 'play/f-input', check: 'play/f-check', number: 'play/f-number', json: 'play/f-json', add: 'play/f-add', remove: 'play/f-remove',
      } }).map(rule => ({ ...rule, mode: 'play' })),
    ] },
  }, { node, document: node?.ownerDocument, schedule: options.schedule, onError: options.onError,
    eventFields: formEventFields(), effects, widgets: { 'play-splitter': createPlaySplitterWidget() },
    viewModel: state => ({ ui: { play: { ...playComponent.viewModel(state),
      ...(state.play.engine === 'validate' && state.play.dataView === 'form'
        ? { dataForm: formViewFor(state.play.source?.schema ?? '', state.play.dataValue) } : {}) } } }),
  });
  function run() {
    if (disposed) return { ok: false, error: 'The playground is disposed.' };
    const version = ++sequence, result = runPlay(app.getState().play);
    const publish = value => { if (!disposed && version === sequence) app.dispatch('play/result', value); return value; };
    return result && typeof result.then === 'function' ? result.then(publish) : publish(result);
  }
  const stop = app.subscribe((state, changes) => {
    if (!changes || disposed) return;
    let rerun = false, form = false, toggle = false;
    for (const path of changes) if (path.startsWith('/play/')) {
      const key = path.split('/')[2];
      if (key === 'dataValue') form = true;
      else if (key === 'dataView') toggle = true;
      else if (!CHROME.has(key)) rerun = true;
    }
    if (rerun) {
      sequence++; clearTimeout(timer);
      if (options.debounceMs === 0) run(); else timer = setTimeout(run, options.debounceMs ?? 250);
    }
    if (form && !toggle) app.dispatch('play/data-mirror', state.play.dataValue === null ? '' : JSON.stringify(state.play.dataValue, null, 2));
  });
  run();
  return { read: () => structuredClone(app.getState().play),
    replace(session, name = '') { if (disposed) return { ok: false, error: 'The playground is disposed.' };
      app.dispatch('play/loaded-session', { ...sessionToLoaded(session), name }); clearTimeout(timer); return run(); },
    run, dispatch: app.dispatch,
    dispose() { if (disposed) return; disposed = true; sequence++; clearTimeout(timer); stop(); app.destroy(); },
  };
}
