/**
 * The fixture's task adapter: what a host has to supply for a domain
 * before a skill can be evolved against it.
 *
 * It owns four things and deliberately no more — preparing a task's
 * visible inputs, the executor's tool surface, the evaluator, and the
 * wider surface an error analyst gets *after* a failure. The boundary
 * between the last two is the whole point: the executor can reach
 * `inputs/` and nothing else, while the registered answer exists only
 * inside evaluation and an analyst's post-failure repair. Every attempt
 * to cross it returns a refusal value and increments a counter that the
 * report publishes, so a leak is a number rather than a silent pass.
 *
 * The fixture-shaped surface below is what the instrument's own rows and
 * refusal probes read. `toTaskAdapter` is the one bridge onto the host
 * contract the skill package executes against, so the leakage counters a
 * row publishes and the counters an executor trips are the same object.
 */

import { canonicalSha256 } from '@jarenjs/json/canonical';
import { trace2SkillRefuse, type PreparedSkillTask, type TaskEvaluation,
  type Trace2SkillOutcome, type Trace2SkillTaskAdapter } from '@tangleai/trace2skill';
import { answerMatches, normalizeAnswer } from './trace2skill-oracle.ts';
import { isRefusal, type LoadedFixture, type Refusal } from './trace2skill-fixture.ts';
import type { TaskDocument, TaskLabel } from './trace2skill.types.ts';

/** One tool as the executor or an analyst sees it. */
export interface ToolDescriptor {
  name: string;
  description: string;
  scope: 'executor' | 'analyst';
}

/** A task's visible inputs. Carries no answer, by construction. */
export interface PreparedTask {
  taskId: string;
  prompt: string;
  inputs: Array<{ path: string, content: string }>;
}

export interface Evaluation {
  label: TaskLabel;
  score: number;
  normalized: string;
}

export interface FixtureAdapterCounts {
  /** Reads of a registered answer from outside evaluation or repair. */
  leakage: number;
  /** Reads refused because the path is outside the task's inputs. */
  refused: number;
}

export interface FixtureAdapter {
  id: string;
  revision: string;
  evaluatorId: string;
  toolManifest: ToolDescriptor[];
  toolManifestHash: string;
  prepare(taskId: string): PreparedTask | Refusal;
  /** The executor's tools: reading a task input, and nothing else. */
  executorTools(taskId: string): { read_file(path: string): string | Refusal };
  /** The evaluator. The only routine place a registered answer is read. */
  evaluate(taskId: string, answer: string): Evaluation | Refusal;
  /** The wider surface an error analyst gets after a failure. */
  analystTools(taskId: string): {
    truth_read(): string | Refusal,
    output_edit(answer: string): string,
    evaluate(answer: string): Evaluation | Refusal,
  };
  counts: FixtureAdapterCounts;
}

const TOOLS: ToolDescriptor[] = [
  { name: 'read_file', description: 'Read one UTF-8 file listed in the task inputs. A path outside inputs/ is refused.', scope: 'executor' },
  { name: 'truth_read', description: 'Read the registered answer of the failed task, inside the repair boundary only.', scope: 'analyst' },
  { name: 'output_edit', description: 'Rewrite the failed answer inside an in-memory overlay of the rollout output.', scope: 'analyst' },
  { name: 'evaluate', description: 'Run the real evaluator over an edited answer and return its verdict.', scope: 'analyst' },
];

