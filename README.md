# Tracked non-USD stablecoin dashboard

On-chain transfer volume and transaction counts for the non-USD stablecoins currently tracked on Polygon, Stellar, Solana, Tron, Plasma, BSC and Arc. Hosted at [analytics.solosolver.xyz](https://analytics.solosolver.xyz).

Totals are **tracked** volume. Coverage is not exhaustive; more tokens and chains will be added.

## How data gets onto the site

GitHub Actions (`.github/workflows/refresh-data.yml`) runs about every 2 days, or on demand:

1. `fetch-dune-data.js` executes each Dune query, waits until it finishes, and drops the incomplete UTC day of that execution.
2. It writes `data.json` (pipe-delimited series plus per-network `execution_ended_at`) and `og.png`.
3. The workflow commits those files. Vercel deploys `main`.

The page reads `/data.json`. It shows each network’s Dune execution time, not the git commit time.

A completed execution younger than 20 hours is reused so a same-day retry does not spend another run. If a query is still queued or running when the 36 minute job budget ends, its Dune execution id is stored in `refresh-state.json` and the series already on the site is left in place. The next run polls that id (status checks are not billed) and does not call execute again unless Dune reports the execution failed or expired. Finished networks from a partial run are still written. The default engine tier is `medium` (not `large`). Override with repository variables `DUNE_PERFORMANCE` (`small`, `medium`, `large`), `DUNE_FRESHNESS_HOURS`, and `DUNE_JOB_WAIT_MINUTES`.

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
