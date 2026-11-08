-- VALIDATION ONLY. Completed UTC day 2026-11-06. Not a refresh query.
-- Do not save this text onto a query id that the refresh workflow runs.
-- A one-day filter does not cap Dune credits. block_month is the documented
-- partition key for tokens_evm.transfers. Pruning is not guaranteed.
-- This repository does not execute this file.
-- Docs: https://docs.dune.com/data-catalog/curated/token-transfers/evm/token-transfers
-- amount is already decimal-adjusted. decimals in the token list are the
-- registry values and are not applied again.
-- Confirm blockchain strings on this run before considering the 365-day file.

WITH tokens AS (
    SELECT * FROM (VALUES
        ('ethereum', 0x8dF723295214Ea6f21026eeEb4382d475f146F9f, 'Euro - EURQ', 6, 1.1206),
        ('ethereum', 0x5F7827FDeb7c20b443265Fc2F40845B715385Ff2, 'Euro - EURCV', 18, 1.1206),
        ('ethereum', 0x9d1A7A3191102e9F900Faa10540837ba84dCBAE7, 'Euro - EURI', 18, 1.1206),
        ('ethereum', 0x4933a85b5b5466fbaf179f72d3de273c287ec2c2, 'Euro - EURAU', 6, 1.1206),
        ('ethereum', 0x0297B579B0CB603B5eE814EB7322b960D3ae7A66, 'Swedish krona - SEKAU', 6, 0.100345),
        ('ethereum', 0xbd4dfc058eb95b8de5ceaf39966a1a70f5556f78, 'Swiss franc - CHFAU', 6, 1.20326),
        ('base', 0x4933a85b5b5466fbaf179f72d3de273c287ec2c2, 'Euro - EURAU', 6, 1.1206),
        ('base', 0x0297B579B0CB603B5eE814EB7322b960D3ae7A66, 'Swedish krona - SEKAU', 6, 0.100345),
        ('base', 0xbd4dfc058eb95b8de5ceaf39966a1a70f5556f78, 'Swiss franc - CHFAU', 6, 1.20326),
        ('arbitrum', 0x4933a85b5b5466fbaf179f72d3de273c287ec2c2, 'Euro - EURAU', 6, 1.1206),
        ('optimism', 0x4933a85b5b5466fbaf179f72d3de273c287ec2c2, 'Euro - EURAU', 6, 1.1206)
    ) AS t (blockchain, contract_address, token, decimals, fallback_price)
)
SELECT
    tr.blockchain,
    tr.block_date AS date,
    t.token,
    COUNT(DISTINCT tr.tx_hash) AS daily_transactions,
    SUM(tr.amount) AS transfer_volume,
    SUM(CASE WHEN tr.amount_usd IS NULL THEN tr.amount * t.fallback_price ELSE tr.amount_usd END) AS transfer_volume_usd
FROM tokens_evm.transfers tr
JOIN tokens t
  ON tr.blockchain = t.blockchain
 AND tr.contract_address = t.contract_address
WHERE tr.token_standard = 'erc20'
  AND tr.block_month = DATE '2026-11-01'
  AND tr.block_date = DATE '2026-11-06'
  AND tr.amount > 0
  AND tr."from" != 0x0000000000000000000000000000000000000000
  AND tr."to" NOT IN (
      0x0000000000000000000000000000000000000000,
      0x000000000000000000000000000000000000dead
  )
  AND tr."from" != tr."to"
GROUP BY 1, 2, 3
ORDER BY 1, 2 DESC, 3
