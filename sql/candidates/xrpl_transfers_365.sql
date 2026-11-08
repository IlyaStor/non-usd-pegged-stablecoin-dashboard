-- CANONICAL WINDOW for XRPL. Not a saved query. Not in the refresh job.
-- This repository does not execute this file.
-- Table: xrpl.transfers, successful direct same-asset payments.
-- Docs: https://docs.dune.com/data-catalog/xrpl/transfers
-- tokens_xrpl.transfers is a gated table and is not used.
-- delivered_amount_value is the documented actual amount. Registry decimals
-- are n/a, so this query does not scale the value.
-- The docs do not say whether amount_currency is ASCII or the 40-character hex.
-- This query filters the issuer only and keeps amount_currency in the result
-- so the code form can be seen. It does not guess the hex.
-- USD is the FX_FALLBACK EUR rate only when amount_currency_iso = 'EUR'.
-- Otherwise transfer_volume_usd is null. Do not store null as zero.
-- Xahau is not this table.

WITH issuers AS (
    SELECT * FROM (VALUES
        ('rDk1xiArDMjDqnrR2yWypwQAKg4mKnQYvs', 'Euro - EURQ'),
        ('rUNaS5sqRuxZz6V7rBGhoSaZiVYA3ut4UL', 'Euro - EURCV')
    ) AS t (issuer, token)
)
SELECT
    x.ledger_close_date AS date,
    i.token,
    x.delivered_amount_currency AS amount_currency,
    x.delivered_amount_currency_iso AS amount_currency_iso,
    COUNT(DISTINCT x.transaction_hash) AS daily_transactions,
    SUM(x.delivered_amount_value) AS transfer_volume,
    SUM(CASE
        WHEN x.delivered_amount_currency_iso = 'EUR' THEN x.delivered_amount_value * 1.1206
        ELSE NULL
    END) AS transfer_volume_usd
FROM xrpl.transfers x
JOIN issuers i ON x.delivered_amount_issuer_address = i.issuer
WHERE x.ledger_close_date >= CURRENT_DATE - INTERVAL '365' DAY
  AND x.account_address != x.destination_address
  AND x.delivered_amount_value > 0
GROUP BY 1, 2, 3, 4
ORDER BY 1 DESC, 2
