/**
 * Verified token catalog vs the series data.json actually publishes.
 *
 * Registry rows are identities. They are not transfer history. A row is "live"
 * only when its analytics symbol is already in that network's published pipe.
 * Query ids come from lib/series.js. This module does not add networks or ids.
 */

import { QUERIES } from './series.js';

/** Dashboard network for a registry chain slug. null means no query and no tab. */
export const DASHBOARD_NETWORK_BY_SLUG = {
  polygon: 'polygon',
  stellar: 'stellar',
  solana: 'solana',
  bnb: 'bsc',
  arc: 'arc',
  ethereum: null,
  algorand: null,
  xrpl: null,
  xahau: null,
  adi: null,
  base: null,
  arbitrum: null,
  optimism: null,
  tempo: null,
};

export const STATUS = {
  LIVE: 'live',
  LISTED_IN_REPO_SQL: 'listed_in_repo_sql',
  PENDING_DUNE: 'pending_dune',
  BLOCKED_NO_FX: 'blocked_no_fx',
  UNSUPPORTED_CHAIN: 'unsupported_chain',
};

/** Verified, but the replacement SQL must not invent a USD rate. */
export const USD_BLOCKED = [
  {
    chain_slug: 'stellar',
    token: 'BRMB',
    sac: 'CBD67SY7LMNGXVELAAAUX7LHADZFJ4CK6BHYW36XBHCDNHQP5QO3AKXR',
  },
];

const ISSUED_CURRENCY = new Set(['XRPL issued currency', 'Xahau issued currency']);

export function analyticsSymbol(entry) {
  return String(entry.onchain_symbol || entry.token || '').trim();
}

export function dashboardNetwork(entry) {
  if (!Object.prototype.hasOwnProperty.call(DASHBOARD_NETWORK_BY_SLUG, entry.chain_slug)) return null;
  return DASHBOARD_NETWORK_BY_SLUG[entry.chain_slug];
}

export function symbolsInPipe(pipe, cutoffDay) {
  const symbols = new Set();
  for (const line of String(pipe || '').split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('|');
    const day = parts[0];
    if (cutoffDay && day >= cutoffDay) continue;
    for (let i = 1; i + 2 < parts.length; i += 3) {
      if (parts[i]) symbols.add(parts[i]);
    }
  }
  return symbols;
}

export function symbolsByNetwork(data, executions, networks = Object.keys(QUERIES)) {
  const map = new Map();
  for (const network of networks) {
    const iso = executions?.[network]?.execution_ended_at;
    const cutoff = typeof iso === 'string' ? iso.slice(0, 10) : null;
    map.set(network, symbolsInPipe(data?.[network], cutoff));
  }
  return map;
}

/** Contract rows in a Dune SQL token list. Comment lines are ignored. */
export function sqlTokenRows(sql) {
  const code = String(sql || '')
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');
  const rows = [];
  const re = /\(\s*'([^']*)'\s*,\s*(0x[0-9a-fA-F]{40})\s*,\s*(\d+)\s*,/g;
  let match;
  while ((match = re.exec(code))) {
    rows.push({ label: match[1], address: match[2], decimals: Number(match[3]) });
  }
  return rows;
}

export function arcContractsFromSql(sql) {
  return new Set(sqlTokenRows(sql).map(row => row.address.toLowerCase()));
}

export function stellarIdentity(entry) {
  if (entry.chain_slug !== 'stellar') return null;
  if (entry.standard === 'SEP-41') {
    return {
      standard: entry.standard,
      contract: entry.address,
      asset_code: null,
      issuer: null,
      sac_contract: null,
    };
  }
  if (entry.standard === 'Stellar classic asset') {
    return {
      standard: entry.standard,
      contract: null,
      asset_code: entry.asset_code || null,
      issuer: entry.issuer || null,
      sac_contract: entry.sac_contract || null,
    };
  }
  if (entry.standard === 'Stellar classic asset + SAC') {
    return {
      standard: entry.standard,
      contract: null,
      asset_code: entry.asset_code || null,
      issuer: entry.issuer || null,
      sac_contract: entry.address,
    };
  }
  return {
    standard: entry.standard || null,
    contract: null,
    asset_code: entry.asset_code || null,
    issuer: entry.issuer || null,
    sac_contract: entry.sac_contract || null,
  };
}

