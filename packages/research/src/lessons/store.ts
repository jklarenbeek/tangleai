import type { SkillSnapshot } from '@tangleai/trace2skill';
import type { LessonInjection, LessonSetRecord, LessonValidationRun, ResearchLessonScope, ResearchLessonV2 } from '../contracts.gen.ts';
import type { ResearchStoreOutcome } from '../store.ts';

/** Immutable research data. These persistence operations are not model tools. */
export interface LessonStore {
  putProposal(lesson: ResearchLessonV2): Promise<ResearchStoreOutcome<ResearchLessonV2>>;
  get(id: string): Promise<ResearchStoreOutcome<ResearchLessonV2 | null>>;
  list(query?: { scope?: ResearchLessonScope; projectId?: string }): Promise<ResearchStoreOutcome<ResearchLessonV2[]>>;
  putValidation(run: LessonValidationRun): Promise<ResearchStoreOutcome<LessonValidationRun>>;
  getValidation(id: string): Promise<ResearchStoreOutcome<LessonValidationRun | null>>;
  listValidations(scope: ResearchLessonScope): Promise<ResearchStoreOutcome<LessonValidationRun[]>>;
  getSet(id: string): Promise<ResearchStoreOutcome<LessonSetRecord | null>>;
  getInjection(id: string): Promise<ResearchStoreOutcome<LessonInjection | null>>;
  listInjections(projectId: string): Promise<ResearchStoreOutcome<LessonInjection[]>>;
  putProcedure(snapshot: SkillSnapshot): Promise<ResearchStoreOutcome<SkillSnapshot>>;
  getProcedure(id: string): Promise<ResearchStoreOutcome<SkillSnapshot | null>>;
}
