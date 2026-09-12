/** Measured durations and document text for this host's result panels. */
export const now = () => performance.now();
export const formatJson = value => JSON.stringify(value, null, 2);
export const formatMsUnscaled = value => `${value.toFixed(2)} ms`;
