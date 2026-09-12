/** Immutable action documents; execution and semantic validation belong to @tangleai/agents. */
import { DocumentBuilder, optionsOf, snapshot, captureQuery } from '@jarenjs/linq/authoring';
import { LinqBuildError } from './errors.ts';
import type { Json } from '@jarenjs/linq/schema';
import type { ExprBase, UnknownExpr } from '@jarenjs/linq';
export type Query = Json | ((value: UnknownExpr) => ExprBase<unknown> | Json);
export interface ChunkOptions { readonly strategy?: 'size' | 'line' | 'separator'; readonly size?: number; }
export interface GrepOptions { readonly pattern: string; readonly flags?: 'i' | 'm' | 'im' | ''; readonly limit?: number; }
export interface AnswerOptions { readonly chars?: number; }
export interface ReduceOptions { readonly outputSchema?: Json; }
export interface StepOptions {
  chunk: ChunkOptions; grep: GrepOptions; select: { readonly query: Json; };
  stat: {}; peek: {}; map: { readonly prompt: string; }; reduce: { readonly query: Json; } & ReduceOptions; answer: AnswerOptions;
}
export type Operation = keyof StepOptions;
export type Step<K extends Operation, F extends string = string, N extends string = string> = {
  readonly op: K; readonly from: F;
} & (K extends 'answer' ? {} : { readonly as: N; }) & StepOptions[K];
export type StepDocument = { [K in Operation]: Step<K> }[Operation];
export interface ProgramDocument { readonly steps: readonly StepDocument[]; }

type Kind = Exclude<Operation, 'answer'> | 'slot';
type Bindings = Record<string, Kind>;
type Names<B, K extends Kind = Kind> = { [N in keyof B]: B[N] extends K ? N : never }[keyof B] & string;
type Single<B> = Names<B, Exclude<Kind, 'chunk' | 'map'>>;
type Fresh<B, N extends string> = N extends keyof B ? B[N] extends 'slot' ? N : never : N;
type Add<B, N extends string, K extends Kind> = Omit<B, N> & Record<N, K>;
type InputFor<B, K extends Operation> = K extends 'reduce' ? Names<B, 'map'> : K extends 'select' | 'answer' ? Single<B> : Names<B>;
type StepKeys<K extends Operation> = 'op' | 'from' | (K extends 'answer' ? never : 'as') | keyof StepOptions[K];
type CheckStep<B, T extends StepDocument> = Exclude<keyof T, StepKeys<T['op']>> extends never ? T['from'] extends InputFor<B, T['op']>
  ? T extends { readonly as: infer N extends string; } ? N extends Fresh<B, N> ? unknown : never : unknown : never : never;
type AfterStep<B, T extends StepDocument> = T extends { readonly as: infer N extends string; readonly op: infer K extends Kind; } ? Add<B, N, K> : B;

const FIELDS: { [K in Operation]: readonly string[] } = {
  chunk: ['strategy', 'size'], grep: ['pattern', 'flags', 'limit'], select: ['query'],
  stat: [], peek: [], map: ['prompt'], reduce: ['query', 'outputSchema'], answer: ['chars'],
};
function make<K extends Operation, F extends string, N extends string = string>(op: K, from: F, as: N | undefined, options: StepOptions[K]): Step<K, F, N> {
  if (typeof from !== 'string' || !from || (op !== 'answer' && (typeof as !== 'string' || !as)))
    throw new LinqBuildError('JL0101', 'A step needs a source name and, except answer, a result name');
  return snapshot({ op, from, ...(op === 'answer' ? {} : { as }), ...optionsOf(options, FIELDS[op], `${op}()`) }) as Step<K, F, N>;
}
function expression(value: Query): Json {
  // Only the input document is bound; external captures retain the shared JL0104 refusal.
  return (typeof value === 'function' ? captureQuery('program query', [], value, { fold: false }) : value) as Json;
}
export function chunk<const F extends string, const N extends string>(from: F, as: N, options: ChunkOptions = {}): Step<'chunk', F, N> { return make('chunk', from, as, options); }
export function grep<const F extends string, const N extends string>(from: F, as: N, options: GrepOptions): Step<'grep', F, N> { return make('grep', from, as, options); }
export function select<const F extends string, const N extends string>(from: F, as: N, query: Query): Step<'select', F, N> { return make('select', from, as, { query: expression(query) }); }
export function stat<const F extends string, const N extends string>(from: F, as: N): Step<'stat', F, N> { return make('stat', from, as, {}); }
export function peek<const F extends string, const N extends string>(from: F, as: N): Step<'peek', F, N> { return make('peek', from, as, {}); }
export function map<const F extends string, const N extends string>(from: F, as: N, prompt: string): Step<'map', F, N> { return make('map', from, as, { prompt }); }
export function reduce<const F extends string, const N extends string>(from: F, as: N, query: Query, options: ReduceOptions = {}): Step<'reduce', F, N> { return make('reduce', from, as, { query: expression(query), ...optionsOf(options, ['outputSchema'], 'reduce()') }); }
export function answer<const F extends string>(from: F, options: AnswerOptions = {}): Step<'answer', F> { return make('answer', from, undefined, options); }

