/** The Pages play host composes the published component and its engine services. */
import { createApp, createDocStore, createFormView, formEventFields } from '@jarenjs/app';
import { PLAY_ACTIONS } from './actions.ts';
import { playEffects } from './effects.ts';
import { PLAY_START, playComponent, runPlay, sessionToLoaded, createPlaySplitterWidget, withPlayLocale } from './play.ts';
import { formViewFor, formLabelsFor, referencedSchemas } from './services.ts';
const CHROME = new Set(['result', 'panel', 'deep', 'deepPick', 'mobilePane', 'name', 'savedName', 'names', 'shared', 'ratio']);
/** @param node @param [options] */
export function mountPlay(node: HTMLElement | null, options: any = {}) {
  let app: any, disposed = false, sequence = 0, timer: any;
  const store = options.store ?? createDocStore({ storage: { read: () => null, write() { } } });
  const rawEffects = playEffects({ getState: () => app.getState() }, store, options);
  const effects = Object.fromEntries(Object.entries(rawEffects).map(([key, effect]) => [key, (props: any, dispatch: any) => {
    if (!disposed) return effect(props, (action: any, payload: any) => { if (!disposed) dispatch(action, payload); });
  }]));
  app = createApp({
    state: { play: { ...structuredClone(PLAY_START), ...options.state, names: store.names() } }, actions: PLAY_ACTIONS,
    view: {
      $jslt: '0.1', modes: playComponent.modes, rules: [
        { match: '$', body: { $apply: ['$.ui.play', 'play'] } }, ...playComponent.rules,
        ...createFormView({
          root: '$.ui.play.dataForm',
          // the chrome follows the Messages language while the form is open
          labelsPath: '$.ui.play.formLabels',
          actions: {
            input: 'play/f-input', check: 'play/f-check', number: 'play/f-number', json: 'play/f-json', add: 'play/f-add', remove: 'play/f-remove',
          }
        }).map((rule: any) => ({ ...rule, mode: 'play' })),
      ]
    },
  }, {
    node, document: node?.ownerDocument, schedule: options.schedule, onError: options.onError,
    eventFields: formEventFields(), effects, widgets: { 'play-splitter': createPlaySplitterWidget() },
    viewModel: (state: any) => {
      // the panes read the reader's message language, as the run does
      const play = withPlayLocale(state.play);
      return {
        ui: {
          play: {
            ...playComponent.viewModel({ ...state, play }),
            // the form's field errors and chrome speak the language of its alerts
            ...(play.engine === 'validate' && play.dataView === 'form'
              ? { dataForm: formViewFor(play.source?.schema ?? '', play.dataValue, referencedSchemas(play.source?.schemas), play.config?.locale), formLabels: formLabelsFor(play.config?.locale) } : {})
          }
        }
      };
    },
  });
  function run() {
    if (disposed) return { ok: false as const, error: 'The playground is disposed.' };
    const version = ++sequence, result = runPlay(app.getState().play);
    const publish = (value: any) => { if (!disposed && version === sequence) app.dispatch('play/result', value); return value; };
    return result && 'then' in result && typeof result.then === 'function' ? result.then(publish) : publish(result);
  }
  const stop = app.subscribe((state: any, changes: any) => {
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
  return {
    read: () => structuredClone(app.getState().play),
    replace(session: any, name: string = '') {
      if (disposed) return { ok: false as const, error: 'The playground is disposed.' };
      app.dispatch('play/loaded-session', { ...sessionToLoaded(session), name }); clearTimeout(timer); return run();
    },
    run, dispatch: app.dispatch,
    dispose() { if (disposed) return; disposed = true; sequence++; clearTimeout(timer); stop(); app.destroy(); },
  };
}
