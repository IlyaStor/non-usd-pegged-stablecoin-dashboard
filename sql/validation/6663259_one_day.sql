-- VALIDATION ONLY. Completed UTC day 2026-11-06.
-- Same table, filters, FX, labels, and COUNT(*) as the saved Plasma query.
-- Do not save this text onto query 6663259.
-- The 365-day text is sql/replacements/6663259_plasma.sql.
-- A one-day filter does not cap Dune credits.
-- EURC is the only added row. Its fallback is 1.18, the same as EUROP.

WITH stablecoin_contracts AS (
    SELECT * FROM (
        VALUES
            (0x98658Bd74EF231158Cadc21d8AbA733a4E947e6a, 'EUROP', 6, 1.18),
            (0x90729a45948c3078890Bc80F2a4e7870A2Ea4C5E, 'TRYB',  6, 0.023),
            (0x3ee196e78d4d4248b849b8e1c7f44c5457fafd2c, 'EURC',  6, 1.18)
    ) AS t (contract_address, symbol, decimals, fallback_price)
),
transfers AS (
    SELECT
        CAST(e.evt_block_time AS DATE) AS date,
        e.contract_address,
        e.value AS raw_value
    FROM erc20_plasma.evt_transfer e
    WHERE e.contract_address IN (SELECT contract_address FROM stablecoin_contracts)
      AND CAST(e.evt_block_time AS DATE) = DATE '2026-11-06'
      AND e.value > 0
      AND e."from" != 0x0000000000000000000000000000000000000000
      AND e."to" NOT IN (
          0x0000000000000000000000000000000000000000,
          0x000000000000000000000000000000000000dEaD
      )
      AND e."from" != e."to"
)
SELECT
    t.date,
    sc.symbol AS token,
    COUNT(*) AS daily_transactions,
    SUM(CAST(t.raw_value AS DOUBLE) / POWER(10, sc.decimals) * sc.fallback_price) AS transfer_volume_usd
FROM transfers t
JOIN stablecoin_contracts sc ON t.contract_address = sc.contract_address
GROUP BY 1, 2
ORDER BY 1 DESC, transfer_volume_usd DESC
