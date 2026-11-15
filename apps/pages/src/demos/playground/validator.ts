/**
 * The validator boundary: the one place the playground touches compiled
 * artifacts. It is Jaren's play host kit (`@jarenjs/play/host`), composed
 * with the format sets, the form functions and every language pack, so the
 * playground, the Studio and the project host share one runner and one set
 * of catalogs. Everything returned is plain JSON, fit for the app state.
 */

import { createPlayCatalogs, createPlayValidator, localizePlayErrors, PLAY_LOCALES } from '@jarenjs/play/host';
import { stringFormats, numberFormats, dateTimeFormats, jsonFormats } from '@jarenjs/formats';
import { buildFormModel, buildFormViewModel, formChromeLabels } from '@jarenjs/forms';
import { ar, de, es, fr, ja, ko, nl, pt, ru, tr, zhTW } from '@jarenjs/locales';

export { detectDraftName, referencedSchemas } from '@jarenjs/play/host';

/**
 * Every language pack, loaded up front: the site is one bundle, so the
 * Messages switch answers at once rather than waiting on a chunk.
 */
const PACKS = { nl, fr, es, pt, de, ja, ko, 'zh-tw': zhTW, ru, tr, ar };

/** The compiled catalogs of every language the switcher offers. */
export const playCatalogs = createPlayCatalogs();
for (const [code, pack] of Object.entries(PACKS)) playCatalogs.add(code, pack);

/** The runner: a fresh validator per compile, the last compile kept hot for the run, the form and its chrome. */
export const playValidator = createPlayValidator({
  catalogs: playCatalogs,
  formats: [stringFormats, numberFormats, dateTimeFormats, jsonFormats],
  forms: { buildFormModel, buildFormViewModel, formChromeLabels },
});

/** The switcher's locale codes, in display order: English, then every pack. */
export const LOCALES: readonly string[] = PLAY_LOCALES;

/** Compile (cached) and validate, the errors in English as the validator wrote them. */
export const runValidation = (schemaText: any, data: any, schemas: any[] = []): any => playValidator.run(schemaText, data, schemas);

/** The generated form's render tree for the schema and data, its field errors in `locale`. */
export const formViewFor = (schemaText: any, data: any, schemas: any[] = [], locale: string = 'en') => playValidator.formView(schemaText, data, schemas, locale);

/** The generated form's chrome (the array buttons' names and the JSON hint) in `locale`, English when no pack has it. */
export const formLabelsFor = (locale?: string) => playValidator.formLabels(locale);

/** Report-time localization over copies; the text a schema wrote stays as written. */
export const localizeErrors = (errors: any, locale: any) => localizePlayErrors(errors, playCatalogs.catalogFor(locale));
