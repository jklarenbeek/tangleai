import { truncate } from '@jarenjs/core/chunk';

/** Jaren's cut length excludes its suffix; this policy bounds the complete text. */
export function boundedForecastText(text: string, max: number): string {
  return text.length <= max ? text : truncate(text,max - 1,'…');
}
