/**
 * One Dune query for Ethereum and Base: https://dune.com/queries/9117254
 * enabled follows the id. The refresh fetches this id once and splits rows
 * by blockchain into data.ethereum and data.base.
 * Tabs still appear only after data.json contains the series.
 * A full run is about 25 credits. This module does not execute it.
 */

export const ETHEREUM_BASE_QUERY_ID = 9117254;

export const ETHEREUM_BASE_REFRESH = {
  queryId: ETHEREUM_BASE_QUERY_ID,
  enabled: Number.isInteger(ETHEREUM_BASE_QUERY_ID) && ETHEREUM_BASE_QUERY_ID > 0,
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
