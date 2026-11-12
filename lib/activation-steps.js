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
  'Polygon additions EURAU, SEKAU, and CHFAU are only in query 6614895.',
  'EURITE is the product name. The on-chain ticker and the series code are EURI.',
  'The replaced Polygon EURITE row was PHT Stablecoin. Do not merge EURI into the PHT series.',
  'Stellar classic assets are code plus issuer. A SAC contract is not a classic issuer.',
  'Classic Stellar payments are not captured by stellar.history_contract_events.',
  'EURAU on Stellar is SEP-41. It is not a classic asset. Its decimals are 6.',
  'XRPL and Xahau decimals are n/a. Do not store a number.',
  'SEKAU on Solana is excluded. The issuer address resolved to a program, not a mint.',
  'The saved text of query 8924650 already lists EURAU, SEKAU, and CHFAU. The published series does not contain those symbols.',
  'BRMB has no CNY rate in FX_FALLBACK. Do not invent one.',
  'BRMB is excluded from the Stellar result. Do not invent a CNY rate.',
  'This pull request does not execute Dune queries.',
  'Candidate queries are not attached to the refresh job.',
  'A one-day filter does not cap Dune credits.',
  'Do not save a one-day validation query onto a refreshed query id.',
  'Algorand, Xahau, and Adi Chain datasets are unconfirmed. This is not a claim that Dune will never index them.',
  'CHF was not confirmed on Plasma. No CHF placeholder was added.',
  'EURR on Plasma is inactive and was not added.',
  'IDRX is saved on queries 6614895 v24, 8748306 v5, and 6689171 v36. Query 9117254 is the Ethereum and Base refresh.',
];

export const MANUAL_QUERY_EDITS = [
  {
    network: 'polygon',
    ids: QUERIES.polygon,
    symbols: ['EURAU', 'SEKAU', 'CHFAU'],
    file: 'sql/replacements/6614895_polygon.sql',
    mode: 'edit-existing',
    note: 'Add the symbols only in 6614895. sql/replacements/6621899_polygon.sql stays unchanged.',
  },
  {
    network: 'bsc',
    ids: QUERIES.bsc,
    symbols: ['EURI', 'EURAU'],
    file: 'sql/replacements/8748306_bsc.sql',
    mode: 'edit-existing',
  },
  {
    network: 'solana',
    ids: QUERIES.solana,
    symbols: ['EURAU', 'CHFAU'],
    file: 'sql/replacements/6689171_solana.sql',
    mode: 'edit-existing',
  },
  {
    network: 'stellar',
    ids: QUERIES.stellar,
    symbols: ['EURQ', 'EURCV', 'EURAU'],
    file: 'sql/replacements/6712377_stellar.sql',
    mode: 'edit-existing',
  },
  {
    network: 'arc',
    ids: QUERIES.arc,
    symbols: ['EURAU', 'SEKAU', 'CHFAU'],
    file: 'sql/replacements/8924650_arc.sql',
    mode: 'confirm-existing-sql',
  },
];
