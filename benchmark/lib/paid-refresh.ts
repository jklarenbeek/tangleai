/** Small public summary of dated paid reports; the raw attempts remain authoritative. */
import type { LiveReport } from './locomo-qa.ts';
import type { GroundingLive } from './grounding-run.ts';

export function summarizePaidRefresh(qa: LiveReport, grounding: GroundingLive) {
  return {
    model: qa.generated.model,
    judge: qa.generated.judgeModel,
    embedder: qa.generated.embedder,
    qa: {
      at: qa.generated.at,
      runs: qa.runs.length,
      calls: qa.runs.reduce((sum, run) => sum + run.spent.turns, 0),
      tokens: qa.runs.reduce((sum, run) => sum + run.spent.tokens, 0),
      wireErrors: qa.runs.reduce((sum, run) => sum + run.errors.count, 0),
      rows: qa.configurations.map((row) => ({
        key: row.key, label: row.label,
        planned: row.questions.planned, answered: row.questions.answered,
        invalid: row.questions.invalid, unanswered: row.questions.unanswered,
        f1: row.f1.overall, ceiling: row.ceiling.overall,
        cost: row.cost, latency: row.latency, horizon: row.horizon ?? null,
        adversarial: { planned: row.adversarial.planned, judged: row.adversarial.judged, accuracy: row.adversarial.accuracy },
      })),
    },
    grounding: {
      at: grounding.generated.at,
      reportId: grounding.reportId,
      calls: grounding.spent.turns,
      tokens: grounding.spent.tokens,
      wireErrors: grounding.errors.count,
      decision: grounding.decision.state,
      strata: grounding.strata.map((stratum) => ({
        key: stratum.key,
        eligible: stratum.pairing.eligible,
        rows: stratum.rows.filter((row) => row.generates).map((row) => ({
          key: row.key, planned: row.questions.planned, answered: row.questions.answered,
          invalid: row.questions.invalid, unanswered: row.questions.unanswered,
          answerF1: row.answerF1, claimMicroF1: row.claims?.microF1 ?? null,
          citations: row.citations,
        })),
      })),
    },
  };
}
