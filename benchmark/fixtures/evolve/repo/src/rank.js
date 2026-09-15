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

function merge(left, right, count) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    out.push(compare(left[i], right[j], count) <= 0 ? left[i++] : right[j++]);
  }
  while (i < left.length) out.push(left[i++]);
  while (j < right.length) out.push(right[j++]);
  return out;
}

/** A full merge sort: every record is ordered, even the ones nobody reads. */
function sortAll(items, count) {
  if (items.length <= 1) return items.slice();
  const middle = items.length >> 1;
  return merge(sortAll(items.slice(0, middle), count), sortAll(items.slice(middle), count), count);
}

/** The k highest-ranked records, in rank order. */
export function topK(items, k, count = () => {}) {
  if (!Number.isInteger(k) || k < 0) throw new TypeError('k must be a non-negative integer');
  return sortAll(items, count).slice(0, k);
}
