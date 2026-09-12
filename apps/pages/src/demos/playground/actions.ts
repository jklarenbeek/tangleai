/** Host transitions for the public Play component. */
export const PLAY_ACTIONS = {
  'play/example': { effects: [{ run: 'play-load', with: { id: '$payload' } }] },
  'play/loaded': {
    patch: [
      { op: 'replace', path: '/play/engine', value: '$payload.engine' },
      { op: 'replace', path: '/play/exampleId', value: '$payload.exampleId' },
      { op: 'replace', path: '/play/source', value: '$payload.source' },
      { op: 'replace', path: '/play/datasetIndex', value: '$payload.datasetIndex' },
      { op: 'replace', path: '/play/data', value: '$payload.data' },
      { op: 'replace', path: '/play/config', value: '$payload.config' },
      { op: 'replace', path: '/play/result', value: null },
      // an example REPLACES the session's content, so it can no longer be
      // the saved record: unbind, or the next Save would overwrite that
      // record with something the user never saved there
      { op: 'replace', path: '/play/savedName', value: null },
      // a new engine's result has different screens; drop any stale tab,
      // and a fresh example opens CALM — the depth toggle resets off
      { op: 'replace', path: '/play/panel', value: null },
      { op: 'replace', path: '/play/deep', value: false },
      { op: 'replace', path: '/play/deepPick', value: null },
      // the structured form buffer belongs to the example it was parsed
      // from — keep it and the first form edit mirrors the OLD buffer
      // over the new example's data pane (loaded-session resets the same)
      { op: 'replace', path: '/play/dataView', value: 'json' },
      { op: 'replace', path: '/play/dataValue', value: null },
      // on a phone, picking an example answers immediately: show its result
      // (desktop shows every pane, so this is invisible there)
      { op: 'replace', path: '/play/mobilePane', value: 'result' },
    ],
  },
  'play/source': {
    patch: [{ op: 'add', path: { $concat: ['/play/source/', '$payload.key'] }, value: '$event.value' }],
  },
  'play/data': {
    patch: [{ op: 'add', path: { $concat: ['/play/data/', '$payload.key'] }, value: '$event.value' }],
  },
  'play/option': {
    patch: [{ op: 'add', path: { $concat: ['/play/config/', '$payload.key'] }, value: '$event.value' }],
  },
  'play/dataset': { effects: [{ run: 'play-dataset', with: { index: '$payload' } }] },
  'play/dataset-set': {
    patch: [
      { op: 'replace', path: '/play/datasetIndex', value: '$payload.index' },
      { op: 'replace', path: '/play/data', value: '$payload.data' },
    ],
  },
  'play/result': { patch: [{ op: 'replace', path: '/play/result', value: '$payload' }] },
  'play/panel': { patch: [{ op: 'replace', path: '/play/panel', value: '$payload' }] },
  'play/deep': { patch: [{ op: 'replace', path: '/play/deep', value: '$payload' }] },
  'play/deep-pick': { patch: [{ op: 'replace', path: '/play/deepPick', value: '$payload' }] },
  'play/mobile-pane': { patch: [{ op: 'replace', path: '/play/mobilePane', value: '$payload' }] },
  'play/new': { effects: [{ run: 'play-new' }] },
  'play/save': { effects: [{ run: 'play-save' }] },
  'play/save-as': { effects: [{ run: 'play-save', with: { as: true } }] },
  'play/open': { effects: [{ run: 'play-open', with: { name: '$event.value' } }] },
  'play/delete-session': { effects: [{ run: 'play-delete', with: { name: '$payload' } }] },
  'play/share': { effects: [{ run: 'play-share' }] },
  'play/download': { effects: [{ run: 'play-download' }] },
  'play/import': { effects: [{ run: 'play-import' }] },
  'play/name': { patch: [{ op: 'replace', path: '/play/name', value: '$event.value' }] },
  'play/names': { patch: [{ op: 'replace', path: '/play/names', value: '$payload' }] },
  'play/saved': {
    patch: [
      { op: 'replace', path: '/play/savedName', value: '$payload.name' },
      { op: 'replace', path: '/play/name', value: '$payload.name' },
      { op: 'replace', path: '/play/names', value: '$payload.names' },
    ],
  },
  'play/shared': { patch: [{ op: 'replace', path: '/play/shared', value: '$payload' }] },
  'play/layout-ratio': { patch: [{ op: 'replace', path: '/play/ratio', value: '$payload' }] },
  'play/loaded-session': {
    patch: [
      { op: 'replace', path: '/play/engine', value: '$payload.engine' },
      { op: 'replace', path: '/play/exampleId', value: '$payload.exampleId' },
      { op: 'replace', path: '/play/source', value: '$payload.source' },
      { op: 'replace', path: '/play/data', value: '$payload.data' },
      { op: 'replace', path: '/play/config', value: '$payload.config' },
      { op: 'replace', path: '/play/name', value: '$payload.name' },
      // a loaded record binds; a blank or SHARED session does not (a share
      // link is not a local record, so its first Save must ask for a name)
      { op: 'replace', path: '/play/savedName', value: { $default: ['$payload.savedName', null] } },
      { op: 'replace', path: '/play/datasetIndex', value: 0 },
      { op: 'replace', path: '/play/result', value: null },
      { op: 'replace', path: '/play/panel', value: null },
      { op: 'replace', path: '/play/deep', value: false },
      { op: 'replace', path: '/play/deepPick', value: null },
      { op: 'replace', path: '/play/shared', value: null },
      { op: 'replace', path: '/play/dataView', value: 'json' },
      { op: 'replace', path: '/play/dataValue', value: null },
    ],
  },
  'play/data-view': { effects: [{ run: 'play-data-view', with: { view: '$payload' } }] },
  'play/data-view-set': {
    patch: [
      { op: 'replace', path: '/play/dataView', value: '$payload.view' },
      { op: 'replace', path: '/play/dataValue', value: '$payload.value' },
    ]
  },
  'play/data-mirror': { patch: [{ op: 'add', path: '/play/data/data', value: '$payload' }] },
  'play/f-input': { patch: [{ op: { $if: [{ $or: ['$payload.element', { $eq: ['$payload.pointer', ''] }] }, 'replace', 'add'] }, path: { $concat: ['/play/dataValue', '$payload.pointer'] }, value: '$event.value' }] },
  'play/f-check': { patch: [{ op: { $if: [{ $or: ['$payload.element', { $eq: ['$payload.pointer', ''] }] }, 'replace', 'add'] }, path: { $concat: ['/play/dataValue', '$payload.pointer'] }, value: '$event.checked' }] },
  'play/f-number': { patch: [{ op: { $if: [{ $or: ['$payload.element', { $eq: ['$payload.pointer', ''] }] }, 'replace', 'add'] }, path: { $concat: ['/play/dataValue', '$payload.pointer'] }, value: { $if: [{ $ne: ['$event.value', ''] }, { $number: '$event.value' }, null] } }] },
  'play/f-json': { patch: [{ op: { $if: [{ $or: ['$payload.element', { $eq: ['$payload.pointer', ''] }] }, 'replace', 'add'] }, path: { $concat: ['/play/dataValue', '$payload.pointer'] }, value: '$event.formJsonValue' }] },
  'play/f-add': { patch: [{ op: 'add', path: { $concat: ['/play/dataValue', '$payload.pointer', '/-'] }, value: '$payload.value' }] },
  'play/f-remove': { patch: [{ op: 'remove', path: { $concat: ['/play/dataValue', '$payload.pointer'] } }] }
};
