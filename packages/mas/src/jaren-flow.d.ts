import '@jarenjs/linq/flow';

// Published JarenJS implements and requires this third argument for durable
// tasks, but its hand-authored flow declarations omit it. Keep this additive
// overload aligned with vendor/jarenjs/packages/linq/src/flow/dag.js.
declare module '@jarenjs/linq/flow' {
  export function task<const Run extends string>(
    run: Run, props: undefined, options: { version: string },
  ): import('@jarenjs/linq/flow').NodeDeclaration<'task', Run>;
}
