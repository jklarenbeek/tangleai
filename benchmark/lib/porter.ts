/**
 * The Porter stemmer, as NLTK runs it — because that is what the
 * official LoCoMo scorer runs.
 *
 * `task_eval/evaluation.py` stems every token of both sides with
 * `nltk.stem.PorterStemmer()`, whose DEFAULT mode is
 * `NLTK_EXTENSIONS`: not the 1980 paper, not Martin Porter's frozen
 * reference, but NLTK's own variant — an irregular-forms table
 * (`skies`/`dying`/`news`/…), `ies`→`ie` and `ied`→`ie` on four-letter
 * words, a y→i rule that needs a preceding consonant, `alli` stripped
 * before the other step-2 rules and the result re-run, `fulli` and a
 * `logi` rule measured with the `l` kept, and a two-letter `*o` case.
 * A port that picked the paper would differ on a minority of tokens and
 * therefore on the third decimal of every F1, which is exactly the
 * disagreement parity exists to rule out. **This file is that variant,
 * ported branch for branch from `nltk/stem/porter.py` (NLTK 3.10.3),**
 * and `test/fixtures/locomo-parity.json` pins it token by token against
 * the real thing.
 *
 * Two details are deliberate. Python indexes a string by code point and
 * JavaScript by UTF-16 unit, so the port works over an array of code
 * points: an astral character is one consonant here as it is there, and
 * the `*d` double-consonant test compares characters rather than
 * surrogate halves. And the length guard reads the ORIGINAL word, as
 * NLTK's does (`len(word) <= 2` before lower-casing), because `İ`
 * lower-cases to two code points.
 *
 * Reproduced on purpose, not fixed: `_apply_rule_list` stops at the
 * first rule whose SUFFIX matches even when its condition fails — so
 * `feed` stays `feed` — and step 5a tries both `e` conditions.
 */

type Chars = readonly string[];

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

/** NLTK's irregular forms — "the errors actually drawn to Martin Porter's attention over a 20 year period". */
const POOL = new Map<string, string>();
for (const [key, forms] of Object.entries({
  sky: ['sky', 'skies'],
  die: ['dying'],
  lie: ['lying'],
  tie: ['tying'],
  news: ['news'],
  inning: ['innings', 'inning'],
  outing: ['outings', 'outing'],
  canning: ['cannings', 'canning'],
  howe: ['howe'],
  proceed: ['proceed'],
  exceed: ['exceed'],
  succeed: ['succeed'],
})) {
  for (const form of forms) POOL.set(form, key);
}

function isConsonant(word: Chars, i: number): boolean {
  if (VOWELS.has(word[i])) return false;
  if (word[i] === 'y') {
    // a run of y's resolves iteratively, as NLTK does since CWE-674
    let negate = false;
    while (i > 0 && word[i] === 'y') {
      negate = !negate;
      i--;
    }
    return !VOWELS.has(word[i]) !== negate;
  }
  return true;
}

/** One left-to-right pass: `true` is a consonant. */
function consonantFlags(word: Chars): boolean[] {
  const flags: boolean[] = [];
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    if (VOWELS.has(ch)) flags.push(false);
    else if (ch === 'y') flags.push(i === 0 ? true : !flags[i - 1]);
    else flags.push(true);
  }
  return flags;
}

/** The paper's m: the number of `vc` transitions. */
function measure(stem: Chars): number {
  const flags = consonantFlags(stem);
  let m = 0;
  for (let i = 0; i + 1 < flags.length; i++) if (!flags[i] && flags[i + 1]) m++;
  return m;
}

const hasPositiveMeasure = (stem: Chars): boolean => measure(stem) > 0;
const measureGreaterThanOne = (stem: Chars): boolean => measure(stem) > 1;

function containsVowel(stem: Chars): boolean {
  return consonantFlags(stem).some((consonant) => !consonant);
}

/** *d — ends with a double consonant. */
function endsDoubleConsonant(word: Chars): boolean {
  return word.length >= 2
    && word[word.length - 1] === word[word.length - 2]
    && isConsonant(word, word.length - 1);
}

