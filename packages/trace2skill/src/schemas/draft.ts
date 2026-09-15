/**
 * The request schema the draft role is held to.
 *
 * A drafted directory is paths and text and nothing else: digests, sizes and
 * addresses are sealed by the importer, so asking a model for them would be
 * asking it to assert an identity nobody can check. It lives beside the other
 * role schemas so the prompt build can read every role's output contract
 * without loading the roles themselves.
 */

/** What a model can actually author: paths and text. */
export const DRAFT_SKILL_SCHEMA = Object.freeze({
  type: 'object',
  required: ['files'],
  additionalProperties: false,
  properties: {
    files: {
      type: 'array',
      minItems: 1,
      maxItems: 16,
      items: {
        type: 'object',
        required: ['path', 'content'],
        additionalProperties: false,
        properties: {
          path: { type: 'string', minLength: 1, maxLength: 512 },
          content: { type: 'string', minLength: 1 },
        },
      },
    },
  },
});
