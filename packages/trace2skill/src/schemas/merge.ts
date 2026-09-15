/**
 * The request schema one merge group is held to, and the one spelling of a
 * merge decision.
 *
 * A group answers with a single directory patch over the frozen directory
 * and the log of what it did with each proposal it was given. The stored
 * patch keeps that log as lines, because a patch record carries a list of
 * strings and nothing here widens a sealed contract to hold a second copy
 * of what the line already says: `changelogLine` writes one and
 * `changelogActionOf` reads it back, so a fresh run and a replayed one
 * count the same histogram.
 */
import { trace2SkillSchema, trace2SkillSchemaOf } from '../schema.ts';
import type { MergeChangelogAction, MergeChangelogEntry } from '../contracts.gen.ts';

/** One merge group's answer: the merged patch and the decisions behind it. */
export const MERGE_OUTPUT_SCHEMA = trace2SkillSchemaOf('mergeOutput');

/** Every decision a merge may record, in the order the contract declares them. */
export const MERGE_CHANGELOG_ACTIONS: readonly MergeChangelogAction[] =
  Object.freeze([...trace2SkillSchema.$defs.mergeChangelogAction.enum]) as readonly MergeChangelogAction[];

const SEPARATOR = ': ';

/** The one rendering of a decision as a stored line. */
export function changelogLine(entry: MergeChangelogEntry): string {
  return `${entry.action}${SEPARATOR}${entry.detail}`;
}

/** The decision a stored line records, or null when the line is not one. */
export function changelogActionOf(line: string): MergeChangelogAction | null {
  const at = line.indexOf(SEPARATOR);
  if (at < 0) return null;
  const action = line.slice(0, at);
  return MERGE_CHANGELOG_ACTIONS.includes(action as MergeChangelogAction) ? action as MergeChangelogAction : null;
}
