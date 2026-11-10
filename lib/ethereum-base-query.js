/**
 * One future Dune query for Ethereum and Base.
 * enabled is false and queryId is null, so the refresh job does not call it.
 * A reviewed commit must set both before any scheduled execution.
 */

export const ETHEREUM_BASE_REFRESH = {
  enabled: false,
  queryId: null,
  chains: ['ethereum', 'base'],
  sql: 'sql/candidates/ethereum_base_tokens_transfers_365.sql',
};

export function ethereumBaseJob(config = ETHEREUM_BASE_REFRESH) {
  if (config.enabled !== true) return null;
  if (!Number.isInteger(config.queryId) || config.queryId <= 0) return null;
  return {
    network: 'ethereum_base',
    id: config.queryId,
    splitChains: [...config.chains],
  };
}

/** Keep each chain's rows apart. Rows with no blockchain are dropped. */
export function rowsForChain(rows, chain) {
  const wanted = String(chain || '').toLowerCase();
  return (rows || []).filter(row => String(row?.blockchain || '').toLowerCase() === wanted);
}
