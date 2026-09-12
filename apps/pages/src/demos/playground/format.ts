/** Measured durations and document text for this host's result panels. */
export const now = () => performance.now();
export const formatJson = (value: any) => JSON.stringify(value, null, 2);
export const formatMsUnscaled = (value: any) => `${value.toFixed(2)} ms`;
