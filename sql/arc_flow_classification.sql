-- Arc: classify non-USD stablecoin transfer volume by flow type and phase.
-- Phase: private mainnet (genesis 2026-05-15) vs public mainnet (from 2026-09-16).
-- Flow type by the contract the transaction was sent to (tx.to), plus mint/burn/self.
--   0xc6e6b8...255f : unidentified automated liquidity manager (module on two 2-of-14/15 Safes,
--                     withdraws and re-deposits CL pool positions, ~hourly)
--   0xe2e5f1...dfe6 : Circle StableFX settlement (FxEscrowProxy)

WITH tokens (symbol, contract_address, decimals, fx_usd) AS (
    VALUES
        ('EURC',  0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1,  6, 1.1206),
        ('EURAU', 0x4933a85b5b5466fbaf179f72d3de273c287ec2c2,  6, 1.1206),
        ('GBPA',  0xbbe6aab0ed76e90aea0d1cd978ec231c8adcdf8b,  6, 1.32204),
        ('MXNB',  0xf197ffc28c23e0309b5559e7a166f2c6164c80aa,  6, 0.0549448),
        ('AUDD',  0xdec15d98d8c16d9ca2f8cc94ba4b88fe4f259393,  6, 0.698106),
        ('AUDF',  0xd2a530170d71a9cfe1651fb468e2b98f7ed7456b,  6, 0.698106),
        ('CADD',  0x24bf8ae7b8e073d766a3509c25b45a6ad30e9046, 18, 0.702923),
        ('QCAD',  0xd70c2fa4232e054b373efaea98e4138511c2a309,  6, 0.702923),
        ('KRW1',  0x303dbb88ba14626c7a927e983b73267c575315f7, 18, 0.000745442),
        ('SEKAU', 0xf8524b5ab17d5eca2f78abe8377ceffd323b1dc1,  6, 0.100345),
        ('ZARU',  0xe205b4e7ac03e3f7b2060c3edf2171aa7126c0d5, 18, 0.0604847),
        ('CHFAU', 0xc6df1b92a6ae61a27059c41e541a91ce8dcb1605,  6, 1.20326),
        ('TRYB',  0xfb0705023603dc86325b83d9ff6b0da7921fec17, 18, 0.0203364),
        ('BRLA',  0x75700e137c05b2beb2b3a436ccb551652e3d8b11, 18, 0.1998)
),
x AS (
    SELECT
        l.block_date,
        l.tx_hash,
        t.symbol,
        varbinary_substring(l.topic1, 13, 20) AS f,
        varbinary_substring(l.topic2, 13, 20) AS r,
        CAST(varbinary_to_uint256(varbinary_substring(l.data, 1, 32)) AS DOUBLE) / power(10, t.decimals) AS amt,
        t.fx_usd
    FROM arc.logs l
    JOIN tokens t ON l.contract_address = t.contract_address
    WHERE l.topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
      AND l.topic2 IS NOT NULL
      AND l.block_date >= DATE '2026-05-15'
),
tx AS (
    SELECT hash, "to" AS tx_to
    FROM arc.transactions
    WHERE block_date >= DATE '2026-05-15'
),
c AS (
    SELECT
        CASE WHEN x.block_date >= DATE '2026-09-16' THEN 'public' ELSE 'private' END AS phase,
        x.symbol,
        CASE
            WHEN x.f = 0x0000000000000000000000000000000000000000 THEN 'mint'
            WHEN x.r IN (0x0000000000000000000000000000000000000000, 0x000000000000000000000000000000000000dead) THEN 'burn'
            WHEN x.f = x.r THEN 'self'
            WHEN tx.tx_to = 0xc6e6b8d4771fc2f72056f96ceeccc32c483a255f THEN 'lp_manager'
            WHEN tx.tx_to = 0xe2e5f173576b513d994073ccbdacbe027d43dfe6 THEN 'stablefx'
            ELSE 'other'
        END AS flow,
        x.tx_hash,
        x.amt,
        x.amt * x.fx_usd AS usd
    FROM x
    LEFT JOIN tx ON tx.hash = x.tx_hash
)
SELECT
    phase,
    symbol,
    flow,
    COUNT(*)                 AS transfers,
    COUNT(DISTINCT tx_hash)  AS txs,
    ROUND(SUM(amt), 2)       AS volume_native,
    ROUND(SUM(usd), 0)       AS volume_usd
FROM c
GROUP BY 1, 2, 3
ORDER BY phase DESC, volume_usd DESC
