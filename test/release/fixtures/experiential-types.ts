import { createExperientialMemoryStore, createExperientialOperations, canaryShareOf, validateExperientialRecord,
  planExperienceTransition, resolveExperientialLineage, createFakeTrainingBackend, planExperientialTraining,
  planExperientialRetention, type ExperientialExperience, type ExperientialSnapshot, type ExperientialStore,
  type ExperientialOperations, type TrainingBackend, type ExperientialRetentionInput } from '@tangleai/experiential';
import { createExperientialContract } from '@tangleai/experiential/contract';
import { createExperientialDbStore, type TangleDb } from '@tangleai/store';
import schema from '@tangleai/experiential/schemas/contract' with { type: 'json' };

declare const db: TangleDb, experience: ExperientialExperience, training: Parameters<typeof planExperientialTraining>[0], retention: ExperientialRetentionInput;
const clock = { now: () => '2026-09-13T00:00:00.000Z' };
const memory = createExperientialMemoryStore(clock), sqlite: ExperientialStore = createExperientialDbStore(db, clock);
const operations: ExperientialOperations = createExperientialOperations(sqlite), backend: TrainingBackend = createFakeTrainingBackend({ seed: 1, clock: () => 0 });
const snapshot = await memory.snapshot('typed');
if (snapshot.ok) { const value: ExperientialSnapshot = snapshot.value; const records: ExperientialExperience[] = value.experiences; void records; }
const share: number = await canaryShareOf('a'.repeat(64), 'typed');
await operations.invoke('experiential.artifacts', { scope: 'typed' });
await resolveExperientialLineage(memory, 'a'.repeat(64));
validateExperientialRecord('experience', experience);
await planExperientialTraining(training); await planExperientialRetention(retention);
void backend; void share; void schema; void createExperientialContract();
// @ts-expect-error experience states are a closed public union
planExperienceTransition(experience, 'invented');
// @ts-expect-error canary identity requires an actual run address
await canaryShareOf('a'.repeat(64), 42);
// @ts-expect-error inspection clients grant no activation method
operations.activate(experience);
await operations.close(); await memory.close();
