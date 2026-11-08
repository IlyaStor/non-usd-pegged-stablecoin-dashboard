-- BNB Chain non-USD stablecoins. Dune query 8748306. Full replacement of the saved query.
-- Do not save over the canonical query until an ad-hoc run matches KGST.
-- KGST stays. Added, both absent from the saved query: EURI and EURAU.
-- Series code for the EURITE product is EURI, not EURITE. Decimals 18.
-- EURAU decimals 6. prices.day (blockchain = bnb) is still preferred by contract.
-- EURI and EURAU fallback 1.1206 is FX_FALLBACK in lib/series.js, same role as KGST's 0.0114.
-- That fallback applies only when prices.day has no row.

-- KGST — государственный стейблкоин Кыргызстана, привязка к сому 1:1.
-- Сеть: BNB Chain. Контракт: 0x94be0bba8e1e303fe998c9360b57b826f1a4f828.
-- Верификация адреса: kgstoken.kg + BscScan (Source Code, Proxy, impl 0xA903A6c1...3a2a410E2);
-- decimals (18) не проверены независимо — подтвердить на BscScan перед продом.
-- Фильтрация приведена к стандарту Polygon (6621899) / Plasma (6663259) / Tron-fix (8517525):
-- исключены mint (from=0x0), burn (to=0x0/dead), self-transfer (from=to), value=0.
-- daily_transactions — COUNT(DISTINCT evt_tx_hash), не число событий.
-- Цена: prices.day по контракту, фолбэк 0.0114 USD/KGS — обновлять при движении курса сома.
WITH token_meta AS (
    SELECT * FROM (VALUES
        (0x94be0bba8e1e303fe998c9360b57b826f1a4f828, 'KGST', 18, 0.0114),
        (0x9d1A7A3191102e9F900Faa10540837ba84dCBAE7, 'EURI', 18, 1.1206),
        (0x4933a85b5b5466fbaf179f72d3de273c287ec2c2, 'EURAU', 6, 1.1206)
    ) AS t (contract_address, symbol, decimals, fallback_price)
),
daily_price AS (
    SELECT
        CAST(p.timestamp AS DATE) AS date,
        p.contract_address,
        MAX_BY(p.price, p.timestamp) AS price
    FROM prices.day p
    WHERE p.blockchain = 'bnb'
      AND p.contract_address IN (SELECT contract_address FROM token_meta)
      AND p.timestamp >= CURRENT_DATE - INTERVAL '365' DAY
    GROUP BY 1, 2
),
transfers AS (
    SELECT
        CAST(t.evt_block_time AS DATE) AS date,
        t.contract_address,
        t.evt_tx_hash,
        m.symbol,
        m.fallback_price,
        t."from",
        t."to",
        CAST(t.value AS DOUBLE) / POWER(10, m.decimals) AS amount
    FROM erc20_bnb.evt_transfer t
    JOIN token_meta m ON t.contract_address = m.contract_address
    WHERE t.evt_block_time >= CURRENT_DATE - INTERVAL '365' DAY
),
clean_transfers AS (
    SELECT *
    FROM transfers
    WHERE amount > 0
      AND "from" != 0x0000000000000000000000000000000000000000
      AND "to" NOT IN (0x0000000000000000000000000000000000000000, 0x000000000000000000000000000000000000dEaD)
      AND "from" != "to"
)
SELECT
    ct.date,
    ct.symbol AS token,
    COUNT(DISTINCT ct.evt_tx_hash) AS daily_transactions,
    SUM(ct.amount * COALESCE(dp.price, ct.fallback_price)) AS transfer_volume_usd
FROM clean_transfers ct
LEFT JOIN daily_price dp
    ON dp.date = ct.date
    AND dp.contract_address = ct.contract_address
GROUP BY 1, 2
ORDER BY 1 DESC
