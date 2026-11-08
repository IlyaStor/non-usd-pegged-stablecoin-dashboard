-- VALIDATION ONLY. Completed UTC day 2026-11-06. Not a refresh query.
-- Do not save this text onto a query id that the refresh workflow runs.
-- A one-day filter does not cap Dune credits. A partition key for xrpl.transfers
-- is not named in the docs.
-- This repository does not execute this file.
-- Read amount_currency in the result before trusting amount_currency_iso.
-- Docs: https://docs.dune.com/data-catalog/xrpl/transfers

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
WHERE x.ledger_close_date = DATE '2026-11-06'
  AND x.account_address != x.destination_address
  AND x.delivered_amount_value > 0
GROUP BY 1, 2, 3, 4
ORDER BY 1 DESC, 2
