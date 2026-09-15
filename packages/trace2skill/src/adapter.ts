/**
 * What a host supplies before a skill can be evolved against its domain.
 *
 * The adapter owns five things and deliberately no more: preparing a task's
 * visible inputs, the executor's tool surface, the evaluator, the wider
 * surface an error analyst gets AFTER a failure, and cleanup. The boundary
 * between the last two is the whole point — the executor reaches the task's
 * inputs and nothing else, while a registered answer exists only inside
 * evaluation and a post-failure repair. Every attempt to cross it is a
 * refusal value and a counter the report publishes, so a leak is a number.
 */
import type { Trace2SkillOutcome } from './errors.ts';
import type { EvolutionTask, TaskEvaluation } from './contracts.gen.ts';

/** One tool as the executor or an analyst sees it. */
export interface SkillToolDescriptor { name: string, description: string, scope: 'executor' | 'analyst' }

/** A task's visible inputs. Carries no answer, by construction. */
export interface PreparedSkillTask {
  taskId: string;
  prompt: string;
  inputs: Array<{ path: string, content: string }>;
}

export interface SkillLeakageCounts {
  /** Reads of a registered answer from outside evaluation or repair. */
  leakage: number;
  /** Reads refused because the path is outside the task's inputs. */
  refused: number;
}

export interface SkillExecutorTools { read_file(path: string): Trace2SkillOutcome<string> }

export interface SkillAnalystTools {
  truth_read(): Trace2SkillOutcome<string>;
  output_edit(answer: string): string;
  evaluate(answer: string): Trace2SkillOutcome<TaskEvaluation>;
}

export interface Trace2SkillTaskAdapter {
  id: string;
  revision: string;
  evaluatorId: string;
  toolManifest: readonly SkillToolDescriptor[];
  toolManifestHash: string;
  prepare(taskId: string): Trace2SkillOutcome<PreparedSkillTask>;
  executorTools(taskId: string): SkillExecutorTools;
  evaluate(taskId: string, answer: string): Trace2SkillOutcome<TaskEvaluation>;
  analystTools(taskId: string): SkillAnalystTools;
  cleanup(taskId: string): Promise<void>;
  counts: SkillLeakageCounts;
}

/** Evolve and test ids are disjoint; a default policy never reads the held-out half. */
export function splitIsDisjoint(tasks: readonly EvolutionTask[]): boolean {
  const evolve = new Set(tasks.filter(task => task.split === 'evolve').map(task => task.id));
  return !tasks.some(task => task.split === 'test' && evolve.has(task.id));
}
