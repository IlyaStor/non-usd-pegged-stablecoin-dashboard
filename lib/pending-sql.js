/**
 * The commented drafts are superseded by sql/replacements/.
 * Those files are full query text built from the saved Dune SQL.
 * They are still not executed by this repository.
 */

export function pendingSqlFiles() {
  const note = (file) => [
    '-- SUPERSEDED — NOT EXECUTABLE.',
    `-- The full replacement query is ${file}.`,
    '-- Do not create a new Dune query id.',
    '-- Do not insert zero-volume history.',
    '',
  ].join('\n');
  return {
    'sql/pending/polygon_token_rows.sql': note('sql/replacements/6614895_polygon.sql'),
    'sql/pending/bsc_token_rows.sql': note('sql/replacements/8748306_bsc.sql'),
    'sql/pending/solana_token_rows.sql': note('sql/replacements/6689171_solana.sql'),
    'sql/pending/stellar_token_rows.sql': note('sql/replacements/6712377_stellar.sql'),
  };
}