/** Binding kinds and terminal state are phantom types: neither enters the JSON document. */
export class ProgramBuilder<B extends Bindings = {}, Done extends boolean = false> extends DocumentBuilder<ProgramDocument> {
  declare readonly __bindings: B;
  declare readonly __done: Done;

  step<const T extends StepDocument>(this: ProgramBuilder<B, false>, step: T & CheckStep<B, T>): ProgramBuilder<AfterStep<B, T>, T['op'] extends 'answer' ? true : false> {
    return append(this, step) as unknown as ProgramBuilder<AfterStep<B, T>, T['op'] extends 'answer' ? true : false>;
  }
  chunk<N extends string>(this: ProgramBuilder<B, false>, from: Names<B>, as: Fresh<B, N>, options: ChunkOptions = {}): ProgramBuilder<Add<B, N, 'chunk'>> {
    return append(this, chunk(from, as, options)) as unknown as ProgramBuilder<Add<B, N, 'chunk'>>;
  }
  grep<N extends string>(this: ProgramBuilder<B, false>, from: Names<B>, as: Fresh<B, N>, options: GrepOptions): ProgramBuilder<Add<B, N, 'grep'>> {
    return append(this, grep(from, as, options)) as unknown as ProgramBuilder<Add<B, N, 'grep'>>;
  }
  select<N extends string>(this: ProgramBuilder<B, false>, from: Single<B>, as: Fresh<B, N>, query: Query): ProgramBuilder<Add<B, N, 'select'>> {
    return append(this, select(from, as, query)) as unknown as ProgramBuilder<Add<B, N, 'select'>>;
  }
  stat<N extends string>(this: ProgramBuilder<B, false>, from: Names<B>, as: Fresh<B, N>): ProgramBuilder<Add<B, N, 'stat'>> {
    return append(this, stat(from, as)) as unknown as ProgramBuilder<Add<B, N, 'stat'>>;
  }
  peek<N extends string>(this: ProgramBuilder<B, false>, from: Names<B>, as: Fresh<B, N>): ProgramBuilder<Add<B, N, 'peek'>> {
    return append(this, peek(from, as)) as unknown as ProgramBuilder<Add<B, N, 'peek'>>;
  }
  map<N extends string>(this: ProgramBuilder<B, false>, from: Names<B>, as: Fresh<B, N>, prompt: string): ProgramBuilder<Add<B, N, 'map'>> {
    return append(this, map(from, as, prompt)) as unknown as ProgramBuilder<Add<B, N, 'map'>>;
  }
  reduce<N extends string>(this: ProgramBuilder<B, false>, from: Names<B, 'map'>, as: Fresh<B, N>, query: Query, options: ReduceOptions = {}): ProgramBuilder<Add<B, N, 'reduce'>> {
    return append(this, reduce(from, as, query, options)) as unknown as ProgramBuilder<Add<B, N, 'reduce'>>;
  }
  answer(this: ProgramBuilder<B, false>, from: Single<B>, options: AnswerOptions = {}): ProgramBuilder<B, true> {
    return append(this, answer(from, options)) as unknown as ProgramBuilder<B, true>;
  }
}

/** Input names exist only in the binding type; they never become document members. */
export function program<const S extends readonly string[] = []>(slots: S = [] as unknown as S): ProgramBuilder<Record<S[number], 'slot'>> {
  if (!Array.isArray(slots) || slots.some((name) => typeof name !== 'string' || !name))
    throw new LinqBuildError('JL0101', 'program() takes input slot names');
  return new ProgramBuilder({ steps: [] });
}
/** Raw documents make no binding-order or terminal-state inference. */
export function from(document: ProgramDocument): ProgramBuilder<Record<string, Kind>, boolean> {
  return new ProgramBuilder(document);
}

function append<B extends Bindings, Done extends boolean>(builder: ProgramBuilder<B, Done>, value: StepDocument): ProgramBuilder<B, Done> {
  if (builder.schema.steps.at(-1)?.op === 'answer')
    throw new LinqBuildError('JL0102', 'answer is terminal; start another program to append work');
  if (value === null || typeof value !== 'object' || !Object.hasOwn(FIELDS, value.op))
    throw new LinqBuildError('JL0101', 'step() needs a known program operation');
  const step = optionsOf(value, ['op', 'from', ...(value.op === 'answer' ? [] : ['as']), ...FIELDS[value.op]], 'step()');
  return builder.with({ steps: [...builder.schema.steps, step] });
}
