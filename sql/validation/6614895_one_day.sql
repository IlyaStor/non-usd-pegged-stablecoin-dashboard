-- VALIDATION ONLY. Completed UTC day 2026-11-06.
-- Do not save this text onto a query id that .github/workflows/refresh-data.yml refreshes.
-- The canonical 365-day text stays in sql/replacements/. Saving this file over that query would publish one day and keep re-running it.
-- A one-day filter does not cap Dune credits. Pruning is not guaranteed.
-- This repository does not execute this file.

-- Polygon part 1 of 2. Dune query 6614895. Full replacement of the saved query.
-- Do not save over the canonical query until an ad-hoc run matches existing tokens.
-- EURAU, SEKAU, and CHFAU are added in this part only. Query 6621899 does not list them.
-- EURQ 0xD571Edb2EF29DF10fcd6200fd6D0Ed2389983db3 and every saved row stay.
-- prices.day (blockchain = polygon) is still used when that feed has a row.
-- EURAU fallback 1.04 matches the Euro rows already in this query (EURQ, EUROP, EURe).
-- SEKAU 0.100345 and CHFAU 1.20326 are the existing FX_FALLBACK rates in lib/series.js.
-- Those fallbacks apply only when prices.day has no row. Decimals are the verified registry values.

WITH stablecoin_contracts AS (
    SELECT * FROM (
        VALUES
            (0x9de41aff9f55219d5bf4359f167d1d0c772a396d, 'Canadian dollar - CAD',      18, 0.70),
            (0xd2a530170D71a9Cfe1651Fb468E2B98F7Ed7456b, 'Australian dollar - AUD',    6,  0.62),
            (0xD571Edb2EF29DF10fcd6200fd6D0Ed2389983db3, 'Euro - EURQ',                6,  1.04),
            (0x888883b5F5D21fb10Dfeb70e8f9722B9FB0E5E51, 'Euro - EUROP',               6,  1.04),
            (0xE0aEa583266584DafBB3f9C3211d5588c73fEa8d, 'Euro - EURe',                18, 1.04),
            (0x4Fb71290Ac171E1d144F7221D882BECAc7196EB5, 'Turkish Lira - TRYB',        6,  0.028),
            (0xb755506531786C8aC63B756BaB1ac387bACB0C04, 'South African rand - ZARP',  18, 0.054),
            (0xAb9aD9089f23e6779a8727900709427719f753e1, 'Nigerian naira - NGNC',      6,  0.00063),
            (0x52828daa48C1a9A06F37500882b42daf0bE04C3B, 'Nigerian naira - cNGC',      6,  0.00063),
            (0x4933a85b5b5466fbaf179f72d3de273c287ec2c2, 'Euro - EURAU',                6,  1.04),
            (0x0297B579B0CB603B5eE814EB7322b960D3ae7A66, 'Swedish krona - SEKAU',       6,  0.100345),
            (0xbd4dfc058eb95b8de5ceaf39966a1a70f5556f78, 'Swiss franc - CHFAU',         6,  1.20326)
    ) AS t (contract_address, symbol, decimals, fallback_price)
),
daily_prices AS (
    SELECT
        CAST(p.timestamp AS DATE) AS date,
        p.contract_address,
        MAX_BY(p.price, p.timestamp) AS price
    FROM prices.day p
    WHERE p.blockchain = 'polygon'
      AND p.contract_address IN (SELECT contract_address FROM stablecoin_contracts)
      AND p.timestamp >= TIMESTAMP '2026-11-06 00:00:00'
      AND p.timestamp < TIMESTAMP '2026-11-07 00:00:00'
    GROUP BY 1, 2
),
daily_transfers AS (
    SELECT
        CAST(e.evt_block_time AS DATE) AS date,
        e.contract_address,
        SUM(e.value) AS total_value,
        COUNT(DISTINCT e.evt_tx_hash) AS daily_transactions
    FROM erc20_polygon.evt_transfer e
    WHERE e.contract_address IN (SELECT contract_address FROM stablecoin_contracts)
      AND e.evt_block_time >= TIMESTAMP '2026-11-06 00:00:00'
      AND e.evt_block_time < TIMESTAMP '2026-11-07 00:00:00'
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
    (dt.total_value / POWER(10, sc.decimals)) * COALESCE(dp.price, sc.fallback_price) AS transfer_volume_usd,
    COALESCE(dp.price, sc.fallback_price) AS price_used,
    CASE WHEN dp.price IS NULL THEN 'fallback' ELSE 'prices.day' END AS price_source
FROM daily_transfers dt
JOIN stablecoin_contracts sc ON dt.contract_address = sc.contract_address
LEFT JOIN daily_prices dp
    ON dp.contract_address = dt.contract_address
    AND dp.date = dt.date
ORDER BY 1 DESC, 5 DESC
