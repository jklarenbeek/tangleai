/**
 * Top-k selection over score records, with the work it does made visible.
 *
 * `count` is an injected comparison counter: every comparison this module
 * makes goes through it, so the cost of an implementation is a property of
 * this file and not of the engine's built-in sort. That is what makes the
 * fitness number reproducible on any host and any runtime.
 */

/** Descending by score, ascending by id — a total order over the records. */
export function compare(a, b, count) {
  count();
  if (a.score !== b.score) return b.score - a.score;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Place one record in an already-ranked list, searching from the back. */
function place(ranked, item, count) {
  let index = ranked.length;
  while (index > 0 && compare(item, ranked[index - 1], count) < 0) index -= 1;
  ranked.splice(index, 0, item);
}

/**
 * The k highest-ranked records, in rank order. Only the leading k are ever
 * ordered: a record that cannot reach the running k-th place costs one
 * comparison and is dropped.
 */
export function topK(items, k, count = () => {}) {
  if (!Number.isInteger(k) || k < 0) throw new TypeError('k must be a non-negative integer');
  if (k === 0) return [];
  const ranked = [];
  for (const item of items) {
    if (ranked.length < k) { place(ranked, item, count); continue; }
    if (compare(item, ranked[k - 1], count) >= 0) continue;
    ranked.pop();
    place(ranked, item, count);
  }
  return ranked;
}
