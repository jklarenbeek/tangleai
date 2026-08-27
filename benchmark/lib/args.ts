/**
 * Flag parsing for the instruments. Deliberately small: every tool here
 * takes long flags only, an unknown flag is an error rather than a
 * silently ignored typo (a benchmark that ignored `--sizes` and ran the
 * default would publish the wrong row under the right name), and a flag
 * that takes a value refuses an empty one.
 */

export interface ArgSpec {
  /** Flags that take no value. */
  flags?: readonly string[];
  /** Flags that take the next argv entry as their value. */
  values?: readonly string[];
}

export interface ParsedArgs {
  flags: ReadonlySet<string>;
  values: ReadonlyMap<string, string>;
  /** Everything that was not a flag. */
  rest: readonly string[];
}

export function parseArgs(argv: readonly string[], spec: ArgSpec): ParsedArgs {
  const known = new Set(spec.flags ?? []);
  const takesValue = new Set(spec.values ?? []);
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { rest.push(arg); continue; }
    const [name, inline] = arg.slice(2).split('=', 2) as [string, string | undefined];
    if (takesValue.has(name)) {
      const value = inline ?? argv[++i];
      if (value === undefined || value === '') throw new Error(`--${name} needs a value`);
      values.set(name, value);
    } else if (known.has(name)) {
      flags.add(name);
    } else {
      const offered = [...known, ...takesValue].sort().map((n) => `--${n}`).join(', ');
      throw new Error(`unknown flag --${name}; this tool takes ${offered || 'no flags'}`);
    }
  }
  return { flags, values, rest };
}
