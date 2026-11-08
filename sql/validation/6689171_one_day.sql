-- VALIDATION ONLY. Completed UTC day 2026-11-06.
-- Do not save this text onto a query id that .github/workflows/refresh-data.yml refreshes.
-- The canonical 365-day text stays in sql/replacements/. Saving this file over that query would publish one day and keep re-running it.
-- A one-day filter does not cap Dune credits. Pruning is not guaranteed.
-- This repository does not execute this file.

-- Solana non-USD stablecoins. Dune query 6689171. Full replacement of the saved query.
-- Do not save over the canonical query until an ad-hoc run matches existing mints.
-- Added: EURAU and CHFAU. Both are Token-2022, same as EURCV.
-- amount_display is already scaled by the mint decimals. Do not divide again.
-- EURCV mint DghpMkatCiUsofbTmid3M3kAbDTPqDwKiYHnudXeGG52 stays, decimals 2.
-- EURAU mint decimals 6. CHFAU mint decimals 6.
-- prices.day stays limited to VCHF and EURC, the symbols this saved query already trusts.
-- EURAU fallback 1.0428 matches the other EUR mints in this query.
-- CHFAU fallback 1.11 matches VCHF in this query. SEKAU on Solana is not added.

-- Solana non-USD stablecoins. Raw layer (tokens_solana.transfers), no enterprise.
-- USD: real price from prices.day where Dune indexes it (VCHF, EURC),
-- hardcoded fallback for the rest. Update fallbacks when FX drifts.
WITH token_meta AS (
    SELECT * FROM (VALUES
        ('FtgGSFADXBtroxq8VCausXRr2of47QBf5AS1NtZCu4GD', 'BRZ',   0.17),
        ('A94X2fRy3wydNShU4dRaDyap2UuoeWJGWyATtyp61WZf', 'TRYB',  0.023),
        ('HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr', 'EURC',  1.0428),
        ('C4Kkr9NZU3VbyedcgutU6LKmi6MKz81sx6gRmk5pX519', 'VEUR',  1.0428),
        ('DghpMkatCiUsofbTmid3M3kAbDTPqDwKiYHnudXeGG52', 'EURCV', 1.0428), -- decimals 2, Token-2022; amount_display already scaled
        ('9pCWprxbZMW2rYSMhPTeoyLMV2sN2WJqshdT7DQVt6hS', 'EURAU', 1.0428), -- decimals 6, Token-2022; amount_display already scaled
        ('3GJfXJvPcjuAu6VQZmcs9pAXQau8nz3z88CCpBztgQSv', 'CHFAU', 1.11), -- decimals 6, Token-2022; fallback matches VCHF in this query
        ('AhhdRu5YZdjVkKR3wbnUDaymVQL2ucjMQ63sZ3LFHsch', 'VCHF',  1.11),
        ('2VhjJ9WxaGC3EZFwJG9BDUs9KxKCAjQY4vgd1qxgYWVg', 'EUROe', 1.0428)
    ) AS t (mint, symbol, fallback_price)
),
daily_price AS (
    SELECT
        CAST(timestamp AS DATE) AS date,
        symbol,
        MAX_BY(price, timestamp) AS price
    FROM prices.day
    WHERE blockchain = 'solana'
      AND symbol IN ('VCHF', 'EURC')
      AND timestamp >= TIMESTAMP '2026-11-06 00:00:00'
      AND timestamp < TIMESTAMP '2026-11-07 00:00:00'
    GROUP BY 1, 2
),
transfers AS (
    SELECT
        CAST(t.block_time AS DATE) AS date,
        m.symbol,
        m.fallback_price,
        t.amount_display AS amount
    FROM tokens_solana.transfers t
    JOIN token_meta m ON t.token_mint_address = m.mint
    WHERE t.block_time >= TIMESTAMP '2026-11-06 00:00:00'
      AND t.block_time < TIMESTAMP '2026-11-07 00:00:00'
      AND t.amount_display > 0
)
SELECT
    tr.date,
    tr.symbol AS token,
    COUNT(*) AS daily_transactions,
    SUM(tr.amount * COALESCE(dp.price, tr.fallback_price)) AS transfer_volume_usd
FROM transfers tr
LEFT JOIN daily_price dp
    ON dp.date = tr.date
    AND dp.symbol = tr.symbol
GROUP BY 1, 2
ORDER BY 1 DESC, transfer_volume_usd DESC
