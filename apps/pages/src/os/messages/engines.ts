/**
 * The sentences of the Charts and Collections applications, in English and in every
 * pack, kept beside those applications so the catalogue grows in one place.
 * `../messages.ts` spreads the English into the catalogue and `../packs.ts`
 * spreads each language into its pack; the language spec holds every key to
 * the same rules as the rest of the catalogue.
 */
export const enginesEn = {
} as const;

/** The same keys, per language (formal register), each a string or a closure over the entry's parameters. */
export const enginesPacks: Record<'ar' | 'de' | 'es' | 'fr' | 'ja' | 'ko' | 'nl' | 'pt' | 'ru' | 'tr' | 'zh-TW', Partial<Record<keyof typeof enginesEn, string | ((params: any) => string)>>> = {
  ar: {}, de: {}, es: {}, fr: {}, ja: {}, ko: {}, nl: {}, pt: {}, ru: {}, tr: {}, 'zh-TW': {},
};
