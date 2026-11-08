-- VALIDATION ONLY. Completed UTC day 2026-11-06. Not a refresh query.
-- Do not save this text onto a query id that the refresh workflow runs.
-- A one-day filter does not cap Dune credits. Pruning on tempo.logs is not documented.
-- This repository does not execute this file.
-- Same Transfer-only rule as sql/candidates/tempo_logs_365.sql. TransferWithMemo
-- is not included because its topic hash is not in the public docs.

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
      AND l.block_date = DATE '2026-11-06'
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
