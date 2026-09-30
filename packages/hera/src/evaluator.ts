/** Scoring is a host capability with a versioned task rule, never a role opinion. */
import { equalsJson } from '@jarenjs/core/object';
import { heraRefuse, type HeraOutcome } from './errors.ts';
import type { HeraTask, HeraLearningSnapshot, HeraMode } from './contracts.gen.ts';
import type { HeraAnswerEvidence } from './evidence.ts';
export interface HeraTaskScore { primaryScore: number | null; success: boolean | null; metrics?: Record<string,number>; }
export interface HeraTaskAdapter {
  identity: NonNullable<HeraTask['evaluator']>;
  score(task: HeraTask, answer: string, evidence: HeraAnswerEvidence): Promise<HeraTaskScore>;
}
export function validateHeraEvaluator(task: HeraTask, snapshot: HeraLearningSnapshot, evaluator: HeraTaskAdapter, mode:HeraMode): HeraOutcome<true> {
  if (mode === 'learn' && (task.evaluator===null || (!task.goldAddress && !task.outcomeAddress)))
    return heraRefuse('THERA1004', '/evaluator', 'Learning requires a training label or outcome address.');
  if ((task.evaluator === null ? mode !== 'infer' : !equalsJson(task.evaluator, evaluator.identity)) || !equalsJson(snapshot.identities.evaluator, evaluator.identity))
    return heraRefuse('THERA1002', '/evaluator', 'The task, snapshot and scorer must name the same versioned success rule.');
  return {valid:true,value:true};
}
export function validateHeraTaskScore(value: HeraTaskScore): HeraOutcome<HeraTaskScore> {
  if (value?.metrics !== undefined && (value.metrics === null || Array.isArray(value.metrics) || typeof value.metrics !== 'object' || Object.values(value.metrics).some(n=>typeof n!=='number'||!Number.isFinite(n))))
    return heraRefuse('THERA1001', '/score/metrics', 'Evaluator metrics must contain finite numeric measurements.');
  if (value?.primaryScore === null && value.success === null) return {valid:true,value};
  if (typeof value?.primaryScore !== 'number' || !Number.isFinite(value.primaryScore) || value.primaryScore < 0 || value.primaryScore > 1 || typeof value.success !== 'boolean')
    return heraRefuse('THERA1001', '/score', 'An evaluated score requires a finite unit score and boolean success; an unlabelled result requires two nulls.');
  return {valid:true,value};
}
