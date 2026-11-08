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

`sql/arc_nonusd_transfers.sql` includes the private-mainnet period. The saved text of query 8924650 is the clean public-mainnet query, copied at `sql/replacements/8924650_arc.sql`. It already lists EURAU, SEKAU, and CHFAU. That text is not a series row.

## Verified additions

35 verified token-network entries (8 tokens): 2 already in the published series, 3 listed in the saved Arc query but absent from that series, 10 in replacement SQL that is not yet the published series, 1 blocked with no sourced USD rate, 19 on chains this dashboard does not query.

`registry/verified-additions.json` is a catalog of checked identities (sheet tab “Токены на добавление. 30.07”, 2026-11-07). The Registry tab reads that file and compares it with the symbols already in `data.json`. Catalog rows are not transfer history. They are not included in tracked volume, the hero total, or the coverage counts. `data.json` is unchanged by this catalog. Replacement SQL is not executed here.

| Status | Count | Meaning |
| --- | ---: | --- |
| In the published series | 2 | EURQ on Polygon, EURCV on Solana. Left as they are. |
| In the saved Arc query, absent from the series | 3 | EURAU, SEKAU, CHFAU. Already listed in query 8924650. SQL presence is not a series row. |
| In replacement SQL, not in the series | 10 | Polygon 6614895, Stellar, Solana, BSC. Files in `sql/replacements/`. Not saved on Dune. |
| Blocked, no sourced USD rate | 1 | BRMB on Stellar. The SAC is known. The result does not emit it. |
| No dashboard chain | 19 | No query id and no new network tab. |

The refresh job still calls only the query ids in the table above. It does not gain a network, a query id, or a rate-limit change.

### Replacement SQL

Full query text, built from the saved queries:

| Query | File | Change |
| --- | --- | --- |
| 6614895 | `sql/replacements/6614895_polygon.sql` | Adds EURAU, SEKAU, CHFAU once. Keeps EURQ and the other saved rows. |
| 6621899 | `sql/replacements/6621899_polygon.sql` | Unchanged token list. |
| 6689171 | `sql/replacements/6689171_solana.sql` | Adds EURAU and CHFAU. Keeps EURCV and `amount_display`. |
| 6712377 | `sql/replacements/6712377_stellar.sql` | Adds EURQ and EURCV by SAC, and EURAU SEP-41 at 6 decimals. BRMB is not emitted. |
| 8748306 | `sql/replacements/8748306_bsc.sql` | Keeps KGST. Adds EURI and EURAU. |
| 8924650 | `sql/replacements/8924650_arc.sql` | Saved text. No second copy of EURAU, SEKAU, or CHFAU. |

### How to validate without changing the canonical query

Do not create a new Dune query id. Do not insert zero-volume history. This pull request does not execute Dune queries. Open a draft or use Run in the editor without pressing Save on the canonical query. Paste the replacement file. Compare a finished day for a token the saved query already returns (EURQ, a part-2 token such as BRLA, EURCV, AUDD, KGST) with the current result. Then check the new symbols. Save over the canonical query only after that comparison. The existing refresh job can pull the new symbols only after that save. Until then, `data.json` stays as it is.

The series match is by ticker. Confirm the saved query uses the registry address before saving. EURQ on Polygon and EURCV on Solana are already in the published series. Do not add a second row.

1. Polygon queries [6614895](https://dune.com/queries/6614895) and [6621899](https://dune.com/queries/6621899). Polygon has two query ids. Add each new contract to exactly one of them. Rows for the same symbol and day are summed. Polygon additions EURAU, SEKAU, and CHFAU are only in query 6614895. Leave EURQ (`0xd571edb2ef29df10fcd6200fd6d0ed2389983db3`) in place.
2. BSC query [8748306](https://dune.com/queries/8748306). The saved query was KGST only. The replacement keeps KGST and adds EURI and EURAU. EURITE is the product name. The on-chain ticker and the series code are EURI. The replaced Polygon EURITE row was PHT Stablecoin. Do not merge EURI into the PHT series.
3. Solana query [6689171](https://dune.com/queries/6689171). Add the EURAU and CHFAU Token-2022 mints. Leave the EURCV mint `DghpMkatCiUsofbTmid3M3kAbDTPqDwKiYHnudXeGG52`. Its decimals are 2 and `amount_display` is already scaled. Do not divide it again. SEKAU on Solana is excluded. The issuer address resolved to a program, not a mint.
4. Stellar query [6712377](https://dune.com/queries/6712377). Add EURQ and EURCV by SAC contract, and EURAU by its SEP-41 contract. Stellar classic assets are code plus issuer. A SAC contract is not a classic issuer. Classic Stellar payments are not captured by stellar.history_contract_events. EURAU on Stellar is SEP-41. It is not a classic asset. Its decimals are 6. The other emitted tokens use 7.
5. Arc query [8924650](https://dune.com/queries/8924650). The saved text of query 8924650 already lists EURAU, SEKAU, and CHFAU. The published series does not contain those symbols. Do not add them again. `sql/arc_nonusd_transfers.sql` is the private-mainnet text and is not the saved query.

Chains with no query id, and no tab added here: Ethereum (EURQ, EURCV, EURI, EURAU, SEKAU, CHFAU), Algorand (EURQ), XRP Ledger (EURQ, EURCV), Xahau (EURQ), Adi Chain (DDSC), Base (EURAU, SEKAU, CHFAU), Arbitrum (EURAU), Optimism (EURAU), Tempo (EURAU, SEKAU, CHFAU). That is 19 entries. XRPL and Xahau decimals are n/a. Do not store a number. Issued currencies have no fixed decimals.

BRMB has no CNY rate in FX_FALLBACK. Do not invent one. BRMB is excluded from the Stellar result. Do not invent a CNY rate. Its SAC is `CBD67SY7LMNGXVELAAAUX7LHADZFJ4CK6BHYW36XBHCDNHQP5QO3AKXR`.

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
