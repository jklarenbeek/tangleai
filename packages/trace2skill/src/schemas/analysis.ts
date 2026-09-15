/**
 * The request schemas the two analyst roles are held to.
 *
 * Each one is the closed contract of the same document the store validates,
 * bundled with only the definitions it reaches — so a role's request carries
 * the shape of its own answer and no unrelated schema. They are read from the
 * canonical document rather than re-spelled here: a second spelling of a
 * contract is a second answer to what the contract says.
 */
import { trace2SkillSchema, trace2SkillSchemaOf } from '../schema.ts';
import type { AnalystExclusion } from '../contracts.gen.ts';

/** One successful trajectory's lesson, returned in a single pass. */
export const SUCCESS_ANALYSIS_SCHEMA = trace2SkillSchemaOf('successAnalysis');

/** One failure's terminal explanation, carried by the error analyst's proposal. */
export const ERROR_DIAGNOSIS_SCHEMA = trace2SkillSchemaOf('errorDiagnosis');

/** A patch as a role writes it, before the dispatcher seals its identity. */
export const AUTHORED_PATCH_SCHEMA = trace2SkillSchemaOf('authoredPatch');

/** The error analyst's terminal call: the patch it wants stored, and the diagnosis that must hold. */
export const ERROR_PROPOSAL_SCHEMA = trace2SkillSchemaOf('errorProposal');

/** Every reason an analyst may emit no patch, in the order the contract declares them. */
export const ANALYST_EXCLUSIONS: readonly AnalystExclusion[] =
  Object.freeze([...trace2SkillSchema.$defs.analystExclusion.enum]) as readonly AnalystExclusion[];
