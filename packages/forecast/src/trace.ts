/** Bound retained native tool steps as well as the rendered transcript. */
import { boundedForecastText } from './text.ts';
import { forecastBytes, DEFAULT_FORECAST_POLICY } from './schema.ts';
import { reject } from './errors.ts';
import { sealForecastRecord } from './identity.ts';

export async function forecastTrace(checkpointId: string, input: { messages: unknown[]; steps: unknown[] }, limits: { maxTraceBytes?: number; maxToolResultChars?: number } = {}) {
  const bound = limits.maxTraceBytes ?? DEFAULT_FORECAST_POLICY.maxTraceBytes, chars = limits.maxToolResultChars ?? 8000;
  if (!Number.isSafeInteger(bound) || bound < 64 || bound > DEFAULT_FORECAST_POLICY.maxTraceBytes || !Number.isSafeInteger(chars) || chars < 1) reject('TFCT1001', 'Invalid forecast trace bounds.');
  let removedChars = 0, removedSteps = 0;
  const bounded = (value: any): any => {
    if (typeof value === 'string') { const text = boundedForecastText(value,chars); removedChars += Math.max(0,value.length - text.length); return text; }
    if (Array.isArray(value)) return value.map(bounded);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined && typeof v !== 'function').map(([k,v]) => [k,bounded(v)]));
    return value ?? null;
  };
  const messages = bounded(input.messages), steps = input.steps.map(step => {
    if (step && typeof step === 'object' && 'result' in step) {
      const raw = JSON.stringify(step.result ?? null);
      if (raw.length > chars) { const result = boundedForecastText(raw,chars); removedChars += raw.length - result.length; return bounded({ ...step,result }); }
    }
    return bounded(step);
  });
  const data = { messages,steps };
  while (forecastBytes(data) > bound || data.steps.length > 10000 || data.messages.length > 10000) {
    if (steps.length) { removedChars += JSON.stringify(steps.shift()).length; removedSteps++; }
    else if (messages.length) removedChars += JSON.stringify(messages.shift()).length;
    else break;
  }
  return sealForecastRecord('traces', { checkpointId,...data,bytes: forecastBytes(data),truncated: { steps: removedSteps,chars: removedChars } });
}