/** *o — ends cvc with the last c not w, x or y; plus NLTK's two-letter case. */
function endsCvc(word: Chars): boolean {
  const n = word.length;
  return (
    n >= 3
    && isConsonant(word, n - 3)
    && !isConsonant(word, n - 2)
    && isConsonant(word, n - 1)
    && !['w', 'x', 'y'].includes(word[n - 1])
  ) || (
    n === 2 && !isConsonant(word, 0) && isConsonant(word, 1)
  );
}

function endsWith(word: Chars, suffix: string): boolean {
  const s = [...suffix];
  if (s.length > word.length) return false;
  for (let i = 0; i < s.length; i++) {
    if (word[word.length - s.length + i] !== s[i]) return false;
  }
  return true;
}

function replaceSuffix(word: Chars, suffix: string, replacement: string): Chars {
  const s = [...suffix];
  return [...word.slice(0, word.length - s.length), ...replacement];
}

type Rule = readonly [suffix: string, replacement: string, condition: ((stem: Chars) => boolean) | null];

/**
 * The first rule whose suffix matches decides — a failed condition
 * returns the word unchanged and tries nothing further. `*d` is the
 * double-consonant pseudo-suffix.
 */
function applyRules(word: Chars, rules: readonly Rule[]): Chars {
  for (const [suffix, replacement, condition] of rules) {
    if (suffix === '*d' && endsDoubleConsonant(word)) {
      const stem = word.slice(0, -2);
      return condition === null || condition(stem) ? [...stem, ...replacement] : word;
    }
    if (endsWith(word, suffix)) {
      const stem = replaceSuffix(word, suffix, '');
      return condition === null || condition(stem) ? [...stem, ...replacement] : word;
    }
  }
  return word;
}

function step1a(word: Chars): Chars {
  // NLTK: 'flies' -> 'fli' but 'dies' -> 'die'
  if (endsWith(word, 'ies') && word.length === 4) return replaceSuffix(word, 'ies', 'ie');
  return applyRules(word, [
    ['sses', 'ss', null],
    ['ies', 'i', null],
    ['ss', 'ss', null],
    ['s', '', null],
  ]);
}

function step1b(word: Chars): Chars {
  // NLTK: 'spied' -> 'spi' but 'died' -> 'die'
  if (endsWith(word, 'ied')) {
    return word.length === 4 ? replaceSuffix(word, 'ied', 'ie') : replaceSuffix(word, 'ied', 'i');
  }
  if (endsWith(word, 'eed')) {
    const stem = replaceSuffix(word, 'eed', '');
    return measure(stem) > 0 ? [...stem, 'e', 'e'] : word;
  }
  let intermediate: Chars | null = null;
  for (const suffix of ['ed', 'ing']) {
    if (endsWith(word, suffix)) {
      const candidate = replaceSuffix(word, suffix, '');
      if (containsVowel(candidate)) { intermediate = candidate; break; }
    }
  }
  if (intermediate === null) return word;
  const last = intermediate[intermediate.length - 1];
  return applyRules(intermediate, [
    ['at', 'ate', null],
    ['bl', 'ble', null],
    ['iz', 'ize', null],
    ['*d', last, () => !['l', 's', 'z'].includes(last)],
    ['', 'e', (stem) => measure(stem) === 1 && endsCvc(stem)],
  ]);
}

function step1c(word: Chars): Chars {
  // NLTK: y -> i only after a consonant, and not on a single-consonant stem
  return applyRules(word, [
    ['y', 'i', (stem) => stem.length > 1 && isConsonant(stem, stem.length - 1)],
  ]);
}

