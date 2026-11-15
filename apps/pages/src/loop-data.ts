/** The memory loop's demo corpus: a near-verbatim repeat, a paraphrase pair, and two rate limits that cannot both be true. */
export const OBSERVATIONS = [
  { text: 'The staging database lives on host db-staging.internal port 5432', evidence: 'ops handbook §3', tags: ['ops'], at: '2026-08-20T09:00:00Z' },
  { text: 'The staging database lives on host db-staging.internal port 5432.', evidence: 'ops handbook §3 (retold)', tags: ['ops'], at: '2026-08-21T09:00:00Z' },
  { text: 'The staging database is on db-staging.internal at port 5432', evidence: 'deploy log 2026-08-22', tags: ['ops'], at: '2026-08-22T10:00:00Z' },
  { text: 'Deploys must run the full gate before shipping', evidence: 'CONTRIBUTING.md', tags: ['ops'], at: '2026-08-22T11:00:00Z' },
  { text: 'The API rate limit is 100 requests per minute', evidence: 'gateway config v1', tags: ['api'], at: '2026-08-19T08:00:00Z' },
  { text: 'The API rate limit is 500 requests per minute', evidence: 'gateway config v2', tags: ['api'], at: '2026-08-23T08:00:00Z' },
];
