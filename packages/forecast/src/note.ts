/** Structured reflection over one completed artifact, with no cross-checkpoint inputs. */
import { createStructuredOutput } from '@tangleai/models';
import { createForecastMeter, type ForecastChatClient, type ForecastBudget } from './meter.ts';
import { NOTE_PROMPT, NOTE_SCHEMA, forecastPromptRevisions } from './prompts.ts';
import { forecastRevision, sealForecastRecord, validateForecastRecord } from './identity.ts';
import { checkShape } from './schema.ts';
import { reject } from './errors.ts';
import type { ForecastQuestion, ForecastCheckpoint, ForecastEvidence, ForecastTrace, CheckpointNote, CheckpointFailure } from './contracts.gen.ts';

export interface ForecastNoteArtifact {
  question: ForecastQuestion; checkpoint: ForecastCheckpoint; trace: ForecastTrace;
  evidence: ForecastEvidence[]; finalMessage: { role: string; content: string }; stopReason: 'stop';
}
export function createNoteBuilder(options: { client: ForecastChatClient; now: () => number }) {
  return { async build(input: ForecastNoteArtifact, budget: ForecastBudget, signal?: AbortSignal) {
    // Select fields explicitly: callers cannot smuggle outcomes or earlier notes
    // into the model through structural typing's allowance for extra properties.
    const question = await validateForecastRecord('questions',input.question), checkpoint = await validateForecastRecord('checkpoints',input.checkpoint), trace = await validateForecastRecord('traces',input.trace);
    if (input.stopReason !== 'stop' || checkpoint.questionId !== question.id || trace.checkpointId !== checkpoint.id || input.evidence.some(e => e.checkpointId !== checkpoint.id)) reject('TFCT1003', 'A note describes one stopped checkpoint artifact.');
    const evidence = await Promise.all(input.evidence.filter(e => e.admitted).map(e => validateForecastRecord('evidence',e)));
    const revisions = await forecastPromptRevisions();
    if (checkpoint.noteSchemaRevision !== revisions.noteSchema) reject('TFCT1002', 'The checkpoint pins another note schema.');
    const meter = createForecastMeter(options.client,budget,options.now);
    let note: CheckpointNote | null = null, noteFailure: CheckpointFailure | null = null;
    try {
      const client = { ...meter.client,async complete(request: any) {
        const result = await meter.client.complete(request);
        if (result.finishReason !== 'stop' || result.message.toolCalls?.length) reject('TFCT1001', 'The note provider did not complete a final JSON answer.');
        return result;
      } };
      const builder = createStructuredOutput({ client,schema: NOTE_SCHEMA,name: 'checkpoint_note',maxRepairs: 1 });
      const data = { question: { id: question.id,prompt: question.prompt,adapter: question.adapter },checkpointId: checkpoint.id,cutoffAt: checkpoint.cutoffAt,evidence: evidence.map(e => ({ citationId: e.citationId,excerpt: e.excerpt })),finalMessage: { role: input.finalMessage.role,content: input.finalMessage.content },stopReason: input.stopReason };
      const generated = await builder.generate([{ role: 'system',content: NOTE_PROMPT },{ role: 'user',content: JSON.stringify(data) }],{ signal });
      if (generated.errors) reject('TFCT1001', 'The note did not validate after bounded repair.');
      note = await sealForecastRecord('notes',{ checkpointId: checkpoint.id,configuration: checkpoint.configuration,promptRevision: revisions.note,toolsetRevision: await forecastRevision([]),noteSchemaRevision: revisions.noteSchema,sections: checkShape('noteSections',generated.value),evidenceIds: evidence.map(e => e.id),traceId: trace.id });
    } catch (error) { noteFailure = { code: 'TFCT1001',detail: error instanceof Error ? error.message : 'The note generation failed.' }; }
    return { note,noteFailure,spend: meter.spend(),budgetSpent: meter.budgetSpent(),calls: meter.calls() };
  } };
}
