/** One guarded harness editor over the existing three-skill ledger projection. */
import { createLedger, createMemoryStorage, SKILL_SCHEMA } from '@tangleai/context';
import { JarenValidator } from '@jarenjs/validate';
import { createGuardedRefiner } from '@jarenjs/core/guarded';
import { cloneJson, deepFreeze, equalsJson } from '@jarenjs/core/object';
import { applyJSONPatch, createJSONPatch } from '@jarenjs/json/patch';
import { parseJSONPointer } from '@jarenjs/json/pointer';
import { checkShape, checkTime, forecastBytes } from './schema.ts';
import { forecastRevision, validateForecastRecord } from './identity.ts';
import { issue, reject } from './errors.ts';
import { volatileFactGate, captureVolatileContext, normalizeForecastProcedure, type VolatileContext } from './gate.ts';
import type { HarnessDocument, ForecastHarnessVersion, CommittedGuidance, DeferredGuidance, HarnessRevision, ForecastIssue } from './contracts.gen.ts';

export const HARNESS_COMPONENTS = ['evidenceHandling','factorTracking','uncertaintyHandling'] as const;
export interface HarnessLimits { maxItems: number; maxItemBytes: number; maxOps: number; maxComponents: number; maxGrowthBytes: number; maxComponentBytes: number; maxHarnessBytes: number; maxTraceReads: number; shingle: number; }
export const DEFAULT_HARNESS_LIMITS: Readonly<HarnessLimits> = Object.freeze({ maxItems: 5,maxItemBytes: 512,maxOps: 8,maxComponents: 2,maxGrowthBytes: 512,maxComponentBytes: 4096,maxHarnessBytes: 32768,maxTraceReads: 8,shingle: 8 });
const applicability: Record<keyof HarnessDocument,string> = { evidenceHandling: 'When assessing a source for a forecast.',factorTracking: 'When identifying factors that can change a forecast.',uncertaintyHandling: 'When comparing uncertainty before a forecast.' };
const skillCheck = new JarenValidator({ collectErrors: true }).compile(SKILL_SCHEMA);
const textBytes = (text: string) => new TextEncoder().encode(text).length;
export function checkedHarnessLimits(input: Partial<HarnessLimits> = {}): HarnessLimits {
  if (Object.keys(input).some(k => !Object.hasOwn(DEFAULT_HARNESS_LIMITS,k))) reject('TFCT1001','Unknown harness limit.');
  const result = { ...DEFAULT_HARNESS_LIMITS,...input };
  const bounds = { maxItems: 32,maxItemBytes: 512,maxOps: 32,maxComponents: 3,maxGrowthBytes: 4096,maxComponentBytes: 4096,maxHarnessBytes: 32768,maxTraceReads: 8,shingle: 32 };
  for (const key of Object.keys(result) as (keyof HarnessLimits)[]) if (!Number.isSafeInteger(result[key]) || result[key] < 0 || result[key] > bounds[key]) reject('TFCT1001','Invalid harness limit.','/' + key);
  if (result.shingle < 2) reject('TFCT1001','A copied-evidence shingle requires at least two tokens.','/shingle');
  return Object.freeze(result);
}
export function harnessToSkills(input: HarnessDocument, options: { now: () => string }) {
  const document = checkShape<HarnessDocument>('harnessDocument',input), at = checkTime(options.now());
  return HARNESS_COMPONENTS.map(name => ({ id: 'harness-' + name,name,when: applicability[name],instructions: document[name],tools: [] as string[],at }));
}
export type HarnessSkill = ReturnType<typeof harnessToSkills>[number];
export function skillsToHarness(skills: readonly HarnessSkill[]): HarnessDocument {
  if (!Array.isArray(skills) || skills.length !== 3 || new Set(skills.map(s => s.name)).size !== 3 || skills.some(s => !HARNESS_COMPONENTS.includes(s.name) || !skillCheck(s).valid || s.tools.length)) reject('TFCT1007','A harness has exactly three schema-valid skills without tool grants.','/skills');
  return checkShape('harnessDocument',Object.fromEntries(skills.map(s => [s.name,s.instructions])));
}
export function buildHarnessPatch(skills: readonly HarnessSkill[], items: readonly CommittedGuidance[]) {
  skillsToHarness(skills);
  const next = cloneJson(skills) as HarnessSkill[];
  for (const item of items) {
    const skill = next.find(s => s.name === item.component);
    if (!skill) reject('TFCT1007','Guidance names an unknown harness component.','/component');
    if (!skill.instructions.split('\n').some(line => normalizeForecastProcedure(line) === normalizeForecastProcedure(item.text))) skill.instructions += '\n' + item.text;
  }
  return createJSONPatch({ skills },{ skills: next });
}
export interface HarnessPlan {
  document: HarnessDocument; patch: HarnessRevision['patch']; changed: string[];
  acceptedGuidance: CommittedGuidance[]; deferredGuidance: DeferredGuidance[]; noOp: boolean;
}
export interface SealedHarnessPlan extends HarnessPlan { digest: string; }
export interface HarnessRefinerOptions {
  parent: ForecastHarnessVersion; context: VolatileContext; sources: readonly string[];
  semantic?: HarnessRevision['gate']['semantic']; limits?: Partial<HarnessLimits>; now: () => string;
  gate?: typeof volatileFactGate; commit?: (plan: SealedHarnessPlan) => Promise<unknown>;
}
export const forecastGuidanceRef = (revisionId: string, item: CommittedGuidance) => forecastRevision({ revisionId,component: item.component,text: item.text });
export async function createHarnessRefiner(options: HarnessRefinerOptions) {
  const parent = await validateForecastRecord('harnesses',options.parent), context = captureVolatileContext(options.context), limits = checkedHarnessLimits(options.limits), gate = options.gate ?? volatileFactGate;
  if (parent.questionId && parent.questionId !== context.questionId && parent.status !== 'checked-ref') reject('TFCT1003','The captured harness belongs to another question.');
  if (options.sources.length > 1000 || options.sources.some(id => !/^(note|revision|trace):[a-f0-9]{64}$/.test(id))) reject('TFCT1007','Admission sources require retained record prefixes.','/sources');
  const admitted = new Set(options.sources), semantic = deepFreeze(cloneJson(options.semantic ?? null));
  if (semantic) {
    if (semantic.stage !== 'revision.gate' || !/^[a-f0-9]{64}$/.test(semantic.revision)) reject('TFCT1008','The semantic result must identify its completed revision.gate stage.');
    if (!equalsJson(semantic.result,{ result: 'not-run' })) {
      try { checkShape('volatileFactVerdict',semantic.result); } catch { reject('TFCT1008','The semantic classifier did not retain a complete verdict.'); }
    }
  }
  const ledger = createLedger({ storage: createMemoryStorage(),now: options.now });
  for (const skill of harnessToSkills(parent.document,options)) {
    const added = await ledger.addSkill(skill); if ('error' in added) reject('TFCT1007','The ledger refused a harness skill.','/skills');
  }
  const read = async () => ({ skills: (await ledger.listSkills()).sort((a,b) => a.name.localeCompare(b.name)) as HarnessSkill[] });
  const previous = deepFreeze(await read());
  let active: CommittedGuidance[] = [];
  const guidance = (items: readonly CommittedGuidance[]) => {
    if (!Array.isArray(items) || items.length > limits.maxItems) reject('TFCT1007','Guidance item limit exceeded.','/committedGuidance');
    return items.map((raw,index) => {
      if (!raw || !Array.isArray(raw.sources) || !raw.sources.length || raw.sources.some((id: unknown) => typeof id !== 'string' || !admitted.has(id))) reject('TFCT1007','Guidance cites a dangling or unprefixed source.','/committedGuidance/' + index + '/sources');
      const item = checkShape<CommittedGuidance>('committedGuidance',raw);
      if (textBytes(item.text) > limits.maxItemBytes) reject('TFCT1007','Guidance UTF-8 byte limit exceeded.','/committedGuidance/' + index + '/text');
      const screened = gate(item.text,context,limits.shingle);
      if (!screened.ok) reject('TFCT1008','Guidance contains ' + screened.findings.map(f => f.kind).join(', ') + '.','/committedGuidance/' + index + '/text');
      return item;
    });
  };
  const guarded = createGuardedRefiner({ read,
    validateProposal(patch: unknown) {
      if (!Array.isArray(patch) || patch.length > limits.maxOps) reject('TFCT1007','Harness patch operation limit exceeded.','/patch');
      for (const [i,operation] of patch.entries()) {
        let path: string[]; try { path = parseJSONPointer(operation?.path); } catch { reject('TFCT1007','Invalid harness pointer.','/patch/' + i + '/path'); }
        if (!['add','replace'].includes(operation?.op) || path.length !== 3 || path[0] !== 'skills' || !/^[0-2]$/.test(path[1]) || !['instructions','when'].includes(path[2])) reject('TFCT1007','Harness patch path or operation is forbidden.','/patch/' + i + '/path');
      }
      try { checkShape('harnessPatch',patch); } catch { reject('TFCT1007','Invalid harness patch shape.','/patch'); }
      return true;
    },
    apply: applyJSONPatch,
    applyFailure: () => issue('TFCT1007','The patch does not apply to the captured harness.','/patch'),
    validateCandidate(next: { skills: HarnessSkill[] },before: { skills: HarnessSkill[] }) {
      const document = skillsToHarness(next.skills);
      let changed = 0;
      for (const [i,skill] of next.skills.entries()) {
        const old = before.skills[i];
        if (skill.name !== old.name || skill.id !== old.id || skill.at !== old.at || skill.tools.length) reject('TFCT1007','A patch cannot alter skill identity or grant tools.','/skills/' + i);
        if (!equalsJson(skill,old)) changed++;
        if (textBytes(skill.instructions) > limits.maxComponentBytes || textBytes(skill.instructions) - textBytes(old.instructions) > limits.maxGrowthBytes) reject('TFCT1007','Component byte or growth bound exceeded.','/skills/' + i + '/instructions');
      }
      if (changed > limits.maxComponents || forecastBytes(document) > limits.maxHarnessBytes) reject('TFCT1007','Harness churn or total byte bound exceeded.','/skills');
      guidance(active);
      if (semantic && semantic.result && typeof semantic.result === 'object' && !Array.isArray(semantic.result) && 'verdicts' in semantic.result) {
        const result = checkShape<{ verdicts: { index: number;verdict: string }[] }>('volatileFactVerdict',semantic.result);
        if (result.verdicts.length !== active.length || new Set(result.verdicts.map(v => v.index)).size !== active.length || result.verdicts.some(v => v.index >= active.length)) reject('TFCT1008','The recorded semantic stage does not cover every guidance item.');
        if (result.verdicts.some(v => v.verdict === 'question-specific')) reject('TFCT1008','The recorded semantic stage refuses question-specific guidance.');
      }
      if (!equalsJson(next,applyJSONPatch(before,buildHarnessPatch(before.skills,active)))) reject('TFCT1007','The patch changes bytes not attributable to its cited guidance.','/patch');
      return true;
    },
    planCommit(next: { skills: HarnessSkill[] },before: { skills: HarnessSkill[] }): HarnessPlan {
      const document = skillsToHarness(next.skills), prior = skillsToHarness(before.skills), seen = new Set<string>();
      const acceptedGuidance: CommittedGuidance[] = [], deferredGuidance: DeferredGuidance[] = [];
      for (const item of active) {
        const key = item.component + ':' + normalizeForecastProcedure(item.text), duplicate = seen.has(key) || prior[item.component].split('\n').some(line => normalizeForecastProcedure(line) === normalizeForecastProcedure(item.text)); seen.add(key);
        if (duplicate) deferredGuidance.push({ ...item,reason: 'duplicate-procedure' }); else acceptedGuidance.push(item);
      }
      return { document,patch: createJSONPatch(prior,document).map(op => checkShape('patchOperation',op)),changed: HARNESS_COMPONENTS.filter(key => prior[key] !== document[key]),acceptedGuidance,deferredGuidance,noOp: equalsJson(prior,document) };
    },
    async commit(plan: SealedHarnessPlan, commitContext: { previous: unknown;next: unknown }) {
      const candidate = dryRunGuidance([...plan.acceptedGuidance,...plan.deferredGuidance.map(({reason: _reason,...item}) => item as CommittedGuidance)]);
      const { digest,...claimed } = plan;
      if (!candidate.valid || !equalsJson(candidate.next,commitContext.next) || !equalsJson(commitContext.previous,previous) || !equalsJson(candidate.plan,claimed) || await forecastRevision(plan.document) !== digest) reject('TFCT1007','A commit differs from its guarded preparation.');
      if (plan.noOp) return { status: 'deferred',writes: 0 };
      if (!options.commit) throw new TypeError('Harness preparation has no publication binding.');
      return options.commit(deepFreeze(cloneJson(plan)));
    },
  });
  function dryRunGuidance(items: readonly CommittedGuidance[]) {
    try {
      active = guidance(items);
      return guarded.prepare(previous,buildHarnessPatch(previous.skills,active));
    } catch (error) {
      const known = error as { code?: ForecastIssue['code']; docPath?: string; message?: string };
      return { valid: false as const,errors: [issue(known.code ?? 'TFCT1007',known.message ?? 'Harness guidance refused.',known.docPath)],plan: undefined,next: undefined };
    } finally { active = []; }
  }
  async function prepareGuidance(items: readonly CommittedGuidance[]) {
    const prepared = dryRunGuidance(items);
    return prepared.valid ? { ...prepared,plan: { ...prepared.plan,digest: await forecastRevision(prepared.plan.document) } as SealedHarnessPlan } : prepared;
  }
  return { guarded,previous,limits,dryRunGuidance,prepareGuidance,async commitGuidance(items: readonly CommittedGuidance[]) { return guarded.commitPrepared(previous,await prepareGuidance(items)); } };
}
