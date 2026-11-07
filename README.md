# Tracked non-USD stablecoin dashboard

On-chain transfer volume and transaction counts for the non-USD stablecoins currently tracked on Polygon, Stellar, Solana, Tron, Plasma, BSC and Arc. Hosted at [analytics.solosolver.xyz](https://analytics.solosolver.xyz).

Totals are **tracked** volume. Coverage is not exhaustive; more tokens and chains will be added.

## How data gets onto the site

GitHub Actions (`.github/workflows/refresh-data.yml`) runs about every 2 days, or on demand:

1. `fetch-dune-data.js` executes each Dune query, waits until it finishes, and drops the incomplete UTC day of that execution.
2. It writes `data.json` (pipe-delimited series plus per-network `execution_ended_at`) and `og.png`.
3. The workflow commits those files. Vercel deploys `main`.

The page reads `/data.json`. It shows each network’s Dune execution time, not the git commit time.

A completed execution younger than 20 hours is reused so a same-day retry does not spend another run. If Dune returns HTTP 429 or 503, the same execution is polled again after a backoff until the job budget ends. That is not a new execution. If a query is still queued or running when the 36 minute job budget ends, its Dune execution id is stored in `refresh-state.json` and the series already on the site is left in place. The next run polls that id (status checks are not billed) and does not call execute again unless Dune reports the execution failed or expired. Finished networks from a partial run are still written. The default engine tier is `medium` (not `large`). Override with repository variables `DUNE_PERFORMANCE` (`small`, `medium`, `large`), `DUNE_FRESHNESS_HOURS`, and `DUNE_JOB_WAIT_MINUTES`.

The Actions secret must stay named `DUNE_API_KEY`.

## Queries

| Network | Dune query |
| --- | --- |
| Polygon | [6614895](https://dune.com/queries/6614895), [6621899](https://dune.com/queries/6621899) |
| Stellar | [6712377](https://dune.com/queries/6712377) |
| Solana | [6689171](https://dune.com/queries/6689171) |
| Tron | [6695880](https://dune.com/queries/6695880) |
| Plasma | [6663259](https://dune.com/queries/6663259) |
| BSC | [8748306](https://dune.com/queries/8748306) |
| Arc | [8924650](https://dune.com/queries/8924650) |

Arc SQL lives in `sql/`. The deployed query includes the private-mainnet period. `sql/arc_nonusd_transfers_clean.sql` is an alternative and is not what the site runs.

## Verified additions

35 verified token-network entries (8 tokens): 2 already in the published series, 3 listed in the repo Arc SQL but absent from that series, 11 pending an edit to an existing Dune query, 19 on chains this dashboard does not query.

`registry/verified-additions.json` is a catalog of checked identities (sheet tab “Токены на добавление. 30.07”, 2026-11-07). The Registry tab reads that file and compares it with the symbols already in `data.json`. Catalog rows are not transfer history. They are not included in tracked volume, the hero total, or the coverage counts. `data.json` is unchanged by this catalog.

| Status | Count | Meaning |
| --- | ---: | --- |
| In the published series | 2 | EURQ on Polygon, EURCV on Solana. Left as they are. |
| In repo Arc SQL, absent from the series | 3 | EURAU, SEKAU, CHFAU. Already listed in `sql/arc_nonusd_transfers.sql`. |
| Pending an edit to an existing query | 11 | Polygon, Stellar, Solana, BSC. The live SQL for those queries is not in this repo. |
| No dashboard chain | 19 | No query id and no new network tab. |

The refresh job still calls only the query ids in the table above. It does not gain a network, a query id, or a rate-limit change.

### Manual Dune activation

Do not create a new Dune query id. Do not insert zero-volume history. This pull request does not execute Dune queries. After a query is saved on Dune, the existing refresh job is what pulls new symbols, under the same freshness window and 429/503 backoff. Until that happens, the previous series stay in place.

The series match is by ticker. Confirm the saved query uses the registry address before saving. EURQ on Polygon and EURCV on Solana are already in the published series. Do not add a second row.

1. Polygon queries [6614895](https://dune.com/queries/6614895) and [6621899](https://dune.com/queries/6621899). Polygon has two query ids. Add each new contract to exactly one of them. Rows for the same symbol and day are summed. Add EURAU, SEKAU, and CHFAU from `sql/pending/polygon_token_rows.sql`. Leave EURQ (`0xd571edb2ef29df10fcd6200fd6d0ed2389983db3`) in place. The commented rows are not executable: this repo does not contain the Polygon source table.
2. BSC query [8748306](https://dune.com/queries/8748306). Add EURI and EURAU from `sql/pending/bsc_token_rows.sql`. EURITE is the product name. The on-chain ticker and the series code are EURI. The replaced Polygon EURITE row was PHT Stablecoin. Do not merge EURI into the PHT series.
3. Solana query [6689171](https://dune.com/queries/6689171). Add the EURAU and CHFAU Token-2022 mints from `sql/pending/solana_token_rows.sql`. Leave the EURCV mint `DghpMkatCiUsofbTmid3M3kAbDTPqDwKiYHnudXeGG52`. SEKAU on Solana is excluded. The issuer address resolved to a program, not a mint.
4. Stellar query [6712377](https://dune.com/queries/6712377). Add EURQ, EURCV, BRMB, and EURAU from `sql/pending/stellar_token_rows.sql`. Stellar classic assets are code plus issuer. A SAC contract is not a classic issuer. EURAU on Stellar is SEP-41. It is not a classic asset. Its decimals are 6. Classic assets use 7. The saved Stellar SQL is not in this repo, so which identifier that query already keys on is unverified.
5. Arc query [8924650](https://dune.com/queries/8924650). Arc rows for EURAU, SEKAU, and CHFAU are already in sql/arc_nonusd_transfers.sql. Do not add them again. Compare the saved query with that file (the v1 query the site runs, including the private-mainnet period). Do not switch the site to `sql/arc_nonusd_transfers_clean.sql`. Query 8924650 is not proven updated by this repository. The published series does not contain those symbols. Absence can mean zero qualifying transfers, because the query emits a day only when transfers exist, or that the saved text is older than the file.

Chains with no query id, and no tab added here: Ethereum, Algorand, XRP Ledger, Xahau, Adi Chain, Base, Arbitrum, Optimism, Tempo. XRPL and Xahau decimals are n/a. Do not store a number. Issued currencies have no fixed decimals.

BRMB has no CNY rate in FX_FALLBACK. Do not invent one. EURQ and EURI use the existing EUR fallback (`1.1206`), the same rate already used for EURC. SEKAU and CHFAU keep the rates already in `FX_FALLBACK`.

Also left out of the registry: unidentified SIDR, and the BRMB Ethereum issuer wallet (not a token contract).

## Local preview

```bash
python3 -m http.server 8765
```

Open `http://localhost:8765/`. Network tabs also respond to `?network=solana` and `#solana`.

```bash
npm install
npm test
```

`npm test` does not call Dune. Refreshing data locally needs `DUNE_API_KEY` and runs `node fetch-dune-data.js`.
