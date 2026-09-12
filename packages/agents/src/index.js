//@ts-check
/** agents: public AI mechanisms over injected Jaren foundations. */
export { createProgramSession, questionFingerprint, DEFAULT_REUSE_THRESHOLD } from './program-session.js';
export { createToolbox, registerModelContext } from './toolbox.js';
export { createAgent, transcriptText } from './agent.js';
export { compileProgram, programGate, createProgramRunner, createProgramAuthor, ProgramError, PROGRAM_EXAMPLE, readProgramAnswer } from './program.js';
export { createLongHorizonAgent, createBudgetAccount, createTrajectory, resolveDepth, childScope, MAX_DEPTH, DEFAULT_DEPTH } from './recursive.js';
export { createRefiner, describeTrajectory } from './refine.js';
export { PROGRAM_SCHEMA, programSchema, PROGRAM_OPS, MAX_STEPS, MAX_PROGRAM_CHARS, NAME_PATTERN } from './schemas/program.js';
/** @typedef {import('./program-result.js').ProgramRunResult} ProgramRunResult */
/** @typedef {import('./program-result.js').ProgramAnswer} ProgramAnswer */
/** @typedef {import('./program-result.js').ProgramStepReport} ProgramStepReport */
/** @typedef {import('./program-result.js').ProgramDiagnostic} ProgramDiagnostic */
