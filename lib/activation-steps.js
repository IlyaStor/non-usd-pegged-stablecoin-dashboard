/**
 * Manual Dune steps. Nothing here is a query id this repository may call.
 * Every id is one of the ids already in lib/series.js.
 */

import { QUERIES } from './series.js';

export const ACTIVATION_FACTS = [
  'Do not create a new Dune query id.',
  'Do not insert zero-volume history.',
  'EURQ on Polygon and EURCV on Solana are already in the published series. Do not add a second row.',
  'The series match is by ticker. Confirm the saved query uses the registry address before saving.',
  'Polygon has two query ids. Add each new contract to exactly one of them. Rows for the same symbol and day are summed.',
  'EURITE is the product name. The on-chain ticker and the series code are EURI.',
  'The replaced Polygon EURITE row was PHT Stablecoin. Do not merge EURI into the PHT series.',
  'Stellar classic assets are code plus issuer. A SAC contract is not a classic issuer.',
  'EURAU on Stellar is SEP-41. It is not a classic asset. Its decimals are 6.',
  'XRPL and Xahau decimals are n/a. Do not store a number.',
  'SEKAU on Solana is excluded. The issuer address resolved to a program, not a mint.',
  'Arc rows for EURAU, SEKAU, and CHFAU are already in sql/arc_nonusd_transfers.sql. Do not add them again.',
  'Query 8924650 is not proven updated by this repository. The published series does not contain those symbols.',
  'BRMB has no CNY rate in FX_FALLBACK. Do not invent one.',
  'This pull request does not execute Dune queries.',
];

export const MANUAL_QUERY_EDITS = [
  {
    network: 'polygon',
    ids: QUERIES.polygon,
    symbols: ['EURAU', 'SEKAU', 'CHFAU'],
    file: 'sql/pending/polygon_token_rows.sql',
    mode: 'edit-existing',
  },
  {
    network: 'bsc',
    ids: QUERIES.bsc,
    symbols: ['EURI', 'EURAU'],
    file: 'sql/pending/bsc_token_rows.sql',
    mode: 'edit-existing',
  },
  {
    network: 'solana',
    ids: QUERIES.solana,
    symbols: ['EURAU', 'CHFAU'],
    file: 'sql/pending/solana_token_rows.sql',
    mode: 'edit-existing',
  },
  {
    network: 'stellar',
    ids: QUERIES.stellar,
    symbols: ['EURQ', 'EURCV', 'BRMB', 'EURAU'],
    file: 'sql/pending/stellar_token_rows.sql',
    mode: 'edit-existing',
  },
  {
    network: 'arc',
    ids: QUERIES.arc,
    symbols: ['EURAU', 'SEKAU', 'CHFAU'],
    file: 'sql/arc_nonusd_transfers.sql',
    mode: 'confirm-existing-sql',
  },
];
