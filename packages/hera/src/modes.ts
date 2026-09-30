import { heraRefuse, type HeraOutcome } from './errors.ts';
import type { HeraMode, HeraTask } from './contracts.gen.ts';
export interface HeraAuthority { scope: string; mode: HeraMode; }
const learningKinds = new Set(['agent', 'promptVersion', 'experience', 'advantage', 'promptTrial', 'snapshot', 'head']);
export const isHeraLearningKind = (kind: string): boolean => learningKinds.has(kind);
export function assertLearningWrite(mode: HeraMode, kind: string): HeraOutcome<null> {
  return isHeraLearningKind(kind) && mode !== 'learn'
    ? heraRefuse('THERA1004', '/mode', 'Only learn mode may write learning state.') : { valid: true, value: null };
}
export function assertTaskSplit(task: Pick<HeraTask, 'split'>, mode: HeraMode): HeraOutcome<null> {
  return mode === 'learn' && task.split !== 'training'
    ? heraRefuse('THERA1004', '/split', 'Only training tasks may enter learning.') : { valid: true, value: null };
}
