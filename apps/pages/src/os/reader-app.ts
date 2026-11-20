/**
 * Docs and Benchmarks: Tangle's own documentation and its generated benchmark
 * reports, read in a window. (Being built: see TODO_OSAPPS.md, dock parity.)
 */
import type { ShippedMount } from '@tangleai/os/shell';

export const docsMount: ShippedMount = (node) => { node.classList.add('tos-surface', 'tos-surface-docs'); return () => {}; };
export const benchmarksMount: ShippedMount = (node) => { node.classList.add('tos-surface', 'tos-surface-benchmarks'); return () => {}; };
