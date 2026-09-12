/** Independent scoring plus resource identities taken from the actual durable run. */
import manifest from '../fixtures/gmpl/manifest.json' with {type:'json'};
import {contentId,scoreGmplResult} from './gmpl-oracle.ts';
import type {PreparedDrive,driveGmplWorkflow} from './gmpl-runner.ts';
import type {Case,Receipt,Resources} from './gmpl-conformance.types.ts';
export async function measureReceipt(prepared:PreparedDrive,fixture:Case,drive:Awaited<ReturnType<typeof driveGmplWorkflow>>):Promise<Receipt>{
  const output=drive.status==='completed'?(drive.output as {result:unknown}).result:null,scored=scoreGmplResult(fixture,output),run=drive.trace.run,input=(run.input as {input:Case['input']}).input;
  const outputSchema=(prepared.validated.workflow.output.schema as {properties:{result:unknown}}).properties.result;
  const resources:Resources={inputId:await contentId(input),evidenceId:await contentId(input.evidence),provider:'scripted',model:manifest.model,profile:run.profile,configRevision:run.configRegistryRevision!,outputSchemaId:await contentId(outputSchema),scorer:manifest.scorer,caps:run.budget.limits as unknown as Resources['caps'],humanId:await contentId(manifest.primaryHumanResponses)};
  const payload:Omit<Receipt,'receiptId'>={caseId:fixture.id,status:drive.status==='waiting_for_input'?'waiting':drive.status==='completed'&&scored.valid?'valid':'failed',reason:drive.status==='completed'?scored.reason:`MAS ${drive.status}`,utility:scored.utility,citationFidelity:scored.citationFidelity,findingRetention:scored.findingRetention,output:scored.valid?output as Receipt['output']:null,usage:drive.usage,visibility:drive.visibility,events:drive.events,resources};
  return {...payload,receiptId:await contentId(payload)};
}
