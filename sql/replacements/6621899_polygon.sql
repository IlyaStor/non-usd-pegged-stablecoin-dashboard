-- Polygon part 2 of 2. Dune query 6621899. Token list unchanged from the saved query.
-- EURAU, SEKAU, and CHFAU are listed only in 6614895. Do not add them here.
-- The two Polygon queries are summed by symbol and day. A contract in both would double-count.
-- Do not save over the canonical query; this file is the reference copy of the saved text.

WITH stablecoin_contracts AS (
    SELECT * FROM (
        VALUES
            (0xE6A537a407488807F0bbeb0038B79004f19DDDFb, 'Brazilian rial - BRLA',        18, 0.17),
            (0x4eD141110F6EeeAbA9A1df36d8c26f684d2475Dc, 'Brazilian rial - BRZ',         18, 0.17),
            (0x5c067c80c00ecd2345b05e83a3e758ef799c40b5, 'Brazilian rial - BRL1',        18, 0.17),
            (0x12050c705152931cFEe3DD56c52Fb09Dea816C23, 'Colombian Peso - COPM',        18, 0.00023),
            (0x431D5dfF03120AFA4bDf332c61A6e1766eF37BDB, 'Japanese Yen (APAC) - JPYC',   18, 0.0064),
            (0xDC3326e71D45186F113a2F448984CA0e8D201995, 'Singapore Dollar (APAC) - XSGD', 6, 0.74),
            (0x2c826035c1C36986117A0e949bD6ad4baB54afE2, 'Indonesian Rupiah - XIDR',      6, 0.000061),
            (0x9a8284C2CEC196478f01eF4446A0222dD4deF00E, 'Indonesian Rupiah - IDDR',     18, 0.000061),
            (0x554cd6bdD03214b10AafA3e0D4D42De0C5D2937b, 'Indonesian Rupiah - IDRT',     18, 0.000061),
            (0x87a25dc121Db52369F4a9971F664Ae5e372CF69A, 'Philippine peso - PHPC',        6, 0.017),
            (0xe75220cB014Dfb2D354bb59be26d7458bB8d0706, 'Philippine peso - PHT',        18, 0.017)
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
      AND CAST(e.evt_block_time AS DATE) >= CURRENT_DATE - INTERVAL '365' DAY
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
