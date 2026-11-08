-- Plasma query 6663259. Full intended replacement. Not executed by this repository.
-- The saved text of 6663259 is not in this repo. This file keeps the published
-- tickers EUROP and TRYB and adds Circle EURC. It uses the same decoded-event
-- shape as the saved Polygon query: erc20_<chain>.evt_transfer, prices.day,
-- and the mint/burn/self filters. Table erc20_plasma and prices blockchain
-- 'plasma' are the names that match that pattern. If the live query's FROM
-- clause differs, keep that clause and add only the EURC row.
-- Do not save the one-day validation file onto this query id.
-- EURC fallback 1.1206 is FX_FALLBACK.EURC, the same rate as FX_FALLBACK.EUROP.
-- If the saved query uses a different EUROP fallback, give EURC that same number.
-- CHF was not confirmed. EURR 0xC60BCA6BD5790611B8A302D4C5DF37D769C81121 is inactive
-- (supply 0, transfers 0) and is not listed.
-- A date filter does not cap Dune credits.

WITH stablecoin_contracts AS (
    SELECT * FROM (
        VALUES
            (0x98658Bd74EF231158Cadc21d8AbA733a4E947e6a, 'EUROP', 6, 1.1206),
            (0x90729a45948c3078890Bc80F2a4e7870A2Ea4C5E, 'TRYB',  6, 0.0203364),
            (0x3ee196e78d4d4248b849b8e1c7f44c5457fafd2c, 'EURC',  6, 1.1206)
    ) AS t (contract_address, symbol, decimals, fallback_price)
),
daily_prices AS (
    SELECT
        CAST(p.timestamp AS DATE) AS date,
        p.contract_address,
        MAX_BY(p.price, p.timestamp) AS price
    FROM prices.day p
    WHERE p.blockchain = 'plasma'
      AND p.contract_address IN (SELECT contract_address FROM stablecoin_contracts)
    GROUP BY 1, 2
),
daily_transfers AS (
    SELECT
        CAST(e.evt_block_time AS DATE) AS date,
        e.contract_address,
        SUM(e.value) AS total_value,
        COUNT(DISTINCT e.evt_tx_hash) AS daily_transactions
    FROM erc20_plasma.evt_transfer e
    WHERE e.contract_address IN (SELECT contract_address FROM stablecoin_contracts)
      AND e.evt_block_time >= CURRENT_DATE - INTERVAL '365' DAY
      AND e.value > 0
      AND e."from" != 0x0000000000000000000000000000000000000000
      AND e."to" NOT IN (
          0x0000000000000000000000000000000000000000,
          0x000000000000000000000000000000000000dEaD
      )
      AND e."from" != e."to"
    GROUP BY 1, 2
)
SELECT
    dt.date,
    sc.symbol AS token,
    dt.daily_transactions,
    dt.total_value / POWER(10, sc.decimals) AS transfer_volume,
    (dt.total_value / POWER(10, sc.decimals)) * COALESCE(dp.price, sc.fallback_price) AS transfer_volume_usd
FROM daily_transfers dt
JOIN stablecoin_contracts sc ON dt.contract_address = sc.contract_address
LEFT JOIN daily_prices dp
    ON dp.contract_address = dt.contract_address
    AND dp.date = dt.date
ORDER BY 1 DESC, 2
