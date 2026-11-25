/**
 * The desktop's background work as Settings sees it: whether the browser twin
 * runs in this page, and how Forget everything deletes what it keeps in this
 * browser. The desktop's entry sets the hooks once it knows; until then there
 * is nothing to forget.
 */
export const background = {
  /** Stop the twin and delete its store; `true` when there was one to delete. */
  forget: async (): Promise<boolean> => false,
};

export function setBackground(hooks: { forget: () => Promise<boolean> }) { background.forget = hooks.forget; }
