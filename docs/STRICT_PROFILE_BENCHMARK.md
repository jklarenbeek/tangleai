# Strict structured output — the suite's schemas, before and after their profile

**With `anthropic/claude-haiku-5.5` through OpenRouter in strict `json_schema`
mode, the provider refused 3 of 4 of the suite's schemas as they are, and 1 of 4
as their strict profile; every answer to a profile validated against the
original schema (2026-11-18, one request per schema and condition, 8 in all).**

`createStructuredOutput({ profile: 'strict' })` sends the schema's strict
profile (`deriveStrictProfile` from `@jarenjs/validate/strict-profile`: every
object closed, every member required with a `null` placeholder for an optional
one, `anyOf` for `oneOf`, references bundled) with `strict: true`, maps each
answer back and validates it against the original schema, which stays the
authority.

| schema | as it is | as its profile |
|---|---|---|
| grounded answer (`grounding.schema.json#/$defs/groundedAnswer`) | refused: `oneOf` is not supported | refused: the compiled grammar is too large |
| agent program (`programSchema()`) | refused: a schema without a type | valid |
| contradiction verdict | valid | valid |
| a small answer with a `oneOf` and optional members | refused: `oneOf` is not supported | valid |

The profile removes every refusal of a keyword or shape the strict mode does
not carry. The one it leaves is a size limit: the grounded answer's profile is
about 21 KB, and the provider refuses to compile a grammar that large. That
schema stays on the schema-in-prompt tier (`structured: null`), validated
locally.

`node benchmark/strict-profile.ts` derives every profile keyless;
`--live` spends the 8 requests. Report: `benchmark/results/strict-profile-live.json`;
tests validate it and never regenerate it. One model is measured; another
provider's strict subset may accept or refuse different shapes.
