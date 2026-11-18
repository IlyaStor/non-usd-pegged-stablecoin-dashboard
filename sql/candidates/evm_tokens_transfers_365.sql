-- NOT THE CREATE TARGET. The Nov 6 2026 test showed rows only on Ethereum and Base.
-- The file to create is sql/candidates/ethereum_base_tokens_transfers_365.sql.
-- CANONICAL WINDOW. Not a saved query and not attached to the refresh job.
-- This repository does not execute this file. A 365-day scan of
-- tokens_evm.transfers is the historical query, not the validation query.
-- One execution does not guarantee a low credit cost. block_month is the
-- documented partition key; pruning is not guaranteed.
-- Docs: https://docs.dune.com/data-catalog/curated/token-transfers/evm/token-transfers
-- Blockchain names ethereum, base, arbitrum, optimism match the public catalog
-- and the spellbook EVM chain list. Confirm them on the one-day file first.
-- amount is already decimal-adjusted. Do not divide it again.
-- amount_usd is null when Coinpaprika has no price. The fallback is FX_FALLBACK
-- from lib/series.js, and only then. Null is not stored as zero here.
-- The result has a blockchain column. Do not paste it into one network query:
-- the same symbol on two chains would be summed.

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
        ('base', 0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22, 'Indonesian Rupiah - IDRX', 2, 0.000061),
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
  AND tr.block_month >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '12' MONTH
  AND tr.block_time >= CURRENT_DATE - INTERVAL '365' DAY
  AND tr.amount > 0
  AND tr."from" != 0x0000000000000000000000000000000000000000
  AND tr."to" NOT IN (
      0x0000000000000000000000000000000000000000,
      0x000000000000000000000000000000000000dead
  )
  AND tr."from" != tr."to"
GROUP BY 1, 2, 3
ORDER BY 1, 2 DESC, 3
