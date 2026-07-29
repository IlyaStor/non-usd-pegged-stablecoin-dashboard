# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Non-USD stablecoin analytics dashboard. Tracks transfer volumes and transaction counts across Polygon, Stellar, and Solana. Hosted on Vercel at analytics.solosolver.xyz.

## Architecture

Single-file HTML dashboard (`index.html`) with embedded data, CSS, and JS. No build step, no frameworks. Chart.js for visualization (CDN). IBM Plex Mono font (CDN).

**Data pipeline:**
```
Dune Analytics API → Python scripts → pipe-delimited .txt files → embedded in index.html → Vercel auto-deploy on git push
```

**index.html structure:**
- `NETWORKS` object holds per-network config: `data` (pipe-delimited string), `tm` (token→currency+color mapping), `cc` (currency→color mapping)
- `parse()` converts pipe-delimited data → `{d, t, tx, v}` objects
- `loadNetwork(net)` aggregates tokens/currencies, sorts by volume
- `renderAll()` draws KPIs, filter chips, stacked line chart, breakdown table, doughnut chart
- State: `curNet`, `metric` (volume/count), `selected` (active token filters)

**Data format:** `date|TOKEN|txcount|volume_usd|TOKEN|txcount|volume_usd|...`

## Data Refresh Workflow

```bash
# Polygon: fetch from two Dune query executions, then patch index.html
python3 fetch_polygon.py
python3 update_polygon.py

# Stellar + Solana: fetch from Dune, output text files
python3 build_data.py
# Stellar/Solana data must be manually embedded into index.html NETWORKS object

# Deploy
git add index.html && git commit && git push origin main
```

Python dependency: `requests` (`pip3 install requests`).

## Dune Queries

- **Polygon Part 1** (query 6614895): CAD, AUD, EURQ, EUROP, EURe, TRYB, ZARP, NGNC
- **Polygon Part 2** (query 6621899): BRLA, BRZ, BRL1, COPM, JPYC, XSGD, XIDR, IDRT, PHPC, PHT
- **Stellar** (query 6712377): EURC, AUDD, ARS, GYEN, NGNC, PEN, BRLT, EURS
- **Solana** (query 6689171): EURC, VCHF, VEUR, EUROe, BRZ

API key is hardcoded in Python scripts. Queries use 365-day rolling window (`CURRENT_DATE - INTERVAL '365' DAY`).

## Key Conventions

- Solana volumes are in native currency; converted to USD via hardcoded FX rates in `build_data.py` (`SOLANA_FX` dict)
- Stellar volumes are already in USD from the Dune SQL query
- Polygon volumes use `prices.day` table with fallback prices
- `update_polygon.py` does regex replacement of the polygon data block and token/currency mappings inside index.html
- Stellar/Solana data update requires manual replacement in the `NETWORKS` object (no automated script yet)
