/**
 * Vercel Function: Serve cached dashboard data
 * GET /api/dashboard-data
 *
 * Returns cached data from last successful Dune fetch.
 * Data is refreshed by separate cron job or manual script.
 */

// Cached data (updated by cron job or manual refresh)
// Format: pipe-delimited string of date|TOKEN|txcount|volume|TOKEN|txcount|volume|...
const CACHED_DATA = {
  polygon: process.env.POLYGON_DATA || '',
  stellar: process.env.STELLAR_DATA || '',
  solana: process.env.SOLANA_DATA || '',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

  // Check if data is available
  if (!CACHED_DATA.polygon || !CACHED_DATA.stellar || !CACHED_DATA.solana) {
    return res.status(503).json({
      success: false,
      error: 'Data not yet cached. Run refresh script manually or wait for scheduled update.',
    });
  }

  res.status(200).json({
    success: true,
    timestamp: new Date().toISOString(),
    data: {
      polygon: CACHED_DATA.polygon,
      stellar: CACHED_DATA.stellar,
      solana: CACHED_DATA.solana,
    },
  });
}
