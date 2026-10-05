/** Profile-level defaults confer no approval or activation authority. */
export const RESEARCH_LESSON_DEFAULTS = Object.freeze({ writeback: 'experimental-off' as const, decayHypothesisId: 'none' as const });
export const RESEARCH_DOMAIN_LESSON_POLICIES = Object.freeze({ computational: RESEARCH_LESSON_DEFAULTS });
