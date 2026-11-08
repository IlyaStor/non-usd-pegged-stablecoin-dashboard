-- CREATE TARGET. One query for Ethereum and Base. Not executed by this repository.
-- Not attached to the refresh job. No query id exists yet.
-- Nov 6 2026 medium execution 01M6XQ007G6AWQH7BD0FDY587N compiled Ethereum,
-- Base, Arbitrum, and Optimism. Positive rows were only Ethereum and Base.
-- Arbitrum and Optimism stay out of this file until they show coverage.
-- SEKAU is included on both chains, and Base CHFAU is included, even though
-- they were absent on Nov 6. Absence in that window is not zero history.
-- This query emits a day only when transfers exist. It does not write zero rows.
--
-- Docs: https://docs.dune.com/data-catalog/curated/token-transfers/evm/token-transfers
-- amount is already decimal-adjusted. Do not divide it again.
-- amount_usd is the curated Coinpaprika value and is null when that feed has
-- no price. fallback_price is FX_FALLBACK in lib/series.js (EUR 1.1206,
-- SEKAU 0.100345, CHFAU 1.20326). It is used only for those nulls.
-- price_source labels which one was used. A day that mixes both is 'mixed'.
-- blockchain is required so the two series are not summed together.
-- block_month is the documented partition. A 365-day scan is not a small-cost guarantee.
-- Do not run this file until a new query id is explicitly approved.

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
        ('base', 0xbd4dfc058eb95b8de5ceaf39966a1a70f5556f78, 'Swiss franc - CHFAU', 6, 1.20326)
    ) AS t (blockchain, contract_address, token, decimals, fallback_price)
)
SELECT
    tr.blockchain,
    tr.block_date AS date,
    t.token,
    COUNT(DISTINCT tr.tx_hash) AS daily_transactions,
    SUM(tr.amount) AS transfer_volume,
    SUM(CASE WHEN tr.amount_usd IS NULL THEN tr.amount * t.fallback_price ELSE tr.amount_usd END) AS transfer_volume_usd,
    CASE
        WHEN COUNT(tr.amount_usd) = 0 THEN 'fx_fallback'
        WHEN COUNT(tr.amount_usd) = COUNT(*) THEN 'tokens_evm.amount_usd'
        ELSE 'mixed'
    END AS price_source
FROM tokens_evm.transfers tr
JOIN tokens t
  ON tr.blockchain = t.blockchain
 AND tr.contract_address = t.contract_address
WHERE tr.token_standard = 'erc20'
  AND tr.blockchain IN ('ethereum', 'base')
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
