/** Stable stage bindings; executable defaults are listed in the artifact catalog. */
export const GMPL_STAGES=Object.freeze({
  'parallel-analysis':Object.freeze(['analysis-analyst','analysis-merge']),
  'peer-review':Object.freeze(['peer-review-revision','peer-review-review']),
  'red-team':Object.freeze(['peer-review-revision','red-team-attack','red-team-defense','red-team-resilience']),
  'structured-debate':Object.freeze(['debate-position','debate-rebuttal','debate-judge','analysis-merge']),
  'clarification':Object.freeze(['clarification-resolve','clarification-question','analysis-merge']),
  'delphi-panel':Object.freeze(['delphi-panel-poll','delphi-panel-aggregate']),
});
