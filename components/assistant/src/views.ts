/**
 * The AI assistant panel — mode 'assistant', dispatched with
 * `$.ui.assistant` as the current node. A global slide-out on every
 * page: a bring-your-own-key chat that drives the playground through
 * @tangleai/agents's schema-guarded tools. Assistant replies render through
 * the @jarenjs/md component (dogfooding); the streaming reply is plain
 * text because it changes per token.
 */

/** One instance owns its datalist identifier and host copy; every sentence comes from the projection, only glyphs are written here. */
export function createAssistantRules(modelListId: any) {
  const settingsForm =
    ['form', {
      class: 'ai-settings',
      on: { submit: { action: 'ai/save-settings', preventDefault: true } }
    },
      ['p', { class: 'ai-hint' },
        '$.settingsHint'],
      ['label', { class: 'ai-field' },
        ['span', {}, '$.text.provider'],
        ['select', {
          class: 'select',
          on: { change: { action: 'ai/setting', with: { key: 'provider' } } },
        }, [{ $apply: '$.providers[*]' }]],
      ],
      {
        $if: ['$.settings.needsKey',
          ['label', { class: 'ai-field' },
            ['span', {}, '$.text.apiKey'],
            ['input', {
              type: 'password', class: 'editor line', spellcheck: 'false',
              autocomplete: 'off', placeholder: '$.text.apiKeyExample', value: '$.settings.apiKey',
              on: { input: { action: 'ai/setting', with: { key: 'apiKey' } } },
            }],
          ]]
      },
      ['label', { class: 'ai-field' },
        ['span', {}, '$.text.baseUrl'],
        ['input', {
          type: 'text', class: 'editor line', spellcheck: 'false',
          placeholder: '$.text.baseUrlExample',
          value: '$.settings.baseUrl',
          on: { input: { action: 'ai/setting', with: { key: 'baseUrl' } } },
        }],
      ],
      ['label', { class: 'ai-field' },
        ['span', {}, '$.text.model'],
        ['input', {
          type: 'text', class: 'editor line', spellcheck: 'false', list: modelListId,
          placeholder: '$.text.modelExample', value: '$.settings.model',
          on: { input: { action: 'ai/setting', with: { key: 'model' } } },
        }],
        // a successful probe fills this in: the input becomes a picker
        ['datalist', { id: modelListId }, [{ $apply: '$.settings.probe.models[*]' }]],
      ],
      ['div', { class: 'ai-settings-actions' },
        ['button', { type: 'submit', class: 'btn small' }, '$.text.save'],
        ['button', {
          type: 'button', class: 'btn small',
          disabled: { $if: ['$.settings.probe.busy', 'disabled', false] },
          on: { click: 'ai/probe' },
        }, { $if: ['$.settings.probe.busy', '$.text.testing', '$.text.test'] }],
      ],
      { $if: ['$.settings.probe.ok', ['p', { class: 'ai-hint' }, '$.settings.probe.detail']] },
      { $if: ['$.settings.probe.fail', ['p', { class: 'ai-error' }, '$.settings.probe.detail']] },
    ];

  const intro = ['div', { class: 'ai-intro' }, ['p', {}, '$.intro'], ['ul', {}, [{ $apply: '$.capabilities[*]' }]]];

  // unconfigured: no composer to type into yet — point at the settings
  // form above instead of presenting a chat that cannot send
  const setupIntro =
    ['div', { class: 'ai-intro' },
      ['p', {}, '$.text.setup'],
    ];

  const composer =
    ['form', {
      class: 'ai-composer',
      on: { submit: { action: 'ai/send', preventDefault: true } }
    },
      ['textarea', {
        class: 'editor', rows: 2, spellcheck: 'false',
        placeholder: '$.text.composer', value: '$.draft',
        on: { input: 'ai/draft' },
      }],
      ['button', {
        type: 'submit', class: 'btn small ai-send',
        disabled: { $if: [{ $eq: ['$.status', 'streaming'] }, 'disabled', false] },
      }, { $if: [{ $eq: ['$.status', 'streaming'] }, '…', '$.text.send'] }],
      { $if: ['$.streaming', ['button', { type: 'button', class: 'btn small', on: { click: 'ai/cancel' } }, '$.text.cancel']] },
    ];

  // The ledger surface: one objective that outlives the tab, what has
  // been recorded against it, and the archived rounds a compacted session
  // can still reach. Without a goal it is a single input — the smallest
  // thing that can be ignored.
  const goalForm =
    ['form', {
      class: 'ai-goal-set',
      on: { submit: { action: 'ai/goal-set', preventDefault: true } }
    },
      ['input', {
        type: 'text', class: 'editor line', spellcheck: 'false',
        placeholder: '$.text.goalPlaceholder',
        value: '$.goalDraft',
        on: { input: 'ai/goal-draft' },
      }],
      ['button', { type: 'submit', class: 'btn small' }, '$.text.goalSet'],
    ];

  const goalPanel =
    ['div', { class: 'ai-goal' },
      ['div', { class: 'ai-goal-head' },
        ['span', { class: 'ai-goal-label' }, '$.text.objective'],
        ['button', {
          type: 'button', class: 'ai-icon', title: '$.text.goalClearTitle',
          'aria-label': '$.text.goalClearLabel', on: { click: 'ai/goal-clear' },
        }, '✕'],
      ],
      ['p', { class: 'ai-goal-text' }, '$.goal.objective'],
      ['ul', { class: 'ai-goal-progress' }, [{ $apply: '$.goal.progress[*]' }]],
      { $if: ['$.goal.checkpointLabel', ['p', { class: 'ai-hint' }, '$.goal.checkpointLabel']] },
      { $if: ['$.goal.more', ['p', { class: 'ai-hint' }, '$.goal.moreLabel']] },
      ['div', { class: 'ai-goal-actions' },
        ['button', {
          type: 'button', class: 'btn small',
          disabled: { $if: ['$.remembering', 'disabled', false] },
          on: { click: 'ai/remember' },
        }, { $if: ['$.remembering', '$.text.remembering', '$.text.remember'] }],
        { $if: ['$.memories', ['span', { class: 'ai-hint' }, '$.memoryLabel']] },
      ],
      { $if: ['$.remembered', ['p', { class: 'ai-hint' }, '$.remembered']] },
    ];

  const panel =
    ['div', { class: 'ai-panel' },
      ['div', { class: 'ai-head' },
        ['span', { class: 'ai-title' }, '$.title'],
        ['button', {
          type: 'button', class: 'ai-icon', title: '$.text.settingsTitle',
          'aria-label': '$.text.settingsLabel', on: { click: 'ai/settings-toggle' },
        }, '⚙'],
        ['button', {
          type: 'button', class: 'ai-icon', title: '$.text.clearTitle',
          'aria-label': '$.text.clearLabel', on: { click: 'ai/clear' },
        }, '⌫'],
        ['button', {
          type: 'button', class: 'ai-icon', title: '$.text.closeTitle',
          'aria-label': '$.text.closeLabel', on: { click: 'ai/toggle' },
        }, '✕'],
      ],
      { $if: ['$.showSettings', settingsForm] },
      { $if: ['$.configured', { $if: ['$.goal', goalPanel, goalForm] }] },
      ['div', { class: 'ai-log' },
        { $if: ['$.empty', { $if: ['$.configured', intro, setupIntro] }] },
        [{ $apply: '$.messages[*]' }],
        {
          $if: [{ $and: ['$.streaming', '$.pending'] },
          ['div', { class: 'ai-msg assistant' }, ['p', {}, '$.pending']]]
        },
        {
          $if: ['$.activity',
            ['p', { class: 'ai-activity' },
              { $if: ['$.activityLabel.before', '$.activityLabel.before'] }, ['code', {}, '$.activity'],
              { $if: ['$.activityLabel.after', '$.activityLabel.after'] }, '…']]
        },
        {
          $if: [{ $and: [{ $eq: ['$.status', 'streaming'] }, { $not: '$.pending' }, { $not: '$.activity' }] },
          ['p', { class: 'ai-activity' }, '$.thinkingLabel']]
        },
        { $if: ['$.error', ['p', { class: 'ai-error' }, '$.error']] },
        // a compacted session says so: the rounds that left the request are
        // in slots with addresses, not gone, and the panel is where that
        // stops being an implementation detail
        { $if: ['$.persistenceLabel', ['p', { class: 'ai-archived' }, '$.persistenceLabel']] },
        { $if: ['$.retentionLabel', ['p', { class: 'ai-archived' }, '$.retentionLabel']] },
        { $if: ['$.archived', ['p', { class: 'ai-archived' }, '$.archivedLabel']] },
      ],
      { $if: ['$.configured', composer] },
    ];

  return [
    {
      match: '$.ui.assistant', mode: 'assistant',
      body: ['div', { class: { $if: ['$.open', 'ai open', 'ai'] } },
        ['button', {
          type: 'button', class: 'ai-launch', title: '$.launchTitle',
          'aria-label': '$.launchTitle', on: { click: 'ai/toggle' },
        }, '✦', ['span', { class: 'ai-launch-label' }, '$.launchLabel']],
        { $if: ['$.open', panel] },
      ],
    },
    { match: '$.ui.assistant.capabilities[*]', mode: 'assistant', body: ['li', {}, '$.text'] },
    {
      match: '$.ui.assistant.providers[*]', mode: 'assistant',
      body: ['option', { value: '$.value', selected: '$.selected' }, '$.label'],
    },
    {
      match: '$.ui.assistant.settings.probe.models[*]', mode: 'assistant',
      body: ['option', { value: '$.id' }],
    },
    {
      match: "$.ui.assistant.messages[?@.role == 'user']", mode: 'assistant',
      body: ['div', { class: 'ai-msg user' }, ['p', {}, '$.text']],
    },
    {
      // the assistant reply is a ready-made @jarenjs/md vnode, spliced
      // in verbatim (no dispatch into it)
      match: "$.ui.assistant.messages[?@.role == 'assistant']", mode: 'assistant',
      body: ['div', { class: 'ai-msg assistant' }, '$.article'],
    },
    {
      // one recorded step towards the objective. The evidence is shown
      // beside the note, always: a progress log of unevidenced claims is
      // exactly what the ledger's schema refuses to store, and the panel
      // should not present one either.
      match: '$.ui.assistant.goal.progress[*]', mode: 'assistant',
      body: ['li', {}, '$.note', ['span', { class: 'ai-evidence' }, '$.evidence']],
    },
  ];

}
