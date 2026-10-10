-- Arc mainnet: non-USD stablecoin transfer volume (StableFX roster) — v2, "clean" volume
-- Source: arc.logs (raw). Token list: Circle StableFX docs, checked 2026-10-10.
-- Decimals: Arc Blockscout API, 2026-10-10.
-- USD: native amount x ECB reference rate of 2026-10-09 (USD per unit).
--
-- Rules (verified on Arc data, 2026-10-10):
--   1. Window starts 2026-09-16 (public mainnet). Chain genesis was 2026-05-15; May–Sep was a
--      permissioned private mainnet with test activity only.
--   2. Excludes mint (from 0x0), burn (to 0x0 / 0xdead), self-transfers.
--   3. Excludes transfers inside transactions that add/remove DEX liquidity (pool Mint, Burn or
--      Collect events, Uniswap-v3 signatures, used by Arc's CL pools). One automated manager
--      re-deposits its positions ~hourly; this was 57% of EURC and ~98% of GBPA raw volume.
--   4. StableFX settlement (FxEscrowProxy 0xe2e5...dfe6): each trade moves tokens into escrow and
--      back out. Only the inbound leg is counted, so each trade's notional is counted once.

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

lp_txs AS (
    SELECT DISTINCT tx_hash
    FROM arc.logs
    WHERE block_date >= DATE '2026-09-16'
      AND topic0 IN (
          0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde,  -- pool Mint
          0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c,  -- pool Burn
          0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0   -- pool Collect
      )
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
      AND l.block_date >= DATE '2026-09-16'
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
  AND from_addr <> 0xe2e5f173576b513d994073ccbdacbe027d43dfe6
  AND tx_hash NOT IN (SELECT tx_hash FROM lp_txs)
GROUP BY 1, 2
ORDER BY 1 DESC, 2
