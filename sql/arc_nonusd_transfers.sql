-- Arc mainnet: non-USD stablecoin transfer volume (StableFX roster)
-- Dune engine: DuneSQL. Source table: arc.logs (raw; Dune has no curated transfers/prices for Arc).
--
-- Token list: Circle docs, "StableFX supported currencies" (developers.circle.com/stablefx/references/supported-currencies),
--   checked 2026-10-10. USDC excluded (dashboard tracks non-USD only).
-- Decimals: Arc Blockscout API (/api/v2/tokens/<address>), checked 2026-10-10.
--   JPYC: the address in Circle docs resolves to an uninitialised ERC1967 proxy on the explorer (no token metadata).
--   Decimals 18 assumed from JPYC's other deployments; expect zero rows until the contract is live.
-- FX: no price feed for these tokens on Arc in Dune. USD = native amount x ECB reference rate of 2026-10-09
--   (USD per unit = EURUSD / EURXXX). Approximation; update the fx column when re-basing.
--
-- Volume standard (same as Polygon/Plasma/Tron queries): exclude mint (from = 0x0), burn (to = 0x0 / 0xdead),
-- self-transfers (from = to). daily_transactions = COUNT(DISTINCT tx_hash).
-- Output columns match fetch-dune-data.js: date, token ("Currency - SYMBOL"), daily_transactions,
-- transfer_volume, transfer_volume_usd.

WITH tokens (token, contract_address, decimals, fx_usd) AS (
    VALUES
        ('Euro - EURC',                  0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1,  6, 1.1206),
        ('Euro - EURAU',                 0x4933a85b5b5466fbaf179f72d3de273c287ec2c2,  6, 1.1206),
        ('British pound - GBPA',         0xbbe6aab0ed76e90aea0d1cd978ec231c8adcdf8b,  6, 1.32204),
        ('Mexican peso - MXNB',          0xf197ffc28c23e0309b5559e7a166f2c6164c80aa,  6, 0.0549448),
        ('Australian dollar - AUDD',     0xdec15d98d8c16d9ca2f8cc94ba4b88fe4f259393,  6, 0.698106),
        ('Australian dollar - AUDF',     0xd2a530170d71a9cfe1651fb468e2b98f7ed7456b,  6, 0.698106),
        ('Canadian dollar - CADD',       0x24bf8ae7b8e073d766a3509c25b45a6ad30e9046, 18, 0.702923),
        ('Canadian dollar - QCAD',       0xd70c2fa4232e054b373efaea98e4138511c2a309,  6, 0.702923),
        ('South Korean won - KRW1',      0x303dbb88ba14626c7a927e983b73267c575315f7, 18, 0.000745442),
        ('Swedish krona - SEKAU',        0xf8524b5ab17d5eca2f78abe8377ceffd323b1dc1,  6, 0.100345),
        ('South African rand - ZARU',    0xe205b4e7ac03e3f7b2060c3edf2171aa7126c0d5, 18, 0.0604847),
        ('Swiss franc - CHFAU',          0xc6df1b92a6ae61a27059c41e541a91ce8dcb1605,  6, 1.20326),
        ('Turkish lira - TRYB',          0xfb0705023603dc86325b83d9ff6b0da7921fec17, 18, 0.0203364),
        ('Brazilian real - BRLA',        0x75700e137c05b2beb2b3a436ccb551652e3d8b11, 18, 0.1998),
        ('Japanese yen - JPYC',          0xe7c3d8c9a439fede00d2600032d5db0be71c3c29, 18, 0.00631894)
),

transfers AS (
    SELECT
        l.block_date                                                    AS date,
        t.token,
        l.tx_hash,
        varbinary_substring(l.topic1, 13, 20)                           AS from_addr,
        varbinary_substring(l.topic2, 13, 20)                           AS to_addr,
        CAST(varbinary_to_uint256(varbinary_substring(l.data, 1, 32)) AS DOUBLE)
            / power(10, t.decimals)                                     AS amount,
        t.fx_usd
    FROM arc.logs l
    JOIN tokens t
      ON l.contract_address = t.contract_address
    WHERE l.topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
      AND l.topic2 IS NOT NULL
      AND l.block_date >= CURRENT_DATE - INTERVAL '365' DAY
)

SELECT
    date,
    token,
    COUNT(DISTINCT tx_hash)     AS daily_transactions,
    SUM(amount)                 AS transfer_volume,
    SUM(amount * fx_usd)        AS transfer_volume_usd
FROM transfers
WHERE from_addr <> 0x0000000000000000000000000000000000000000
  AND to_addr NOT IN (0x0000000000000000000000000000000000000000,
                      0x000000000000000000000000000000000000dead)
  AND from_addr <> to_addr
GROUP BY 1, 2
ORDER BY 1 DESC, 2
