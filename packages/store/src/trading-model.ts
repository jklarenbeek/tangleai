/** The public trading contract owns validation; SQLite owns keys and transactions. */
const ID = { type: 'string', minLength: 1 } as const;
const collection = () => ({ schema: { type: 'object', required: ['id'], properties: { id: ID, manifestId: ID, kind: ID } }, key: '/id' });
export const TRADING_COLLECTIONS = {
  trading_manifests: collection(), trading_sessions: collection(), trading_observations: collection(), trading_snapshots: collection(),
  trading_artifacts: collection(),
  trading_decisions: { ...collection(), indexes: [{ name: 'by_manifest_session', path: ['$.manifestId', '$.key.sessionId'] }] },
  trading_orders: collection(), trading_fills: collection(), trading_ledger: collection(), trading_portfolios: collection(), trading_results: collection(),
} as const;
