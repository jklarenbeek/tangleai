/** agents: public AI mechanisms over injected Jaren foundations. */
export { createProgramSession, questionFingerprint, DEFAULT_REUSE_THRESHOLD } from './program-session.ts';
export { createToolbox, registerModelContext } from './toolbox.ts';
export { createAgent, transcriptText } from './agent.ts';
export { compileProgram, programGate, createProgramRunner, createProgramAuthor, ProgramError, PROGRAM_EXAMPLE, readProgramAnswer } from './program.ts';
export { createLongHorizonAgent, createBudgetAccount, createTrajectory, resolveDepth, childScope, MAX_DEPTH, DEFAULT_DEPTH } from './recursive.ts';
export { createRefiner, describeTrajectory } from './refine.ts';
export { PROGRAM_SCHEMA, programSchema, PROGRAM_OPS, MAX_STEPS, MAX_PROGRAM_CHARS, NAME_PATTERN } from './schemas/program.ts';

export type ProgramRunResult = import('./program-result.ts').ProgramRunResult;
export type ProgramAnswer = import('./program-result.ts').ProgramAnswer;
export type ProgramStepReport = import('./program-result.ts').ProgramStepReport;
export type ProgramDiagnostic = import('./program-result.ts').ProgramDiagnostic;
