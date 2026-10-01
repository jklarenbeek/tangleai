/** Stable graph names; lexical tokenization and prose entailment have different owners. */
export function foldEntityName(text: string): string {
    return text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}
export function foldThemes(themes: readonly string[]): string[] {
    return [...new Set(themes.map(foldEntityName).filter(Boolean))].sort();
}
