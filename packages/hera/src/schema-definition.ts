/** Compose role outputs with GMPL's evidence contract at its existing owner. */
import definition from '../schemas/hera-definition.json' with {type:'json'};
import {gmplSchemaOf} from '@tangleai/gmpl';
const result = gmplSchemaOf('gmplPatternResult');
const defs: Record<string,unknown> = {...definition.$defs,...result.$defs as Record<string,unknown>};
for (const role of ['QueryDecomposer','Retriever','AnswerGenerator','QueryRewriter','EvidenceSelector','ContextValidator','ReflectAgent','ConcludeAgent']) {
  const name = 'hera' + role + 'Output', specific = defs[name] as {properties:Record<string,unknown>;required:string[]};
  defs[name] = {...specific,properties:{...result.properties as Record<string,unknown>,...specific.properties},required:[...result.required as string[],...specific.required]};
}
export const HERA_SCHEMA = {...definition,$defs:defs};
