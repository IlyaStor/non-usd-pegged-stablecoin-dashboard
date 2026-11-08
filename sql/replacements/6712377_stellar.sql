-- Stellar non-USD stablecoins. Dune query 6712377. Full replacement of the saved query.
-- Do not save over the canonical query until an ad-hoc run matches the existing eight tokens.
--
-- Coverage: stellar.history_contract_events whose first topic is transfer.
-- Classic Stellar payments (asset code + issuer) are not in that table.
-- A SAC contract is the Soroban wrapper. It is not the classic issuer.
-- EURQ SAC CAA56M3OKR2IHHJB4ZAUPAJDYOGFXSVYN6NFJGN7PJN4NUMRKSDFABYI
--   classic issuer GCA6KZBWPBOEF6M2MZBTXRMKLMWRZOUCL2JFSIDT3WTDBOFIVDC4C4CE is not queried.
-- EURCV SAC CANKBYNNAYKEZXLB655F2UPNTAZFK5HILZUXL7ZTFR3NF6LKDSVY7KFH
--   classic issuer GCEYGIVOLAVBF2TG2RUSGTUJCIN75KEX3NGLMY4VPL4GFE5L355AXW3G is not queried.
-- EURAU SEP-41 contract CB44W727WSLHPXJ47A6DHF5D34RKWSOZAMEDXO3CF5TEEEQ2ZX4V3VRI
--   decimals 6. It is not a classic asset.
-- USD_BLOCKED BRMB SAC CBD67SY7LMNGXVELAAAUX7LHADZFJ4CK6BHYW36XBHCDNHQP5QO3AKXR
--   classic issuer GBVXEEYTHW4PUHVOOSEUPS4TTKVRU7XDZJIKAIZRG2H2XU7YWDEFKNTP is not queried.
--   No CNY rate exists in this query or in FX_FALLBACK. BRMB is not in the result.
--   A 0 or 1 rate is not used. Classic BRMB payments are not captured here either.
--
-- Saved roster stays: 8 tokens. MXNe (CAPW...) убран — ноль активности на Soroban.
-- EURS (CDJJ...) оставлен сознательно как МЁРТВЫЙ образец (последняя активность
-- 2026-04-01, >90 дней назад). Окно 365 дней.
-- Emitted additions: EURQ SAC and EURCV SAC at 7 decimals, EURAU SEP-41 at 6.
-- Existing tokens stay at 7 decimals. EUR fallback 1.0428 matches EURC and EURS
-- already in this query. The amount decoder is the saved query's decoder.

WITH tokens AS (
    SELECT * FROM (VALUES
        ('CACXKRVCW7I6CWX6RS6ANFDKVCOUI2PB6LTDUROL3J3FMJCRZ4ZLQRF6', 'Australian Digital Dollar - AUDD', 7, 0.6298),
        ('CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV', 'Euro - EURC (Circle)', 7, 1.0428),
        ('CA67EQNWGPGXHVT6E4HQ65WEV54KFDB6HJDHVCJM33VKZ7XKR5MN3KPJ', 'Japanese Yen - GYEN', 7, 0.006609),
        ('CCD6H4LBTHAPY3NGEE6TLLRUSPJGX4K5XI2J6E4MUNDB5TNXEKC23H5B', 'Argentinian Peso - ARS', 7, 0.00072),
        ('CBYFV4W2LTMXYZ3XWFX5BK2BY255DU2DSXNAE4FJ5A5VYUWGIBJDOIGG', 'Nigerian Naira - NGNC', 7, 0.00074),
        ('CDJJQLCW6GFVUXJOXXONVC6KHPTY4RFMDKFBAP6SHWVKICXPRS4RSIKY', 'Euro - EURS', 7, 1.0428),
        ('CDIA2WBXIDLXYNL4IU55K77BUZHTC5E65ZGCOXEAEJDIW4XLHZHCSC7X', 'Brazilian Real - BRLT', 7, 0.19),
        ('CCFS6UDFSR5OJIN45RQPUCZ5JTTU5TQOTIS6XKYKNWKC4TVR752BOWOF', 'Peruvian Peso - PEN', 7, 0.27),
        ('CAA56M3OKR2IHHJB4ZAUPAJDYOGFXSVYN6NFJGN7PJN4NUMRKSDFABYI', 'Euro - EURQ', 7, 1.0428),
        ('CANKBYNNAYKEZXLB655F2UPNTAZFK5HILZUXL7ZTFR3NF6LKDSVY7KFH', 'Euro - EURCV', 7, 1.0428),
        ('CB44W727WSLHPXJ47A6DHF5D34RKWSOZAMEDXO3CF5TEEEQ2ZX4V3VRI', 'Euro - EURAU', 6, 1.0428)
    ) AS t (contract_id, token, decimals, fx_usd)
),
events AS (
    SELECT
        e.closed_at,
        e.transaction_id,
        e.contract_id,
        CASE
            WHEN json_extract_scalar(e.data_decoded, '$.i128') IS NOT NULL
                THEN TRY_CAST(json_extract_scalar(e.data_decoded, '$.i128') AS DOUBLE)
            ELSE TRY_CAST(
                json_extract_scalar(
                    json_format(
                        filter(
                            cast(json_extract(e.data_decoded, '$.map') as array(json)),
                            x -> json_extract_scalar(x, '$.key.symbol') = 'amount'
                        )[1]
                    ),
                '$.val.i128'
                ) AS DOUBLE
            )
        END AS raw_amount
    FROM stellar.history_contract_events e
    WHERE e.successful = TRUE
      AND json_extract_scalar(e.topics_decoded, '$[0].symbol') = 'transfer'
      AND e.closed_at >= CURRENT_DATE - INTERVAL '365' DAY
      AND e.contract_id IN (SELECT contract_id FROM tokens)
)
SELECT
    DATE_TRUNC('day', ev.closed_at) AS date,
    t.token,
    COUNT(DISTINCT ev.transaction_id) AS daily_transactions,
    SUM(ev.raw_amount / POWER(10, t.decimals)) AS transfer_volume_native,
    SUM(ev.raw_amount / POWER(10, t.decimals) * t.fx_usd) AS transfer_volume_usd
FROM events ev
JOIN tokens t ON ev.contract_id = t.contract_id
GROUP BY 1, 2
ORDER BY 1 DESC, 2
