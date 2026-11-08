/**
 * Candidate Dune queries. Nothing here is executed.
 * fetch-dune-data.js reads lib/series.js QUERIES only.
 * enabled stays false until a parent supplies a real query id and a tested result.
 */

import { QUERIES } from './series.js';

export const VALIDATION_DAY = '2026-11-06';
export const VALIDATION_DAY_END = '2026-11-07';
export const VALIDATION_MONTH = '2026-11-01';

export const CANDIDATES = [
  {
    id: 'evm-tokens-transfers',
    chains: ['ethereum', 'base', 'arbitrum', 'optimism'],
    enabled: false,
    queryIds: [],
    attachToRefresh: false,
    canonicalSql: 'sql/candidates/evm_tokens_transfers_365.sql',
    validationSql: 'sql/validation/evm_tokens_transfers_one_day.sql',
    docs: 'https://docs.dune.com/data-catalog/curated/token-transfers/evm/token-transfers',
  },
  {
    id: 'tempo-raw-logs',
    chains: ['tempo'],
    enabled: false,
    queryIds: [],
    attachToRefresh: false,
    canonicalSql: 'sql/candidates/tempo_logs_365.sql',
    validationSql: 'sql/validation/tempo_logs_one_day.sql',
    docs: 'https://docs.dune.com/data-catalog/evm/tempo/raw/logs',
  },
  {
    id: 'xrpl-transfers',
    chains: ['xrpl'],
    enabled: false,
    queryIds: [],
    attachToRefresh: false,
    canonicalSql: 'sql/candidates/xrpl_transfers_365.sql',
    validationSql: 'sql/validation/xrpl_transfers_one_day.sql',
    docs: 'https://docs.dune.com/data-catalog/xrpl/transfers',
  },
];

export const VALIDATION_OF_EXISTING = [
  { queryId: 6614895, file: 'sql/validation/6614895_one_day.sql' },
  { queryId: 6689171, file: 'sql/validation/6689171_one_day.sql' },
  { queryId: 6712377, file: 'sql/validation/6712377_one_day.sql' },
  { queryId: 8748306, file: 'sql/validation/8748306_one_day.sql' },
  { queryId: 6663259, file: 'sql/validation/6663259_one_day.sql' },
];

export const UNCONFIRMED_DATASETS = [
  {
    chain: 'algorand',
    note: 'No public Dune docs page for an Algorand dataset was found. Not called unsupported.',
  },
  {
    chain: 'xahau',
    note: 'No public Dune docs page for Xahau was found. xrpl.transfers is the XRP Ledger, not Xahau.',
  },
  {
    chain: 'adi',
    note: 'No public Dune docs page for Adi Chain was found. Not called unsupported.',
  },
];

/** Ids the refresh job is allowed to execute. Candidates are excluded. */
export function refreshQueryIds() {
  return Object.values(QUERIES).flat();
}

export function enabledCandidateIds() {
  return CANDIDATES.filter(item => item.enabled && item.attachToRefresh).flatMap(item => item.queryIds);
}

/**
 * Split an ad-hoc multichain result. Not used by the refresh job.
 * Rows without a blockchain are dropped rather than merged into one network.
 */
export function groupCandidateRows(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const chain = String(row?.blockchain || '').trim();
    if (!chain) continue;
    if (!grouped.has(chain)) grouped.set(chain, []);
    grouped.get(chain).push(row);
  }
  return grouped;
}
