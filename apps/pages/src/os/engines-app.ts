/**
 * Charts and Collections: Jaren's chart engine fed by a run in this browser,
 * and its virtual collection over rows in memory and in SQLite. (Being built:
 * see TODO_OSAPPS.md, dock parity.)
 */
import type { ShippedMount } from '@tangleai/os/shell';

export const chartsMount: ShippedMount = (node) => { node.classList.add('tos-surface', 'tos-surface-charts'); return () => {}; };
export const collectionsMount: ShippedMount = (node) => { node.classList.add('tos-surface', 'tos-surface-collections'); return () => {}; };