function entryKey(entry) {
  const address = String(entry.address || '');
  const normalized = address.startsWith('0x') || address.startsWith('0X')
    ? address.toLowerCase()
    : address;
  return `${entry.chain_slug}|${entry.token}|${normalized}`;
}

export function registryIssues(registry) {
  const issues = [];
  const entries = registry?.entries;
  if (!Array.isArray(entries)) {
    issues.push('registry.entries is missing');
    return issues;
  }
  const seen = new Set();
  const rows = new Set();
  for (const entry of entries) {
    const key = entryKey(entry);
    if (seen.has(key)) issues.push(`duplicate entry ${key}`);
    seen.add(key);
    if (rows.has(entry.sheet_row)) issues.push(`duplicate sheet row ${entry.sheet_row}`);
    rows.add(entry.sheet_row);
    if (!Object.prototype.hasOwnProperty.call(DASHBOARD_NETWORK_BY_SLUG, entry.chain_slug)) {
      issues.push(`unknown chain slug ${entry.chain_slug} on row ${entry.sheet_row}`);
    }
    const symbol = analyticsSymbol(entry);
    if (!symbol) issues.push(`missing symbol on row ${entry.sheet_row}`);
    if (entry.token === 'EURITE' && entry.onchain_symbol !== 'EURI') {
      issues.push(`EURITE row ${entry.sheet_row} must keep on-chain ticker EURI`);
    }
    if (ISSUED_CURRENCY.has(entry.standard)) {
      if (entry.decimals !== 'n/a') issues.push(`row ${entry.sheet_row} decimals must stay n/a`);
      if (typeof entry.decimals === 'number') issues.push(`row ${entry.sheet_row} decimals must not be numeric`);
    } else if (typeof entry.decimals !== 'number') {
      issues.push(`row ${entry.sheet_row} decimals must be a number`);
    }
    const stellar = stellarIdentity(entry);
    if (entry.chain_slug === 'stellar') {
      if (entry.standard === 'SEP-41' && (entry.asset_code || entry.issuer)) {
        issues.push(`SEP-41 row ${entry.sheet_row} must not carry a classic code or issuer`);
      }
      if (entry.standard === 'Stellar classic asset' && entry.address !== entry.issuer) {
        issues.push(`classic Stellar row ${entry.sheet_row} address must be the issuer`);
      }
      if (entry.standard === 'Stellar classic asset + SAC' && entry.address === entry.issuer) {
        issues.push(`SAC row ${entry.sheet_row} address must be the contract, not the issuer`);
      }
      if (!stellar) issues.push(`row ${entry.sheet_row} is missing a Stellar identity`);
    }
  }
  return issues;
}

function statusDetail(row) {
  const symbol = row.analyticsSymbol;
  const address = row.address;
  if (row.status === STATUS.LIVE) {
    return `Symbol ${symbol} is already in the published ${row.dashboardNetwork} series. The match is by ticker. The series does not prove the query stores ${address}. Do not add a second row.`;
  }
  if (row.status === STATUS.LISTED_IN_REPO_SQL) {
    const id = row.queryIds.join(', ');
    return `Contract ${address} is already in the saved text of query ${id}. The published series does not contain ${symbol}. SQL presence is not a series row. No zero-filled history was added.`;
  }
  if (row.status === STATUS.BLOCKED_NO_FX) {
    const sac = row.stellar?.sac_contract || address;
    return `SAC ${sac} is verified. The Stellar query reads Soroban contract events only, and there is no sourced CNY rate. The replacement SQL does not emit ${symbol}. A 0 or 1 rate is not used. Classic payments are outside that query.`;
  }
  if (row.status === STATUS.PENDING_DUNE) {
    const ids = row.queryIds.join(', ');
    const which = row.queryIds.length > 1
      ? `Replacement SQL adds this contract in query 6614895 only. Queries ${ids} are summed by symbol and day.`
      : `Replacement SQL is prepared for query ${ids}.`;
    const stellar = row.stellar;
    const stellarNote = stellar
      ? ` Stellar standard ${stellar.standard} stays intact. Classic payments are not in stellar.history_contract_events.`
      : '';
    return `${which} It is not saved on Dune and not in the published series. Do not create a new query id.${stellarNote}`;
  }
  return `${row.network} has no Dune query id in this repository and no dashboard tab. The row is catalog metadata only.`;
}

