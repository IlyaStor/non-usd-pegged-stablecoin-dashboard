/**
 * Non-executable notes for Dune queries whose SQL is not in this repository.
 * The text names registry identities. It does not invent a source table.
 */

import { QUERIES, FX_FALLBACK } from './series.js';
import { analyticsSymbol, stellarIdentity } from './token-catalog.js';

const BANNER = [
  '-- PENDING — NOT EXECUTABLE.',
  '-- The live query SQL for this chain is not in the repository.',
  '-- Source tables and filters are unverified. Do not run this file.',
  '-- Do not create a new Dune query id. Edit the existing query named below.',
  '-- Do not insert zero-volume history. Days with no transfers stay absent.',
].join('\n');

function fxNote(symbol) {
  const rate = FX_FALLBACK[symbol];
  if (rate == null) {
    return 'fx_usd PENDING. This symbol has no rate in FX_FALLBACK. Do not invent one. The query must emit transfer_volume_usd, or the dashboard stores 0.';
  }
  return `fx_usd ${rate} from FX_FALLBACK.${symbol}. This is the existing dashboard fallback, not a new price feed.`;
}

function suggestedLabel(entry, symbol) {
  const peg = {
    Euro: 'Euro',
    'Swedish Krona': 'Swedish krona',
    'Swiss Franc': 'Swiss franc',
    'Chinese Yuan': 'Chinese yuan',
    Dirham: 'Dirham',
  }[entry.peg] || entry.peg;
  return `${peg} - ${symbol}`;
}

export function renderPendingSql(kind, registry) {
  const entries = registry.entries;
  if (kind === 'polygon') return renderEvm(entries, {
    title: 'Polygon',
    slug: 'polygon',
    ids: QUERIES.polygon,
    skipSymbols: ['EURQ'],
    extra: [
      '-- EURQ is already in the published Polygon series. Do not add another EURQ row.',
      '-- Confirm the saved query already uses registry address 0xd571edb2ef29df10fcd6200fd6d0ed2389983db3 before saving.',
      '-- These two query ids both feed one Polygon series. Add each new contract to exactly one of them.',
      '-- fetch-dune-data.js sums rows that share a symbol and a day, so a contract in both queries double-counts.',
      '-- If that query emits bare tickers, use EURAU, SEKAU, or CHFAU. A "peg - SYMBOL" label is also accepted.',
    ],
  });
  if (kind === 'bsc') return renderEvm(entries, {
    title: 'BNB Chain',
    slug: 'bnb',
    ids: QUERIES.bsc,
    skipSymbols: [],
    extra: [
      '-- EURITE is the product name. The series code must be EURI, not EURITE.',
      '-- EURI is not the Polygon PHT contract. Do not attach this row to PHT.',
    ],
  });
  if (kind === 'solana') return renderSolana(entries);
  if (kind === 'stellar') return renderStellar(entries);
  throw new Error(`unknown pending sql kind ${kind}`);
}

function renderEvm(entries, spec) {
  const rows = entries.filter(entry => entry.chain_slug === spec.slug && !spec.skipSymbols.includes(analyticsSymbol(entry)));
  const lines = [
    BANNER,
    `-- Chain: ${spec.title}. Existing Dune query id(s): ${spec.ids.join(', ')}.`,
    ...spec.extra,
    '--',
    '-- Commented tuple for the existing token list. Remove the leading comment marks only when pasting into that query.',
  ];
  for (const entry of rows) {
    const symbol = analyticsSymbol(entry);
    lines.push(`-- ${symbol} | ${entry.standard} | decimals ${entry.decimals} | ${fxNote(symbol)}`);
    lines.push(`--   address ${entry.address}`);
    lines.push(`--   suggested label: '${suggestedLabel(entry, symbol)}'`);
    if (FX_FALLBACK[symbol] != null) {
      lines.push(`-- ('${suggestedLabel(entry, symbol)}', ${entry.address}, ${entry.decimals}, ${FX_FALLBACK[symbol]}),`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function renderSolana(entries) {
  const rows = entries.filter(entry => entry.chain_slug === 'solana' && analyticsSymbol(entry) !== 'EURCV');
  const lines = [
    BANNER,
    `-- Chain: Solana. Existing Dune query id: ${QUERIES.solana.join(', ')}.`,
    '-- EURCV mint DghpMkatCiUsofbTmid3M3kAbDTPqDwKiYHnudXeGG52 is already in the published Solana series. Do not add it again.',
    '-- Confirm the saved query uses that mint before saving.',
    '-- SEKAU on Solana is not in the verified registry. The candidate issuer address resolved to a program, not a mint. Do not add it.',
    '-- Match the mint standard already used by query 6689171. These mints are Token-2022.',
  ];
  for (const entry of rows) {
    const symbol = analyticsSymbol(entry);
    lines.push(`-- ${symbol} | ${entry.standard} mint ${entry.address} | decimals ${entry.decimals} | ${fxNote(symbol)}`);
    lines.push(`--   suggested series code: ${symbol}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderStellar(entries) {
  const rows = entries.filter(entry => entry.chain_slug === 'stellar');
  const lines = [
    BANNER,
    `-- Chain: Stellar. Existing Dune query id: ${QUERIES.stellar.join(', ')}.`,
    '-- Query 6712377 is not stored here, so it is unknown whether it keys on classic code/issuer or on a contract id.',
    '-- Keep the standard that already matches the query. Do not collapse these four assets into one address column.',
    '-- Classic assets use 7-digit precision. SEP-41 EURAU uses decimals 6.',
    '-- A SAC contract is the Soroban wrapper. It is not the classic issuer.',
  ];
  for (const entry of rows) {
    const symbol = analyticsSymbol(entry);
    const identity = stellarIdentity(entry);
    lines.push(`-- ${symbol} | ${identity.standard} | decimals ${entry.decimals} | ${fxNote(symbol)}`);
    if (identity.asset_code) lines.push(`--   classic asset_code ${identity.asset_code}`);
    if (identity.issuer) lines.push(`--   classic issuer ${identity.issuer}`);
    if (identity.sac_contract) lines.push(`--   SAC contract ${identity.sac_contract}`);
    if (identity.contract) lines.push(`--   SEP-41 contract ${identity.contract}`);
    lines.push(`--   registry address field ${entry.address}`);
    lines.push(`--   suggested series code: ${symbol}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function pendingSqlFiles(registry) {
  return {
    'sql/pending/polygon_token_rows.sql': renderPendingSql('polygon', registry),
    'sql/pending/bsc_token_rows.sql': renderPendingSql('bsc', registry),
    'sql/pending/solana_token_rows.sql': renderPendingSql('solana', registry),
    'sql/pending/stellar_token_rows.sql': renderPendingSql('stellar', registry),
  };
}