function step2(word: Chars): Chars {
  // NLTK: 'alli' first, and the result goes through step 2 again
  if (endsWith(word, 'alli') && hasPositiveMeasure(replaceSuffix(word, 'alli', ''))) {
    return step2(replaceSuffix(word, 'alli', 'al'));
  }
  return applyRules(word, [
    ['ational', 'ate', hasPositiveMeasure],
    ['tional', 'tion', hasPositiveMeasure],
    ['enci', 'ence', hasPositiveMeasure],
    ['anci', 'ance', hasPositiveMeasure],
    ['izer', 'ize', hasPositiveMeasure],
    ['bli', 'ble', hasPositiveMeasure],
    ['alli', 'al', hasPositiveMeasure],
    ['entli', 'ent', hasPositiveMeasure],
    ['eli', 'e', hasPositiveMeasure],
    ['ousli', 'ous', hasPositiveMeasure],
    ['ization', 'ize', hasPositiveMeasure],
    ['ation', 'ate', hasPositiveMeasure],
    ['ator', 'ate', hasPositiveMeasure],
    ['alism', 'al', hasPositiveMeasure],
    ['iveness', 'ive', hasPositiveMeasure],
    ['fulness', 'ful', hasPositiveMeasure],
    ['ousness', 'ous', hasPositiveMeasure],
    ['aliti', 'al', hasPositiveMeasure],
    ['iviti', 'ive', hasPositiveMeasure],
    ['biliti', 'ble', hasPositiveMeasure],
    ['fulli', 'ful', hasPositiveMeasure],
    // the 'l' of 'logi' -> 'log' is measured with the stem, so 'geo', 'theo' work
    ['logi', 'log', () => hasPositiveMeasure(word.slice(0, -3))],
  ]);
}

function step3(word: Chars): Chars {
  return applyRules(word, [
    ['icate', 'ic', hasPositiveMeasure],
    ['ative', '', hasPositiveMeasure],
    ['alize', 'al', hasPositiveMeasure],
    ['iciti', 'ic', hasPositiveMeasure],
    ['ical', 'ic', hasPositiveMeasure],
    ['ful', '', hasPositiveMeasure],
    ['ness', '', hasPositiveMeasure],
  ]);
}

function step4(word: Chars): Chars {
  return applyRules(word, [
    ['al', '', measureGreaterThanOne],
    ['ance', '', measureGreaterThanOne],
    ['ence', '', measureGreaterThanOne],
    ['er', '', measureGreaterThanOne],
    ['ic', '', measureGreaterThanOne],
    ['able', '', measureGreaterThanOne],
    ['ible', '', measureGreaterThanOne],
    ['ant', '', measureGreaterThanOne],
    ['ement', '', measureGreaterThanOne],
    ['ment', '', measureGreaterThanOne],
    ['ent', '', measureGreaterThanOne],
    ['ion', '', (stem) => measure(stem) > 1 && ['s', 't'].includes(stem[stem.length - 1])],
    ['ou', '', measureGreaterThanOne],
    ['ism', '', measureGreaterThanOne],
    ['ate', '', measureGreaterThanOne],
    ['iti', '', measureGreaterThanOne],
    ['ous', '', measureGreaterThanOne],
    ['ive', '', measureGreaterThanOne],
    ['ize', '', measureGreaterThanOne],
  ]);
}

function step5a(word: Chars): Chars {
  // both conditions are tried — the one place NLTK cannot use its rule list
  if (endsWith(word, 'e')) {
    const stem = replaceSuffix(word, 'e', '');
    if (measure(stem) > 1) return stem;
    if (measure(stem) === 1 && !endsCvc(stem)) return stem;
  }
  return word;
}

function step5b(word: Chars): Chars {
  return applyRules(word, [
    ['ll', 'l', () => measure(word.slice(0, -1)) > 1],
  ]);
}

/**
 * `PorterStemmer().stem(word)` — NLTK 3.10.3, `NLTK_EXTENSIONS`.
 * Lower-cases first (as NLTK does by default), answers the irregular
 * table, leaves words of one or two characters alone, then runs the
 * eight steps.
 */
export function porterStem(word: string): string {
  const lower = word.toLowerCase();
  const pooled = POOL.get(lower);
  if (pooled !== undefined) return pooled;
  if ([...word].length <= 2) return lower;
  let stem: Chars = [...lower];
  stem = step1a(stem);
  stem = step1b(stem);
  stem = step1c(stem);
  stem = step2(stem);
  stem = step3(stem);
  stem = step4(stem);
  stem = step5a(stem);
  stem = step5b(stem);
  return stem.join('');
}
