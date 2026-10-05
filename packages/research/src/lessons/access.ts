/** Package-private authority binding; public record puts cannot stage candidates. */
import type { SkillSnapshot } from '@tangleai/trace2skill';
import type { LessonValidationRun, ResearchLessonV2 } from '../contracts.gen.ts';
import type { ResearchTransaction } from '../store.ts';
import type { LessonPersistenceHost } from './store-policy.ts';
import type { LessonStore } from './store.ts';

export interface LessonStoreAccess extends LessonPersistenceHost {
  proposal(tx: ResearchTransaction, id: string): Promise<ResearchLessonV2 | null>;
  origin(tx: ResearchTransaction, lesson: ResearchLessonV2): Promise<void>;
  validation(tx: ResearchTransaction, run: LessonValidationRun): Promise<LessonValidationRun>;
  procedure(snapshot: SkillSnapshot): Promise<SkillSnapshot>;
  storedProcedure(tx: ResearchTransaction, id: string, required?: boolean): Promise<SkillSnapshot | null>;
}
const owners = new WeakMap<LessonStore, LessonStoreAccess>();
export function bindLessonStore(store: LessonStore, access: LessonStoreAccess): void {
  if (owners.has(store)) throw new TypeError('A lesson store already has an authority owner.');
  owners.set(store, access);
}
export function lessonStoreAccess(store: LessonStore): LessonStoreAccess {
  const access = owners.get(store);
  if (!access) throw new TypeError('Guarded lessons require a supported research store.');
  return access;
}
