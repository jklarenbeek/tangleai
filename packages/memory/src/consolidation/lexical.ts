/** Compatibility names for the shared lexical adapter; scoring lives in core. */
export { lexicalTerms as consolidationTerms, lexicalTermCounts as consolidationTermCounts,
  createLexicalIndex as createConsolidationLexicalIndex, type LexicalDocument } from '@tangleai/core/lexical';
import { fuseReciprocalRanks } from '@tangleai/core/lexical';
/** Preserve the consolidation suite's existing code-point tie order. */
export function fuseConsolidationRanks(ranks: readonly (readonly string[])[], k = 60): string[] {
  return fuseReciprocalRanks(ranks, k, { ties: 'id' }).map(row => row.id);
}