/** Build the adapter over a loaded fixture. */
export async function createFixtureAdapter(loaded: LoadedFixture): Promise<FixtureAdapter> {
  const tasks = new Map<string, TaskDocument>(loaded.tasks.map((task) => [task.id, task]));
  const counts: FixtureAdapterCounts = { leakage: 0, refused: 0 };
  const toolManifestHash = await canonicalSha256(TOOLS as unknown as Record<string, unknown>[]);

  const truth = (scope: string, taskId: string): { answer: string, normalized: string } | Refusal => {
    const value = loaded.readTruth(scope, taskId);
    if (isRefusal(value)) {
      if (value.code === 'TT2S1006') counts.leakage++;
      return value;
    }
    return { answer: value.answer, normalized: value.normalized };
  };

  const evaluate = (scope: string, taskId: string, answer: string): Evaluation | Refusal => {
    const registered = truth(scope, taskId);
    if (isRefusal(registered)) return registered;
    const normalized = normalizeAnswer(answer);
    const correct = answerMatches(answer, { id: taskId, ...registered });
    const label: TaskLabel = normalized === '' ? 'unanswered' : correct ? 'correct' : 'incorrect';
    return { label, score: correct ? 1 : 0, normalized };
  };

  return {
    id: 'trace2skill-tabular-fixture',
    revision: loaded.fixture.id,
    evaluatorId: loaded.fixture.evaluator,
    toolManifest: TOOLS,
    toolManifestHash,
    counts,
    prepare(taskId: string): PreparedTask | Refusal {
      const task = tasks.get(taskId);
      if (task === undefined) return { error: `no such task: ${taskId}`, code: 'TT2S1001' };
      const inputs: Array<{ path: string, content: string }> = [];
      for (const path of task.inputs) {
        const content = loaded.readInput(path);
        if (isRefusal(content)) { counts.refused++; return content; }
        inputs.push({ path, content });
      }
      return { taskId, prompt: task.prompt, inputs };
    },
    executorTools(taskId: string) {
      const task = tasks.get(taskId);
      return {
        read_file(path: string): string | Refusal {
          // The executor's whole surface. A truth path is refused here
          // for the same reason any other path is: it is not an input.
          if (task === undefined || !task.inputs.includes(path)) {
            if (path.startsWith('truth/')) {
              counts.leakage++;
              return { error: `ground truth is unreadable from executor`, code: 'TT2S1006' };
            }
            counts.refused++;
            return { error: `${path} is not an input of ${taskId}`, code: 'TT2S1003' };
          }
          const content = loaded.readInput(path);
          if (isRefusal(content)) counts.refused++;
          return content;
        },
      };
    },
    evaluate(taskId: string, answer: string): Evaluation | Refusal {
      return evaluate('evaluate', taskId, answer);
    },
    analystTools(taskId: string) {
      let overlay = '';
      return {
        truth_read(): string | Refusal {
          const registered = truth('error-analyst-repair', taskId);
          return isRefusal(registered) ? registered : registered.answer;
        },
        output_edit(answer: string): string {
          overlay = answer;
          return overlay;
        },
        evaluate(answer: string): Evaluation | Refusal {
          return evaluate('error-analyst-repair', taskId, answer);
        },
      };
    },
  };
}

const carried = <T>(value: T | Refusal, path: string): Trace2SkillOutcome<T> =>
  isRefusal(value) ? trace2SkillRefuse<T>(value.code, path, value.error) : { valid: true, value };

/**
 * The one bridge from the fixture's surface onto the host contract a run
 * executes against. Nothing is re-implemented here: every call lands on the
 * fixture adapter above, so the boundary the report measures and the boundary
 * the executor crosses are the same boundary.
 */
export function toTaskAdapter(adapter: FixtureAdapter): Trace2SkillTaskAdapter {
  const verdict = (value: Evaluation | Refusal, path: string): Trace2SkillOutcome<TaskEvaluation> =>
    isRefusal(value)
      ? trace2SkillRefuse<TaskEvaluation>(value.code, path, value.error)
      : { valid: true, value: { evaluatorId: adapter.evaluatorId, score: value.score, detail: value.label } };
  return {
    id: adapter.id,
    revision: adapter.revision,
    evaluatorId: adapter.evaluatorId,
    toolManifest: adapter.toolManifest.map((tool) => ({ ...tool })),
    toolManifestHash: adapter.toolManifestHash,
    counts: adapter.counts,
    prepare: (taskId: string): Trace2SkillOutcome<PreparedSkillTask> => carried(adapter.prepare(taskId), `/tasks/${taskId}`),
    executorTools(taskId: string) {
      const tools = adapter.executorTools(taskId);
      return { read_file: (path: string): Trace2SkillOutcome<string> => carried(tools.read_file(path), `/inputs/${path}`) };
    },
    evaluate: (taskId: string, answer: string): Trace2SkillOutcome<TaskEvaluation> =>
      verdict(adapter.evaluate(taskId, answer), `/tasks/${taskId}`),
    analystTools(taskId: string) {
      const tools = adapter.analystTools(taskId);
      return {
        truth_read: (): Trace2SkillOutcome<string> => carried(tools.truth_read(), `/truth/${taskId}`),
        output_edit: (answer: string): string => tools.output_edit(answer),
        evaluate: (answer: string): Trace2SkillOutcome<TaskEvaluation> => verdict(tools.evaluate(answer), `/truth/${taskId}`),
      };
    },
    // The fixture sandbox is an in-memory overlay per call; there is nothing
    // left behind to remove, and saying so is the honest implementation.
    cleanup: async (): Promise<void> => undefined,
  };
}
