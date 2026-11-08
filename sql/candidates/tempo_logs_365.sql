-- CANONICAL WINDOW for Tempo raw logs. Not a saved query. Not in the refresh job.
-- This repository does not execute this file.
-- Curated tokens_evm coverage of Tempo was not confirmed. This uses tempo.logs.
-- Docs: https://docs.dune.com/data-catalog/evm/tempo/raw/logs
--       https://docs.dune.com/data-catalog/evm/tempo/overview
-- topic0 is the standard ERC-20 Transfer signature. The docs example filters it.
-- TIP-20 also emits TransferWithMemo. Its topic hash is not on the docs page,
-- so this query does not include it. Counting both would double-count if both
-- fire for one movement. A memo-only transfer would be missed. Check that on
-- the one-day file before any historical run.
-- Amount decode matches the ERC-20 Transfer layout already used for arc.logs.
-- No prices table is joined. USD uses FX_FALLBACK from lib/series.js.
-- A date filter does not cap credits. The partition column is not named in the docs.

WITH tokens AS (
    SELECT * FROM (VALUES
        (0x20c0000000000000000000009A4a4b17E0Dc6651, 'Euro - EURAU', 6, 1.1206),
        (0x20c0000000000000000000002E2829D90e7Da7Fa, 'Swedish krona - SEKAU', 6, 0.100345),
        (0x20C00000000000000000000042109aef2f8B28e1, 'Swiss franc - CHFAU', 6, 1.20326)
    ) AS t (contract_address, token, decimals, fallback_price)
),
logs AS (
    SELECT
        l.block_date,
        l.tx_hash,
        l.contract_address,
        varbinary_substring(l.topic1, 13, 20) AS from_addr,
        varbinary_substring(l.topic2, 13, 20) AS to_addr,
        CAST(varbinary_to_uint256(varbinary_substring(l.data, 1, 32)) AS DOUBLE) AS raw_amount
    FROM tempo.logs l
    WHERE l.topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
      AND l.topic2 IS NOT NULL
      AND l.block_date >= CURRENT_DATE - INTERVAL '365' DAY
      AND l.contract_address IN (SELECT contract_address FROM tokens)
)
SELECT
    x.block_date AS date,
    t.token,
    COUNT(DISTINCT x.tx_hash) AS daily_transactions,
    SUM(x.raw_amount / POWER(10, t.decimals)) AS transfer_volume,
    SUM(x.raw_amount / POWER(10, t.decimals) * t.fallback_price) AS transfer_volume_usd
FROM logs x
JOIN tokens t ON x.contract_address = t.contract_address
WHERE x.from_addr != 0x0000000000000000000000000000000000000000
  AND x.to_addr NOT IN (
      0x0000000000000000000000000000000000000000,
      0x000000000000000000000000000000000000dead
  )
  AND x.from_addr != x.to_addr
  AND x.raw_amount > 0
GROUP BY 1, 2
ORDER BY 1 DESC, 2
