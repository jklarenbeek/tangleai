import { encodeShare } from '@jarenjs/app';
import { loadExample, loadDataset, blankSession, sessionOf, sessionFilename, sessionDocument, sessionFromDocument, sessionToLoaded } from './play.ts';
const SHARE_TOKEN_LIMIT = 8000;
/** @param app @param playStore @param env */
export function playEffects(app: any, playStore: any, env: any) {
  return {
    'play-load': (props: any, dispatch: any) => {
      const loaded = loadExample(props.id);
      if (loaded !== null) dispatch('play/loaded', loaded);
    },
    'play-dataset': (props: any, dispatch: any) => {
      const data = loadDataset(app.getState().play.exampleId, props.index);
      if (data !== null) dispatch('play/dataset-set', { index: props.index, data });
    },
    'play-new': (props: any, dispatch: any) => {
      dispatch('play/loaded-session', { ...blankSession(app.getState().play.engine), name: '' });
    },
    'play-save': (props: any, dispatch: any) => {
      const slice = app.getState().play;
      const title = (slice.name ?? '').trim();
      const target = props?.as === true ? title : (slice.savedName ?? title);
      if (target === '') return; // nothing to save under (the header nudges)
      playStore.save(target, { ...sessionOf(slice), savedAt: new Date().toISOString() });
      dispatch('play/saved', { name: target, names: playStore.names() });
    },
    'play-download': (props: any, dispatch: any) => {
      const slice = app.getState().play;
      const saved = env.download?.(sessionFilename(slice),
        JSON.stringify(sessionDocument(slice), null, 2));
      dispatch('play/shared', saved === true ? 'session downloaded' : 'download unavailable here');
    },
    'play-import': (props: any, dispatch: any) => {
      if (env.openFile === undefined) {
        dispatch('play/shared', 'opening a file is unavailable here');
        return;
      }
      Promise.resolve(env.openFile()).then((file: any) => {
        if (file === null || file === undefined) return; // the picker was dismissed
        const doc = sessionFromDocument(file.text);
        if (doc === null) {
          dispatch('play/shared', `${file.name ?? 'that file'} is not a play session`);
          return;
        }
        dispatch('play/loaded-session', { ...doc.session, name: doc.name });
        dispatch('play/shared', `imported ${file.name ?? 'a session'}`);
      }).catch(() => dispatch('play/shared', 'that file could not be read'));
    },
    'play-open': (props: any, dispatch: any) => {
      const session = playStore.load(props.name);
      if (session === undefined) return;
      dispatch('play/loaded-session',
        { ...sessionToLoaded(session), name: props.name, savedName: props.name });
    },
    'play-delete': (props: any, dispatch: any) => {
      playStore.remove(props.name);
      // the record this session was bound to is gone: unbind, so the next
      // Save creates rather than silently resurrecting a deleted name
      if (app.getState().play.savedName === props.name) {
        dispatch('play/saved', { name: null, names: playStore.names() });
      }
      else dispatch('play/names', playStore.names());
    },
    'play-data-view': (props: any, dispatch: any) => {
      const view = props.view === 'form' ? 'form' : 'json';
      let value = app.getState().play.dataValue;
      if (view === 'form') {
        const text = app.getState().play.data?.data ?? '';
        try { value = JSON.parse(text.trim() === '' ? 'null' : text); }
        catch { value = null; } // an unparseable text opens an empty form
      }
      dispatch('play/data-view-set', { view, value });
    },
    'play-share': async (props: any, dispatch: any) => {
      const token = encodeShare(sessionOf(app.getState().play));
      if (token.length > SHARE_TOKEN_LIMIT) {
        // refuse the link, but never leave the session with no way out —
        // Download writes the same session as a file Import can read back
        dispatch('play/shared',
          `too large for a share link (${token.length} > ${SHARE_TOKEN_LIMIT} chars) — use Download instead`);
        return;
      }
      try {
        const url = await env.share?.(`#/play?s=${token}`);
        dispatch('play/shared', url ? 'link copied' : 'clipboard sharing unavailable here');
      } catch { dispatch('play/shared', 'the share link could not be copied'); }
    },
  };
}
