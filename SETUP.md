# API Setup for analytics.solosolver.xyz

## Vercel Environment Variables

Set the following environment variable on your Vercel project:

```
DUNE_API_KEY=vFSpHIY6RZ7Y4l5fw0PhMBufmwoKCsP6
```

**How to set it:**

1. Go to https://vercel.com/dashboard/projects
2. Select `non-usd-pegged-stablecoin-dashboard`
3. Navigate to **Settings** → **Environment Variables**
4. Add new variable:
   - Name: `DUNE_API_KEY`
   - Value: `vFSpHIY6RZ7Y4l5fw0PhMBufmwoKCsP6`
   - Environments: Production, Preview, Development

5. Redeploy the project

## Data Refresh

Dashboard now auto-fetches data from Dune every page load with 5-minute CDN cache.

**Manual refresh:** Clear browser cache and reload https://analytics.solosolver.xyz

## Architecture

```
Browser → GET /api/dashboard-data → Dune API
                ↓
           Execute 3 queries in parallel:
           - Polygon (6621899)
           - Stellar (6712377)
           - Solana (6689171)

           Verify 90-day rolling window:
           - Jan 15, 2026 → Apr 15, 2026 (all networks)

           Return: {polygon, stellar, solana} in pipe-delimited format
```

## Testing Locally

```bash
export DUNE_API_KEY=vFSpHIY6RZ7Y4l5fw0PhMBufmwoKCsP6
vercel dev
```

Then visit http://localhost:3000/api/dashboard-data to test the endpoint directly.

## Query IDs

- **Polygon (6621899):** BRL1, BRLA, BRZ, XSGD, COPM, JPYC, IDRT, XIDR, PHT, PHPC, AUD, CAD, EURe, EURQ, EUROP, TRYB, ZARP, AUDX, IDRX, EURS, XZAR, CADC
- **Stellar (6712377):** EURC, AUDD, ARS, GYEN, NGNC, PEN, BRLT, EURS
- **Solana (6689171):** EURC, EUROe, VEUR, VCHF, BRZ

All queries use **90-day rolling window** automatically via Dune SQL:
```sql
WHERE block_date >= CURRENT_DATE - INTERVAL '90' DAY
```

## Performance

- Query execution: ~30-45s (parallel)
- CDN cache: 5 minutes
- Stale-while-revalidate: 10 minutes
- Cost: ~30 credits per full refresh