export function classifyEntry(entry, { liveSymbols, arcContracts }) {
  const network = dashboardNetwork(entry);
  const symbol = analyticsSymbol(entry);
  const known = Object.prototype.hasOwnProperty.call(DASHBOARD_NETWORK_BY_SLUG, entry.chain_slug);
  const queryIds = network ? [...(QUERIES[network] || [])] : [];
  const published = network ? liveSymbols.get(network) : null;
  const inSeries = Boolean(published && published.has(symbol));
  const inArcSql = network === 'arc' && arcContracts.has(String(entry.address || '').toLowerCase());
  const usdBlocked = USD_BLOCKED.some(item => item.chain_slug === entry.chain_slug && item.token === entry.token);
  let status = STATUS.UNSUPPORTED_CHAIN;
  if (!known) status = STATUS.UNSUPPORTED_CHAIN;
  else if (inSeries) status = STATUS.LIVE;
  else if (inArcSql) status = STATUS.LISTED_IN_REPO_SQL;
  else if (usdBlocked) status = STATUS.BLOCKED_NO_FX;
  else if (network) status = STATUS.PENDING_DUNE;

  const row = {
    sheetRow: entry.sheet_row,
    token: entry.token,
    network: entry.network,
    chainSlug: entry.chain_slug,
    dashboardNetwork: network,
    analyticsSymbol: symbol,
    productName: entry.token,
    standard: entry.standard,
    decimals: entry.decimals,
    address: entry.address,
    explorer: entry.explorer || null,
    peg: entry.peg,
    status,
    queryIds,
    stellar: stellarIdentity(entry),
    currencyCodeHex: entry.currency_code_hex || null,
    issuer: entry.issuer || null,
  };
  row.detail = statusDetail(row);
  return row;
}

export function catalogSentence(summary) {
  return `${summary.entries} verified token-network entries (${summary.tokens} tokens): ${summary.live} already in the published series, ${summary.listedInRepoSql} listed in the saved Arc query but absent from that series, ${summary.pendingDune} in replacement SQL that is not yet the published series, ${summary.blockedNoFx} blocked with no sourced USD rate, ${summary.unsupported} on chains this dashboard does not query.`;
}

export function buildCatalogReport({ registry, data, executions, arcSql }) {
  const entries = Array.isArray(registry?.entries) ? registry.entries : [];
  const liveSymbols = symbolsByNetwork(data, executions);
  const arcContracts = arcContractsFromSql(arcSql);
  const rows = entries.map(entry => classifyEntry(entry, { liveSymbols, arcContracts }));
  const tokens = new Set(entries.map(entry => entry.token));
  const summary = {
    entries: entries.length,
    tokens: tokens.size,
    live: rows.filter(row => row.status === STATUS.LIVE).length,
    listedInRepoSql: rows.filter(row => row.status === STATUS.LISTED_IN_REPO_SQL).length,
    pendingDune: rows.filter(row => row.status === STATUS.PENDING_DUNE).length,
    blockedNoFx: rows.filter(row => row.status === STATUS.BLOCKED_NO_FX).length,
    unsupported: rows.filter(row => row.status === STATUS.UNSUPPORTED_CHAIN).length,
  };
  summary.notInPublishedSeries = summary.entries - summary.live;
  summary.sentence = catalogSentence(summary);
  return {
    rows,
    summary,
    issues: registryIssues(registry),
    exclusions: Array.isArray(registry?.exclusions) ? registry.exclusions : [],
    queries: QUERIES,
  };
}
